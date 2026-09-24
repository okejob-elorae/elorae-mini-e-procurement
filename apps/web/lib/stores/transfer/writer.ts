import { moveStoreStock } from "@elorae/db";
import type { StockLedgerRefType } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { weightedAvgCost } from "@/lib/inventory/weighted-avg-cost";
import { StoreTransferError } from "./errors";
import { isMovedAtInFuture } from "./moved-at";

export type CreateStoreTransferLine = {
  itemId: string;
  variantSku: string;
  qty: number;
};

/**
 * Creates a PENDING transfer with its lines. No stock moves here — that only happens on
 * approve, in `approveStoreTransfer` below.
 *
 * Each line's `unitCost` is snapshotted from the SOURCE store's current `StoreStock.avgCost` at
 * creation time (0 when the source carries no row for that item/variant yet). This is the
 * DOCUMENT's own figure — what the transfer was estimated at when raised, fine for a screen to
 * show — and NOTHING ELSE reads it: `approveStoreTransfer` deliberately re-reads the source's
 * avgCost at approve time instead of reusing this snapshot, because the source can legitimately
 * reprice between creation and approval (an ordinary konsi transfer arriving is enough), and a
 * stale snapshot as the ledger's cost basis would move value into or out of existence rather
 * than merely disagreeing with itself. Do not wire this field back into the movement's cost
 * basis — see the comment on `approveStoreTransfer` for the full reasoning.
 *
 * `movedAt` is the moment the goods physically left the source store, entered as a WIB date and
 * time and often recorded after the fact. Every lag guard — this writer's `COUNTED_SINCE_MOVE`,
 * stocktake approval's `TRANSFER_PENDING` and exclusion, the sell-through report's
 * `TRANSFER_IN_FLIGHT` — compares it as an instant against a count moment, so a count earlier on
 * the same day as the move stays before it. A moment after now is refused.
 */
export async function createStoreTransfer(input: {
  fromStoreId: string;
  toStoreId: string;
  movedAt: Date;
  note?: string | null;
  createdById: string;
  lines: CreateStoreTransferLine[];
}): Promise<{ transferId: string; docNo: string }> {
  return runSerializable(async (tx) => {
    if (input.fromStoreId === input.toStoreId) throw new StoreTransferError("SAME_STORE");
    if (input.lines.length === 0) throw new StoreTransferError("NO_LINES");
    for (const l of input.lines) {
      if (!Number.isFinite(l.qty) || l.qty <= 0) throw new StoreTransferError("BAD_QTY");
    }
    if (isMovedAtInFuture(input.movedAt, new Date())) throw new StoreTransferError("MOVED_AT_IN_FUTURE");

    /*
     * `StoreTransfer.fromStore`/`toStore` are REQUIRED relations under relationMode = "prisma" —
     * no database FK backs them, so a bad id would otherwise create the row and only surface
     * later as `listStoreTransfers`'s `Inconsistent query result` on every read. The SAME_STORE
     * guard above already guarantees these are two distinct ids by the time we get here, but the
     * count is compared against the DEDUPED id list rather than a hardcoded 2 so this stays
     * correct on its own even if that ordering ever changes.
     */
    const storeIds = Array.from(new Set([input.fromStoreId, input.toStoreId]));
    const storeCount = await tx.store.count({ where: { id: { in: storeIds } } });
    if (storeCount !== storeIds.length) throw new StoreTransferError("STORE_NOT_FOUND");

    const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
    const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true } });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const l of input.lines) {
      if (!byId.has(l.itemId)) throw new StoreTransferError("ITEM_NOT_FOUND");
    }

    const docNo = await generateDocNumber("STORETRF", tx);

    const transfer = await tx.storeTransfer.create({
      data: {
        docNo,
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        movedAt: input.movedAt,
        note: input.note ?? null,
        createdById: input.createdById,
      },
      select: { id: true },
    });

    const lineData: Array<{
      transferId: string;
      itemId: string;
      variantSku: string;
      productName: string;
      qty: number;
      unitCost: number;
    }> = [];

    for (const l of input.lines) {
      const item = byId.get(l.itemId)!;
      const sourceStock = await tx.storeStock.findUnique({
        where: { storeId_itemId_variantSku: { storeId: input.fromStoreId, itemId: l.itemId, variantSku: l.variantSku } },
        select: { avgCost: true },
      });
      lineData.push({
        transferId: transfer.id,
        itemId: l.itemId,
        variantSku: l.variantSku,
        productName: item.nameId,
        qty: l.qty,
        unitCost: sourceStock ? sourceStock.avgCost.toNumber() : 0,
      });
    }

    await tx.storeTransferLine.createMany({ data: lineData });

    return { transferId: transfer.id, docNo };
  });
}

