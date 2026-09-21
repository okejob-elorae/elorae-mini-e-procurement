import { moveStoreStock } from "@elorae/db";
import type { StockLedgerRefType } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { weightedAvgCost } from "@/lib/inventory/weighted-avg-cost";
import { StoreTransferError } from "./errors";

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
 * creation time (0 when the source carries no row for that item/variant yet). This is the "same
 * cost basis on both sides" figure `approveStoreTransfer` later hands to both `moveStoreStock`
 * calls unchanged — captured now rather than re-read at approve, because the source balance can
 * legitimately move between creation and approval and the transfer must carry the cost it was
 * valued at when staged, not whatever the source happens to hold later.
 */
export async function createStoreTransfer(input: {
  fromStoreId: string;
  toStoreId: string;
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
 * Cost basis: each line's `unitCost` — snapshotted once at creation (see `createStoreTransfer`
 * above) — is passed to BOTH `moveStoreStock` calls, so the value leaving the source is exactly
 * the value landing at the destination; nothing appears or vanishes in transit.
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
        lines: {
          orderBy: { id: "asc" },
          select: { id: true, itemId: true, variantSku: true, qty: true, unitCost: true },
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

    for (const line of transfer.lines) {
      const qty = line.qty.toNumber();
      const unitCost = line.unitCost.toNumber();

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
        unitCost,
        totalCost: -(qty * unitCost),
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
       */
      const blendQty = Math.max(prevDestQty, 0);
      const newDestAvgCost = destStock ? weightedAvgCost(blendQty, prevDestAvgCost, qty, unitCost) : unitCost;
      const newDestQty = prevDestQty + qty;

      await moveStoreStock(tx, {
        storeId: transfer.toStoreId,
        itemId: line.itemId,
        variantSku: line.variantSku,
        qtyDelta: qty,
        avgCost: newDestAvgCost,
        unitCost,
        totalCost: qty * unitCost,
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
