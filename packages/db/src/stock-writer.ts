import { AdjustmentType, Prisma, type PrismaClient } from "../generated/prisma/client";
import type { StockAdjustmentSource } from "./stock-adjustment-source";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type ApplyJubelioStockAdjustmentInput = {
  itemId: string;
  /**
   * ERP variant SKU. Empty string `""` for variantless items (catalog-ingest convention).
   * Never pass `null` — the helper's findUnique on the composite `(itemId, variantSku)` key
   * relies on the empty-string convention to match rows for variantless items.
   */
  variantSku: string;
  newQty: number;
  idempotencyKey: string;
  externalRef: string;
  reason: string;
};

export type ApplyJubelioStockAdjustmentResult = {
  adjustmentId: string | null;
  skipped: boolean;
};

export class InventoryValueMissingError extends Error {
  constructor(itemId: string, variantSku: string) {
    super(`InventoryValue not found for (itemId=${itemId}, variantSku="${variantSku}")`);
    this.name = "InventoryValueMissingError";
  }
}

export async function applyJubelioStockAdjustment(
  client: AnyClient,
  input: ApplyJubelioStockAdjustmentInput,
): Promise<ApplyJubelioStockAdjustmentResult> {
  const hasTransactionFn = typeof (client as PrismaClient).$transaction === "function";
  const run = async (tx: Prisma.TransactionClient): Promise<ApplyJubelioStockAdjustmentResult> => {
    const inv = await tx.inventoryValue.findUnique({
      where: { itemId_variantSku: { itemId: input.itemId, variantSku: input.variantSku } },
    });
    if (!inv) throw new InventoryValueMissingError(input.itemId, input.variantSku);

    const prevQty = Number(inv.qtyOnHand);
    const avgCost = Number(inv.avgCost);
    const delta = input.newQty - prevQty;
    const adjType: AdjustmentType = delta >= 0 ? AdjustmentType.POSITIVE : AdjustmentType.NEGATIVE;

    try {
      const created = await tx.stockAdjustment.create({
        data: {
          docNumber: `JBL-${input.idempotencyKey}`,
          itemId: input.itemId,
          type: adjType,
          qtyChange: delta,
          reason: input.reason,
          prevQty,
          newQty: input.newQty,
          prevAvgCost: avgCost,
          newAvgCost: avgCost,
          source: "JUBELIO_WEBHOOK" satisfies StockAdjustmentSource,
          idempotencyKey: input.idempotencyKey,
          externalRef: input.externalRef,
        },
        select: { id: true },
      });

      await tx.inventoryValue.update({
        where: { itemId_variantSku: { itemId: input.itemId, variantSku: input.variantSku } },
        data: {
          qtyOnHand: input.newQty,
          totalValue: input.newQty * avgCost,
          lastUpdated: new Date(),
        },
      });

      return { adjustmentId: created.id, skipped: false };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const target = err.meta?.target;
        const targets = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
        const isIdempotencyCollision =
          targets.includes("idempotencyKey") || targets.includes("docNumber");
        if (isIdempotencyCollision) {
          return { adjustmentId: null, skipped: true };
        }
      }
      throw err;
    }
  };

  if (hasTransactionFn) {
    return (client as PrismaClient).$transaction(run);
  }
  return run(client as Prisma.TransactionClient);
}
