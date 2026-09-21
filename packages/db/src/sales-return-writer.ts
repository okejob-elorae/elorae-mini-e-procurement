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

export type AcceptReturnItemResult =
  | { applied: true; stockAdjustmentId: string }
  | {
      applied: false;
      skipped: "already_decided" | "unmapped_sku" | "return_locked" | "no_inventory_row";
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
  if (!item.itemId) {
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
  const inv = item.variantSku
    ? await tx.inventoryValue.findFirst({
        where: { itemId: item.itemId, variantSku: item.variantSku },
        select: invSelect,
      })
    : await tx.inventoryValue.findFirst({
        where: { itemId: item.itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
        orderBy: { id: "asc" },
        select: invSelect,
      });
  if (!inv) return { applied: false, skipped: "no_inventory_row" };

  const qty = toNum(item.qty);
  const prevQty = toNum(inv.qtyOnHand);
  const avgCost = toNum(inv.avgCost);
  const newQty = prevQty + qty;

  const adj = await tx.stockAdjustment.create({
    data: {
      docNumber: `RET-${item.id}`,
      itemId: item.itemId,
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
    itemId: item.itemId,
    variantSku: item.variantSku,
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