/**
 * Approves a transfer: moves every line's qty out of the source store and into the destination
 * store, both through `moveStoreStock` so the ledger entry is written in the same transaction as
 * the balance write — never a direct `StoreStock` write.
 *
 * The status flip is a CAS (`updateMany` filtered on `status: "PENDING"`), not a read-then-write:
 * it runs BEFORE any stock is moved, and a non-1 match count throws immediately. That is what
 * stops an already-approved (or cancelled) transfer from moving stock a second time — mirroring
 * `verifyCollection` (lib/finance/collections/verify-writer.ts) and the shipment status flips in
 * lib/delivery/shipment-writer.ts, rather than the read-then-plain-update shape older approval
 * writers in this repo (e.g. field-sales/retur/approve-writer.ts) still use.
 *
 * A transfer is refused `COUNTED_SINCE_MOVE`, naming the counts, when either store has an APPROVED
 * stocktake that counted one of this transfer's item::variant keys (a line with a `countedQty`)
 * at a count moment (`countFinishedAt`, or `approvedAt` for a count saved before that column
 * existed) on or after `movedAt`. That count already recorded the move as a shortfall at one store
 * and a surplus at the other, and moving the stock now would record it twice. A count that left
 * those keys uncounted, or never had them, did not see the move and does not refuse. The only way
 * out is to cancel the transfer; the move then stands in the count. The check runs after the CAS —
 * so a repeat approval still reports `INVALID_STATE` — and before any stock moves, and it throws,
 * which rolls the CAS back with it.
 *
 * Cost basis: BOTH `moveStoreStock` calls use `sourceAvgCost` — the source store's `avgCost` read
 * fresh from `StoreStock`, INSIDE this transaction, at approve time — never `line.unitCost` (the
 * create-time snapshot on `StoreTransferLine`, see the comment on `createStoreTransfer` above).
 * The two figures can legitimately diverge: the source can reprice between creation and approval
 * (an ordinary konsi transfer landing there is enough), and using the stale snapshot as the cost
 * basis while the source's own `balanceValue` is computed from its CURRENT average would move
 * value into or out of existence — the source's decrement would report leaving at the old price
 * while its own row closes at the new one, and the destination would receive a different value
 * than the source actually gave up. Reading the current average for both legs is what keeps the
 * source's row internally consistent and makes the destination receive exactly what the source
 * gave up, regardless of what happened between create and approve.
 *
 * The source decrement leaves `StoreStock.avgCost` untouched (omits the `avgCost` param), matching
 * every other store-side decrement in this codebase (field-sales/retur/approve-writer.ts's konsi
 * decrement, the store stocktake writer) — removing units at the current average leaves the
 * average unchanged. The destination increment BLENDS the incoming cost into whatever average the
 * destination already holds via `weightedAvgCost`, the same shape
 * field-sales/konsi-transfer/writer.ts uses for its own incoming leg, clamping a negative existing
 * balance to 0 for the blend only (you cannot average a cost against units that are not there).
 *
 * `moveStoreStock` has no floor guard and a store balance is allowed to go negative in this system
 * by design (its own doc comment says so, and field-sales/retur/approve-writer.ts's konsi decrement
 * already relies on it) — so an insufficient source balance is ALLOWED here too, never refused.
 */
