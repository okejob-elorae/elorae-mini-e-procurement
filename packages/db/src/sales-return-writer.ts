import type { Prisma } from "../generated/prisma/client";
import { moveMainStock } from "./stock-balance";
import type { StockAdjustmentSource } from "./stock-adjustment-source";
import type { JubelioOutboxEntityType } from "./jubelio-outbox";
import type { StockLedgerRefType } from "./stock-ledger-ref";

export type SalesReturnStatusLiteral = "PENDING" | "ACCEPTED" | "REJECTED" | "PARTIAL";

export type AcceptReturnItemInput = {
  returnItemId: string;
  reason: string;
  changedById: string;
};

/**
 * Why an accept recorded the decision without moving stock. NOT_CONSUMED — the order's reservation
 * for this line was released, never consumed, so the goods never left ERP stock and adding them
 * back would count them twice; no COGS was booked for them either, so none needs reversing.
 */
export type AcceptNoStockReason = "NOT_CONSUMED";

export type AcceptReturnItemResult =
  | { applied: true; stockAdjustmentId: string }
  | { applied: true; stockAdjustmentId: null; noStockReason: AcceptNoStockReason }
  | {
      applied: false;
      skipped:
        | "already_decided"
        | "unmapped_sku"
        | "return_locked"
        | "no_inventory_row"
        | "order_not_settled"
        | "no_governing_row"
        | "stock_not_traceable";
    };

export type RejectReturnItemInput = {
  returnItemId: string;
  reason: string;
  changedById: string;
};

export type RejectReturnItemResult =
  | { applied: true }
  | { applied: false; skipped: "already_decided" | "return_locked" };

export type SubmitReturnDecisionInput = {
  salesReturnId: string;
  changedById: string;
};

export type SubmitReturnDecisionResult =
  | { applied: true; status: SalesReturnStatusLiteral; outboxRowId: string }
  | {
      applied: false;
      skipped: "no_items" | "items_still_pending" | "already_submitted";
    };

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

