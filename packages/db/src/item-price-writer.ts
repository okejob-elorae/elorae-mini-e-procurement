import type { Prisma } from "../generated/prisma/client";
import type { JubelioOutboxEntityType } from "./jubelio-outbox";

export type PriceChangeTrigger = "FG_RECEIPT" | "MARGIN_CHANGE" | "DEFAULTS_CHANGE";

export type RecalcItemSellingPriceInput = {
  itemId: string;
  trigger: PriceChangeTrigger;
  newAvgCost?: number;
  fgReceiptId?: string;
  changedById: string | null;
};

export type RecalcSkipReason =
  | "no_change"
  | "no_margin_configured"
  | "ingested_item"
  | "non_finished_good"
  | "no_avg_cost_basis";

export type RecalcItemSellingPriceResult =
  | {
      applied: true;
      oldSellingPrice: number | null;
      newSellingPrice: number;
      outboxRowId: string | null;
    }
  | { applied: false; skipped: RecalcSkipReason };

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

export async function recalcItemSellingPrice(
  tx: Prisma.TransactionClient,
  input: RecalcItemSellingPriceInput,
): Promise<RecalcItemSellingPriceResult> {
  const item = await tx.item.findUnique({
    where: { id: input.itemId },
    select: {
      id: true,
      type: true,
      source: true,
      sellingPrice: true,
      targetMarginPercent: true,
      additionalCost: true,
    },
  });
  if (!item) return { applied: false, skipped: "non_finished_good" };
  if (item.type !== "FINISHED_GOOD") return { applied: false, skipped: "non_finished_good" };
  if (item.source === "JUBELIO_INGEST") return { applied: false, skipped: "ingested_item" };

  const defaults = await tx.jubelioPushDefaults.findFirst({
    select: { defaultMarginPercent: true, defaultAdditionalCost: true },
  });

  const effectiveMargin =
    item.targetMarginPercent != null
      ? toNum(item.targetMarginPercent)
      : defaults?.defaultMarginPercent != null
        ? toNum(defaults.defaultMarginPercent)
        : null;

  if (effectiveMargin === null) {
    return { applied: false, skipped: "no_margin_configured" };
  }

  const effectiveExtras =
    item.additionalCost != null
      ? toNum(item.additionalCost)
      : defaults?.defaultAdditionalCost != null
        ? toNum(defaults.defaultAdditionalCost)
        : 0;

  let newAvgCost: number;
  if (input.newAvgCost != null) {
    newAvgCost = input.newAvgCost;
  } else {
    // Variantless InventoryValue rows in this codebase use `variantSku: null`,
    // not `""` (per actual DB audit). Tolerate both conventions defensively.
    const inv = await tx.inventoryValue.findFirst({
      where: {
        itemId: input.itemId,
        OR: [{ variantSku: null }, { variantSku: "" }],
      },
      select: { avgCost: true },
    });
    if (!inv) {
      return { applied: false, skipped: "no_avg_cost_basis" };
    }
    newAvgCost = toNum(inv.avgCost);
  }

  const newSellingPriceRaw = newAvgCost * (1 + effectiveMargin / 100) + effectiveExtras;
  const newSellingPrice = Math.round(newSellingPriceRaw * 100) / 100;
  const oldSellingPrice = item.sellingPrice != null ? toNum(item.sellingPrice) : null;

  if (oldSellingPrice === newSellingPrice) {
    return { applied: false, skipped: "no_change" };
  }

  await tx.item.update({
    where: { id: input.itemId },
    data: { sellingPrice: newSellingPrice },
  });

  await tx.itemPriceChangeLog.create({
    data: {
      itemId: input.itemId,
      oldSellingPrice,
      newSellingPrice,
      oldAvgCost: null,
      newAvgCost,
      marginPercentUsed: effectiveMargin,
      additionalCostUsed: effectiveExtras,
      triggerReason: input.trigger,
      fgReceiptId: input.fgReceiptId ?? null,
      changedById: input.changedById,
    },
  });

  const mappingCount = await tx.jubelioProductMapping.count({
    where: { itemId: input.itemId },
  });

  let outboxRowId: string | null = null;
  if (mappingCount > 0) {
    const row = await tx.jubelioOutbox.create({
      data: {
        entityType: "product_push" satisfies JubelioOutboxEntityType,
        entityId: input.itemId,
        payload: {},
        enqueuedById: input.changedById,
      },
      select: { id: true },
    });
    outboxRowId = row.id;
  }

  return {
    applied: true,
    oldSellingPrice,
    newSellingPrice,
    outboxRowId,
  };
}