export async function approveStoreTransfer(input: {
  transferId: string;
  approvedById: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const transfer = await tx.storeTransfer.findUnique({
      where: { id: input.transferId },
      select: {
        id: true,
        docNo: true,
        fromStoreId: true,
        toStoreId: true,
        movedAt: true,
        lines: {
          orderBy: { id: "asc" },
          /* No `unitCost` here on purpose — see the function doc above. That column is the
             document's create-time snapshot; this function's cost basis is `sourceAvgCost`,
             read fresh from `StoreStock` below. */
          select: { id: true, itemId: true, variantSku: true, qty: true },
        },
      },
    });
    if (!transfer) throw new StoreTransferError("NOT_FOUND");

    /*
     * The CAS itself IS the double-approval guard — see the function doc above. A concurrent or
     * repeated call whose status is no longer PENDING matches zero rows here and throws before a
     * single moveStoreStock call runs.
     */
    const claimed = await tx.storeTransfer.updateMany({
      where: { id: transfer.id, status: "PENDING" },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById },
    });
    if (claimed.count !== 1) throw new StoreTransferError("INVALID_STATE");

    const transferKeys = transfer.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku ?? "" }));
    const countedSinceMove = await tx.storeStocktake.findMany({
      where: {
        status: "APPROVED",
        storeId: { in: [transfer.fromStoreId, transfer.toStoreId] },
        OR: [
          { countFinishedAt: { gte: transfer.movedAt } },
          { countFinishedAt: null, approvedAt: { gte: transfer.movedAt } },
        ],
        lines: { some: { countedQty: { not: null }, OR: transferKeys } },
      },
      orderBy: { docNo: "asc" },
      select: { docNo: true },
    });
    if (countedSinceMove.length > 0) {
      throw new StoreTransferError("COUNTED_SINCE_MOVE", countedSinceMove.map((s) => s.docNo).join(", "));
    }

    for (const line of transfer.lines) {
      const qty = line.qty.toNumber();

      /*
       * Both reads below run INSIDE this transaction, after the CAS above has already claimed
       * the approval — never before it and never outside runSerializable. Under SERIALIZABLE
       * isolation a concurrent transaction touching either StoreStock row forces one of the two
       * transactions to fail with a serialization conflict and retry (handled by runSerializable's
       * withRetry), so neither read can observe a balance that a concurrent mover is still in the
       * middle of changing — there is no stale-read window to guard against by hand here.
       */
      const sourceKey = {
        storeId_itemId_variantSku: { storeId: transfer.fromStoreId, itemId: line.itemId, variantSku: line.variantSku },
      };
      const sourceStock = await tx.storeStock.findUnique({ where: sourceKey, select: { qty: true, avgCost: true } });
      const prevSourceQty = sourceStock ? sourceStock.qty.toNumber() : 0;
      const sourceAvgCost = sourceStock ? sourceStock.avgCost.toNumber() : 0;
      const newSourceQty = prevSourceQty - qty;

      await moveStoreStock(tx, {
        storeId: transfer.fromStoreId,
        itemId: line.itemId,
        variantSku: line.variantSku,
        qtyDelta: -qty,
        unitCost: sourceAvgCost,
        totalCost: -(qty * sourceAvgCost),
        balanceValue: newSourceQty * sourceAvgCost,
        refType: "StoreTransfer" satisfies StockLedgerRefType,
        refId: transfer.id,
        refDocNumber: transfer.docNo,
        createdById: input.approvedById,
      });

      const destKey = {
        storeId_itemId_variantSku: { storeId: transfer.toStoreId, itemId: line.itemId, variantSku: line.variantSku },
      };
      const destStock = await tx.storeStock.findUnique({ where: destKey, select: { qty: true, avgCost: true } });
      const prevDestQty = destStock ? destStock.qty.toNumber() : 0;
      const prevDestAvgCost = destStock ? destStock.avgCost.toNumber() : 0;
      /*
       * A negative existing destination balance (e.g. a prior over-issue) represents units that
       * are not physically there. Blending this transfer's incoming cost against those units would
       * use a negative weight and inflate the blended average past the true cost, so the blend
       * clamps the existing qty to 0 — the qty actually moved below still uses the real prevDestQty.
       * The incoming cost itself is `sourceAvgCost` (see the function doc above), not `line.unitCost`.
       */
      const blendQty = Math.max(prevDestQty, 0);
      const newDestAvgCost = destStock ? weightedAvgCost(blendQty, prevDestAvgCost, qty, sourceAvgCost) : sourceAvgCost;
      const newDestQty = prevDestQty + qty;

      await moveStoreStock(tx, {
        storeId: transfer.toStoreId,
        itemId: line.itemId,
        variantSku: line.variantSku,
        qtyDelta: qty,
        avgCost: newDestAvgCost,
        unitCost: sourceAvgCost,
        totalCost: qty * sourceAvgCost,
        balanceValue: newDestQty * newDestAvgCost,
        refType: "StoreTransfer" satisfies StockLedgerRefType,
        refId: transfer.id,
        refDocNumber: transfer.docNo,
        createdById: input.approvedById,
      });
    }

    return { ok: true as const };
  });
}

