import { AdjustmentType, Prisma, type PrismaClient } from "../generated/prisma/client";
import {
  effectiveOfflineReservedQty,
  eloraeOnHandFromJubelio,
  isValidJubelioQty,
} from "./jubelio-stock-contract";
import { setMainStock } from "./stock-balance";
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
  /**
   * Jubelio's RAW `end_qty` for this variant, already validated by `parseJubelioQty`. The writer
   * turns it into the absolute target on-hand itself, inside its transaction and after locking the
   * row: `end_qty` plus the field-sales holds Jubelio has had netted out
   * (`effectiveOfflineReservedQty` — the holds while stock pushes are enabled, `0` while they are
   * off). Never a delta to increment by, and never pre-adjusted by the caller.
   */
  jubelioEndQty: number;
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

export type LockedInventoryValueRow = { id: string; qtyOnHand: string; avgCost: string };

/**
 * Locks the main `InventoryValue` row for one item/variant with `SELECT … FOR UPDATE` and returns
 * it, or `null` when there is none. Call it as the FIRST statement of the transaction whose later
 * reads and writes depend on that row, so no concurrent writer can move it in between.
 *
 * Same OR-tolerant shape as `findExistingInventoryValueRow` in apps/web, tie-break included: a
 * variantless lookup matches both the `null` and the `""` spelling and takes the lowest id. Only
 * the values are interpolated (parameterised by Prisma); the identifiers are static SQL text.
 * Decimals come back as strings so callers can do exact arithmetic on them.
 *
 * Each branch is one complete query with only scalar values, never a nested `Prisma.sql`
 * fragment. apps/web's build bundles the Prisma runtime into several server chunks that share one
 * client through `globalThis`, so the client in use can come from a different chunk's runtime than
 * the code building a fragment. Such a fragment is not recognised as SQL, is bound as a plain value,
 * and the `WHERE` silently matches nothing — which is how every reconciliation Match on a variant
 * row came back `NO_INVENTORY_ROW` on prod.
 */
export async function lockMainInventoryValueRow(
  tx: Prisma.TransactionClient,
  itemId: string,
  variantSku: string | null | undefined,
): Promise<LockedInventoryValueRow | null> {
  const rows = variantSku
    ? await tx.$queryRaw<{ id: string; qtyOnHand: unknown; avgCost: unknown }[]>`
        SELECT \`id\`, \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\`
        WHERE \`itemId\` = ${itemId} AND \`variantSku\` = ${variantSku}
        ORDER BY \`id\` ASC
        LIMIT 1
        FOR UPDATE
      `
    : await tx.$queryRaw<{ id: string; qtyOnHand: unknown; avgCost: unknown }[]>`
        SELECT \`id\`, \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\`
        WHERE \`itemId\` = ${itemId} AND (\`variantSku\` IS NULL OR \`variantSku\` = '')
        ORDER BY \`id\` ASC
        LIMIT 1
        FOR UPDATE
      `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, qtyOnHand: String(row.qtyOnHand), avgCost: String(row.avgCost) };
}

export async function applyJubelioStockAdjustment(
  client: AnyClient,
  input: ApplyJubelioStockAdjustmentInput,
): Promise<ApplyJubelioStockAdjustmentResult> {
  if (!isValidJubelioQty(input.jubelioEndQty)) {
    throw new Error(
      `applyJubelioStockAdjustment: invalid Jubelio end_qty ${input.jubelioEndQty} for item ${input.itemId}`,
    );
  }

  const hasTransactionFn = typeof (client as PrismaClient).$transaction === "function";
  const run = async (tx: Prisma.TransactionClient): Promise<ApplyJubelioStockAdjustmentResult> => {
    /*
     * The lock is the transaction's first statement: prevQty, the offline holds and the switch are
     * all read after it, and setMainStock's own pre-read (which the ledger delta comes from) sees
     * the same locked value, so the StockAdjustment row and the ledger entry cannot disagree.
     */
    const inv = await lockMainInventoryValueRow(tx, input.itemId, input.variantSku);
    if (!inv) throw new InventoryValueMissingError(input.itemId, input.variantSku);

    /*
     * A redelivered event is a no-op. The row lock above serialises two deliveries for the same
     * variant, so this read settles it; the P2002 catch below stays as the backstop.
     */
    const replay = await tx.stockAdjustment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (replay) return { adjustmentId: null, skipped: true };

    const offline = await effectiveOfflineReservedQty(tx, input.itemId, input.variantSku);
    const newQty = eloraeOnHandFromJubelio(input.jubelioEndQty, offline);

    const prevQty = Number(inv.qtyOnHand);
    const avgCost = Number(inv.avgCost);
    const delta = newQty - prevQty;
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
          newQty,
          prevAvgCost: avgCost,
          newAvgCost: avgCost,
          source: "JUBELIO_WEBHOOK" satisfies StockAdjustmentSource,
          idempotencyKey: input.idempotencyKey,
          externalRef: input.externalRef,
        },
        select: { id: true, docNumber: true },
      });

      /*
       * An absolute set, never a delta increment: newQty is the target on-hand, so setMainStock
       * writes that literal value on the row locked above. A zero delta writes no ledger entry
       * (setMainStock short-circuits) even though the StockAdjustment row above is still created.
       */
      await setMainStock(tx, {
        itemId: input.itemId,
        variantSku: input.variantSku,
        nextQty: newQty,
        totalValue: newQty * avgCost,
        totalCost: delta * avgCost,
        balanceValue: newQty * avgCost,
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
        /*
         * The mariadb adapter reports the constraint as the INDEX NAME
         * ("StockAdjustment_docNumber_key") rather than the column, and where it lands in `meta`
         * varies (not always `meta.target`), so search the message and the whole meta blob.
         */
        const haystack = `${err.message} ${JSON.stringify(err.meta ?? {})}`;
        if (/idempotencyKey|docNumber/.test(haystack)) {
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
