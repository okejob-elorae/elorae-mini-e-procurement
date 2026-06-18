import type { Prisma } from "../generated/prisma/client";
import type { StockAdjustmentSource } from "./stock-adjustment-source";
import type { JubelioOutboxEntityType } from "./jubelio-outbox";

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
// that resolve to the same (itemId, variantSku). Without serialization the
// read-then-write on InventoryValue.qtyOnHand can lose updates. Sub-B server
// actions handle this with row-level locking or per-return-id serialization.
export async function acceptReturnItem(
  tx: Prisma.TransactionClient,
  input: AcceptReturnItemInput,
): Promise<AcceptReturnItemResult> {
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
  if (!item.itemId) {
    return { applied: false, skipped: "unmapped_sku" };
  }

  const inv = await tx.inventoryValue.findFirst({
    where: {
      itemId: item.itemId,
      OR: [
        { variantSku: item.variantSku ?? null },
        ...(item.variantSku == null
          ? [{ variantSku: "" as string | null }]
          : []),
      ],
    },
    select: { id: true, qtyOnHand: true, avgCost: true },
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

  await tx.inventoryValue.update({
    where: { id: inv.id },
    data: {
      qtyOnHand: newQty,
      totalValue: newQty * avgCost,
      lastUpdated: new Date(),
    },
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