/**
 * Cancels a PENDING transfer. Much shorter than `approveStoreTransfer` above for a real reason,
 * not an oversight: a PENDING transfer has not moved any stock — only `approveStoreTransfer`
 * calls `moveStoreStock` — so there is nothing to reverse. No `moveStoreStock` call, no ledger
 * entry, here.
 *
 * The status flip is the same CAS shape as the approve path (`updateMany` filtered on
 * `status: "PENDING"`, a non-1 match count throwing `INVALID_STATE`), and that CAS is also what
 * makes cancelling an APPROVED transfer structurally impossible rather than merely guarded
 * against: the `where` only ever matches a row still `PENDING`, so an already-approved transfer
 * (stock already moved, a different document with different accounting to reverse) can never
 * reach past this line. Every failure path throws rather than returning — `runSerializable` is a
 * plain `prisma.$transaction`, which COMMITS on a normal return, so a `return { error }` after
 * this `updateMany` would commit the cancel while reporting failure (the same trap
 * `updateDeliveryDatesAction` and `approveSettlement`'s re-validation guards are named for in
 * this repo's landmine index).
 *
 * `StoreTransfer` carries no `cancelledById`/`cancelledAt` columns — unlike `StoreStocktake`,
 * which has both plus a `cancelReason` — and reusing `approvedById`/`approvedAt` for a cancel
 * would misrepresent the document as approved. Adding dedicated columns is a schema migration
 * outside this writer's scope, so the actor and timestamp are recorded on the existing shared
 * `AuditLog` table instead, the same way `rejectCollection`
 * (`lib/finance/collections/reject-writer.ts`) covers the identical gap on
 * `CollectionSubmission` (no `rejectedById`/`rejectedAt` column there either).
 */
export async function cancelStoreTransfer(input: {
  transferId: string;
  cancelledById: string;
}): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const transfer = await tx.storeTransfer.findUnique({
      where: { id: input.transferId },
      select: { id: true },
    });
    if (!transfer) throw new StoreTransferError("NOT_FOUND");

    const claimed = await tx.storeTransfer.updateMany({
      where: { id: transfer.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count !== 1) throw new StoreTransferError("INVALID_STATE");

    await tx.auditLog.create({
      data: {
        userId: input.cancelledById,
        action: "STORE_TRANSFER_CANCEL",
        entityType: "StoreTransfer",
        entityId: transfer.id,
      },
    });

    return { ok: true as const };
  });
}