// Concurrency note: callers must serialize concurrent acceptReturnItem calls
// that resolve to the same (itemId, variantSku). qtyOnHand itself is safe now —
// moveMainStock moves it with an atomic increment — but totalValue is still
// computed from this function's own pre-read of prevQty/avgCost and then written
// absolutely, so two concurrent calls can still race on totalValue and lose an
// update. Sub-B server actions handle this with row-level locking or
// per-return-id serialization.
export async function acceptReturnItem(
  tx: Prisma.TransactionClient,
  input: AcceptReturnItemInput,
): Promise<AcceptReturnItemResult> {
  const item = await tx.salesReturnItem.findUnique({
    where: { id: input.returnItemId },
    include: { salesReturn: { select: { pushOutboxRowId: true, jubelioReturnNo: true } } },
  });
  if (!item) return { applied: false, skipped: "already_decided" };
  if (item.salesReturn.pushOutboxRowId !== null) {
    return { applied: false, skipped: "return_locked" };
  }
  if (item.decision !== "PENDING") {
    return { applied: false, skipped: "already_decided" };
  }

  /*
   * The order's own reservation decides the stock side, when the line names its order line: it
   * says whether the goods ever left ERP stock, and if they did, which row they came off. A line
   * with no reservation keeps the item-based path below unchanged.
   *   RELEASED  — never consumed: accept with no stock change.
   *   RESERVED  — the order's stock is not settled; a later consume would take off goods that came
   *               back, so refuse until the order resolves.
   *   CONSUMED  — restore, capped at the reserved qty, onto the row that governs the variant now:
   *               the reservation's own row while it is still mapped, else the one other item the
   *               variant is mapped on (the row it moved to when its old item was superseded). With
   *               neither, refuse — never a silent no-stock accept, since the sale's COGS is booked.
   * A line that names its order line but has NO reservation came from a line never reserved (unmapped
   * when the order arrived, or older than reservations), so nothing says whether its stock left:
   * refuse rather than restore onto the ingest-resolved item, which could add stock that never left.
   */
  const reservation = item.salesOrderDetailId === null
    ? null
    : await tx.stockReservation.findUnique({
        where: { salesorderDetailId: item.salesOrderDetailId },
        select: { itemId: true, variantSku: true, state: true, qty: true },
      });
  if (item.salesOrderDetailId !== null && !reservation) {
    return { applied: false, skipped: "stock_not_traceable" };
  }
  if (reservation?.state === "RESERVED") return { applied: false, skipped: "order_not_settled" };
  if (reservation && reservation.state !== "CONSUMED") {
    return acceptWithoutStock(tx, input, "NOT_CONSUMED");
  }
  let stockItemId = item.itemId;
  let stockVariantSku = item.variantSku;
  let qty = toNum(item.qty);
  if (reservation) {
    const target = await resolveRestoreItem(tx, reservation.itemId, reservation.variantSku);
    if (target === null) return { applied: false, skipped: "no_governing_row" };
    stockItemId = target;
    stockVariantSku = reservation.variantSku;
    qty = Math.min(qty, toNum(reservation.qty));
  }
  if (!stockItemId) {
    return { applied: false, skipped: "unmapped_sku" };
  }

  /*
   * The canonical OR-tolerant lookup, restated: findExistingInventoryValueRow lives in
   * apps/web/lib/inventory/costing.ts and packages/db sits below apps/web, so it cannot be
   * imported here — the shape is copied instead, tie-break included. Change it there, change it
   * here and in stock-balance.ts's two movers.
   *
   * Tolerance keys on FALSY, not on null. This used to widen the OR only when variantSku was
   * null, which made a Jubelio-sourced variantless item arriving with "" strict: it missed a
   * null-spelled InventoryValue row and returned skipped: "no_inventory_row" with the stock
   * sitting right there, silently declining to restore it.
   */
  const invSelect = { id: true, qtyOnHand: true, avgCost: true } as const;
  const inv = stockVariantSku
    ? await tx.inventoryValue.findFirst({
        where: { itemId: stockItemId, variantSku: stockVariantSku },
        select: invSelect,
      })
    : await tx.inventoryValue.findFirst({
        where: { itemId: stockItemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        orderBy: { id: "asc" },
        select: invSelect,
      });
  if (!inv) return { applied: false, skipped: "no_inventory_row" };

  const prevQty = toNum(inv.qtyOnHand);
  const avgCost = toNum(inv.avgCost);
  const newQty = prevQty + qty;

  const adj = await tx.stockAdjustment.create({
    data: {
      docNumber: `RET-${item.id}`,
      itemId: stockItemId,
      type: "POSITIVE",
      qtyChange: qty,
      reason: input.reason,
      prevQty,
      newQty,
      prevAvgCost: avgCost,
      newAvgCost: avgCost,
      source: "ERP_RETURN_ACCEPT" satisfies StockAdjustmentSource,
      idempotencyKey: `return-accept:${item.id}`,
      externalRef: item.id,
    },
    select: { id: true },
  });

  await moveMainStock(tx, {
    itemId: stockItemId,
    variantSku: stockVariantSku,
    qtyDelta: qty,
    totalValue: newQty * avgCost,
    totalCost: qty * avgCost,
    balanceValue: newQty * avgCost,
    inventoryValueId: inv.id,
    refType: "SalesReturn" satisfies StockLedgerRefType,
    refId: item.salesReturnId,
    refDocNumber: item.salesReturn.jubelioReturnNo ?? undefined,
    createdById: input.changedById,
  });

  await tx.salesReturnItem.update({
    where: { id: input.returnItemId },
    data: {
      decision: "ACCEPTED",
      decidedAt: new Date(),
      decidedById: input.changedById,
      stockAdjustmentId: adj.id,
    },
  });

  return { applied: true, stockAdjustmentId: adj.id };
}

/**
 * The item whose row a consumed line's stock goes back to: the reserved item while its variant is
 * still mapped there, else the single other item the variant is mapped on. `null` when neither
 * exists or the variant is mapped on more than one other item. A variantless reservation has no
 * SKU to follow, so it resolves only to its own item.
 */
async function resolveRestoreItem(
  tx: Prisma.TransactionClient,
  itemId: string,
  variantSku: string,
): Promise<string | null> {
  const own = await tx.jubelioProductMapping.findFirst({
    where: { itemId, erpVariantSku: variantSku },
    select: { id: true },
  });
  if (own) return itemId;
  if (variantSku === "") return null;
  const moved = await tx.jubelioProductMapping.findMany({
    where: { erpVariantSku: variantSku, itemId: { not: itemId } },
    select: { itemId: true },
  });
  const itemIds = [...new Set(moved.map((m) => m.itemId))];
  return itemIds.length === 1 ? itemIds[0] : null;
}

/**
 * Records an accept that moves no stock. `ACCEPTED` with no `stockAdjustmentId` is what marks it:
 * the line's `itemReason` is left alone, since the return ingest rewrites it on every re-ingest.
 */
async function acceptWithoutStock(
  tx: Prisma.TransactionClient,
  input: AcceptReturnItemInput,
  noStockReason: AcceptNoStockReason,
): Promise<AcceptReturnItemResult> {
  await tx.salesReturnItem.update({
    where: { id: input.returnItemId },
    data: {
      decision: "ACCEPTED",
      decidedAt: new Date(),
      decidedById: input.changedById,
    },
  });
  return { applied: true, stockAdjustmentId: null, noStockReason };
}

export async function rejectReturnItem(
  tx: Prisma.TransactionClient,
  input: RejectReturnItemInput,
): Promise<RejectReturnItemResult> {
  const item = await tx.salesReturnItem.findUnique({
    where: { id: input.returnItemId },
    include: { salesReturn: { select: { pushOutboxRowId: true } } },
  });
  if (!item) return { applied: false, skipped: "already_decided" };
  if (item.salesReturn.pushOutboxRowId !== null) {
    return { applied: false, skipped: "return_locked" };
  }
  if (item.decision !== "PENDING") {
    return { applied: false, skipped: "already_decided" };
  }

  await tx.salesReturnItem.update({
    where: { id: input.returnItemId },
    data: {
      decision: "REJECTED",
      decidedAt: new Date(),
      decidedById: input.changedById,
      itemReason: input.reason,
    },
  });

  return { applied: true };
}

export async function submitReturnDecision(
  tx: Prisma.TransactionClient,
  input: SubmitReturnDecisionInput,
): Promise<SubmitReturnDecisionResult> {
  const ret = await tx.salesReturn.findUnique({
    where: { id: input.salesReturnId },
    include: { items: { select: { decision: true } } },
  });
  if (!ret) return { applied: false, skipped: "no_items" };
  if (ret.pushOutboxRowId !== null) {
    return { applied: false, skipped: "already_submitted" };
  }
  if (ret.items.length === 0) return { applied: false, skipped: "no_items" };
  const pendingCount = ret.items.filter((i) => i.decision === "PENDING").length;
  if (pendingCount > 0) return { applied: false, skipped: "items_still_pending" };

  const acceptedCount = ret.items.filter((i) => i.decision === "ACCEPTED").length;
  const rejectedCount = ret.items.filter((i) => i.decision === "REJECTED").length;
  let status: SalesReturnStatusLiteral;
  if (acceptedCount > 0 && rejectedCount === 0) status = "ACCEPTED";
  else if (rejectedCount > 0 && acceptedCount === 0) status = "REJECTED";
  else status = "PARTIAL";

  const outboxRow = await tx.jubelioOutbox.create({
    data: {
      entityType: "salesreturn_decision_push" satisfies JubelioOutboxEntityType,
      entityId: input.salesReturnId,
      payload: {},
      enqueuedById: input.changedById,
    },
    select: { id: true },
  });

  await tx.salesReturn.update({
    where: { id: input.salesReturnId },
    data: {
      status,
      decidedAt: new Date(),
      decidedById: input.changedById,
      pushOutboxRowId: outboxRow.id,
    },
  });

  return { applied: true, status, outboxRowId: outboxRow.id };
}
