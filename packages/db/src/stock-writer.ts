import { AdjustmentType, Prisma, type PrismaClient } from "../generated/prisma/client";
import { moveMainStock } from "./stock-balance";
import type { StockAdjustmentSource } from "./stock-adjustment-source";
import type { StockLedgerRefType } from "./stock-ledger-ref";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type ApplyJubelioStockAdjustmentInput = {
  itemId: string;
  /**
   * ERP variant SKU. Empty string `""` for variantless items (catalog-ingest convention). The
   * lookup below is OR-tolerant on a variantless row rather than a strict match on this exact
   * spelling — InventoryValue rows created through the ERP UI key a variantless row as null, not
   * "", so this input's own "" convention alone would miss those rows.
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
    const inv = input.variantSku
      ? await tx.inventoryValue.findFirst({
          where: { itemId: input.itemId, variantSku: input.variantSku },
        })
      : await tx.inventoryValue.findFirst({
          where: { itemId: input.itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
          orderBy: { id: "asc" },
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
        select: { id: true, docNumber: true },
      });

      await moveMainStock(tx, {
        itemId: input.itemId,
        variantSku: input.variantSku,
        qtyDelta: delta,
        totalValue: input.newQty * avgCost,
        totalCost: delta * avgCost,
        balanceValue: input.newQty * avgCost,
        inventoryValueId: inv.id,
        refType: "JubelioStockAdjustment" satisfies StockLedgerRefType,
        refId: created.id,
        refDocNumber: created.docNumber,
      });

      return { adjustmentId: created.id, skipped: false };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const target = err.meta?.target;
        const targets = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
        // MySQL/mariadb returns the INDEX NAME (e.g. "StockAdjustment_docNumber_key") in meta.target,
        // not the column name. Match either form.
        const isIdempotencyCollision = targets.some((t) => {
          const s = String(t);
          return /(^|_)(idempotencyKey|docNumber)(_|$)/.test(s) || s === "idempotencyKey" || s === "docNumber";
        });
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
