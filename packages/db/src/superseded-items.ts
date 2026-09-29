import { AdjustmentType, Prisma, type PrismaClient } from "../generated/prisma/client";
import { setMainStock } from "./stock-balance";
import { lockMainInventoryValueRow } from "./stock-writer";
import type { StockAdjustmentSource } from "./stock-adjustment-source";
import type { StockLedgerRefType } from "./stock-ledger-ref";

/**
 * A superseded item is an `Item` with no `JubelioProductMapping` of its own whose every variant
 * is mapped to Jubelio on ANOTHER item. It happens when a later catalog ingest moves a product's
 * variant links onto a new item and leaves the old one behind: Jubelio's stock webhook then sets
 * only the new item, so the old item's `InventoryValue` rows are stock nothing governs — never
 * corrected, and able to erode when orders reserved against the old item consume after the move.
 *
 * Retiring one zeroes each of its stock rows through `setMainStock` (one `StockAdjustment` and
 * one ledger entry per non-zero row) and marks the item inactive. The item itself is kept: its
 * sales history still points at it.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type SupersededRefusal =
  | "NOT_FOUND"
  | "HAS_MAPPING"
  | "VARIANTLESS_ROW"
  | "VARIANT_NOT_SUPERSEDED"
  | "OPEN_RESERVATION"
  | "STORE_OR_VAN_STOCK";

export type SupersededCandidate = {
  itemId: string;
  sku: string;
  qualified: boolean;
  reason?: SupersededRefusal;
  rows: number;
  nonZeroRows: number;
  onHand: number;
  /* Item SKUs of the mapped items that now carry this item's variants. */
  twinSkus: string[];
};

export type RetireSupersededResult =
  | { retired: true; rowsZeroed: number }
  | { retired: false; reason: SupersededRefusal };

/** `StockAdjustment.reason` is `VARCHAR(191)`; a longer reason would throw on insert. */
const REASON_MAX = 191;

type ItemCheck = {
  sku: string;
  reason?: SupersededRefusal;
  rows: Array<{ id: string; variantSku: string | null; qtyOnHand: Prisma.Decimal }>;
  twinSkus: string[];
};

async function checkItem(db: Db, itemId: string): Promise<ItemCheck> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { sku: true } });
  if (!item) return { sku: "", reason: "NOT_FOUND", rows: [], twinSkus: [] };

  const rows = await db.inventoryValue.findMany({
    where: { itemId },
    select: { id: true, variantSku: true, qtyOnHand: true },
    orderBy: { id: "asc" },
  });
  const base = { sku: item.sku, rows };

  if ((await db.jubelioProductMapping.count({ where: { itemId } })) > 0) {
    return { ...base, reason: "HAS_MAPPING", twinSkus: [] };
  }
  if (rows.some((r) => (r.variantSku ?? "") === "")) {
    return { ...base, reason: "VARIANTLESS_ROW", twinSkus: [] };
  }

  const variants = rows.map((r) => r.variantSku as string);
  const twinMappings = variants.length === 0
    ? []
    : await db.jubelioProductMapping.findMany({
      where: { erpVariantSku: { in: variants }, itemId: { not: itemId } },
      select: { itemId: true, erpVariantSku: true },
    });
  /* The index is case-insensitive, so the match is too; see `matchKey` in the variant-rows helper. */
  const covered = new Set(twinMappings.map((m) => m.erpVariantSku.trim().toLowerCase()));
  const twinIds = [...new Set(twinMappings.map((m) => m.itemId))];
  const twins = twinIds.length === 0
    ? []
    : await db.item.findMany({ where: { id: { in: twinIds } }, select: { sku: true } });
  const twinSkus = twins.map((t) => t.sku).sort();

  if (variants.length === 0 || !variants.every((v) => covered.has(v.trim().toLowerCase()))) {
    return { ...base, reason: "VARIANT_NOT_SUPERSEDED", twinSkus };
  }
  if ((await db.stockReservation.count({ where: { itemId, state: "RESERVED" } })) > 0) {
    return { ...base, reason: "OPEN_RESERVATION", twinSkus };
  }
  const storeStock = await db.storeStock.count({ where: { itemId, qty: { not: 0 } } });
  const vanStock = await db.vanStock.count({ where: { itemId, qty: { not: 0 } } });
  if (storeStock > 0 || vanStock > 0) {
    return { ...base, reason: "STORE_OR_VAN_STOCK", twinSkus };
  }
  return { ...base, twinSkus };
}

/**
 * Every unmapped item holding at least one variant that is mapped on another item, each with
 * whether it qualifies for retirement and, if not, why. Read-only. `itemIds` scopes the result
 * (specs must pass it, since the test bed holds real dev data); omitted, it covers every item.
 */
export async function findSupersededItems(
  db: Db,
  opts: { itemIds?: string[] } = {},
): Promise<SupersededCandidate[]> {
  const candidateRows = await db.$queryRaw<Array<{ itemId: string }>>`
    SELECT DISTINCT iv.\`itemId\` AS itemId
    FROM \`InventoryValue\` iv
    WHERE iv.\`variantSku\` IS NOT NULL AND iv.\`variantSku\` <> ''
      AND NOT EXISTS (SELECT 1 FROM \`JubelioProductMapping\` own WHERE own.\`itemId\` = iv.\`itemId\`)
      AND EXISTS (
        SELECT 1 FROM \`JubelioProductMapping\` m
        WHERE m.\`erpVariantSku\` = iv.\`variantSku\` AND m.\`itemId\` <> iv.\`itemId\`
      )
  `;
  const scope = opts.itemIds === undefined ? null : new Set(opts.itemIds);
  const itemIds = candidateRows.map((r) => r.itemId).filter((id) => scope === null || scope.has(id)).sort();

  const result: SupersededCandidate[] = [];
  for (const itemId of itemIds) {
    const check = await checkItem(db, itemId);
    result.push({
      itemId,
      sku: check.sku,
      qualified: check.reason === undefined,
      ...(check.reason === undefined ? {} : { reason: check.reason }),
      rows: check.rows.length,
      nonZeroRows: check.rows.filter((r) => !new Prisma.Decimal(r.qtyOnHand.toString()).isZero()).length,
      onHand: check.rows.reduce((sum, r) => sum.plus(r.qtyOnHand.toString()), new Prisma.Decimal(0)).toNumber(),
      twinSkus: check.twinSkus,
    });
  }
  return result;
}

/**
 * Retires one superseded item in a single transaction: re-checks it qualifies, zeroes each
 * non-zero stock row on its locked row, and marks the item inactive. Idempotent — a row already
 * at zero is skipped, so a replay writes nothing — and every refusal returns before any write.
 */
export async function retireSupersededItem(
  prisma: PrismaClient,
  input: { itemId: string; actorId: string | null },
): Promise<RetireSupersededResult> {
  return prisma.$transaction(
    async (tx) => {
      const check = await checkItem(tx, input.itemId);
      if (check.reason !== undefined) return { retired: false, reason: check.reason };

      const reason = `Retired superseded duplicate item ${check.sku}: this variant's stock is governed on ${check.twinSkus.join(", ")}`
        .slice(0, REASON_MAX);
      let rowsZeroed = 0;
      for (const row of check.rows) {
        const locked = await lockMainInventoryValueRow(tx, input.itemId, row.variantSku);
        if (!locked) continue;
        const prevQty = new Prisma.Decimal(locked.qtyOnHand);
        if (prevQty.isZero()) continue;
        const avgCost = new Prisma.Decimal(locked.avgCost);

        const adjustment = await tx.stockAdjustment.create({
          data: {
            docNumber: `RETIRE-${locked.id}`,
            itemId: input.itemId,
            type: prevQty.gt(0) ? AdjustmentType.NEGATIVE : AdjustmentType.POSITIVE,
            qtyChange: prevQty.abs().toNumber(),
            reason,
            prevQty: prevQty.toNumber(),
            newQty: 0,
            prevAvgCost: avgCost.toNumber(),
            newAvgCost: avgCost.toNumber(),
            source: "ERP" satisfies StockAdjustmentSource,
            idempotencyKey: `retire-superseded:${locked.id}`,
            externalRef: "superseded-item-retire",
            createdById: input.actorId,
          },
          select: { id: true, docNumber: true },
        });

        await setMainStock(tx, {
          itemId: input.itemId,
          variantSku: row.variantSku,
          nextQty: 0,
          totalValue: 0,
          unitCost: avgCost.toNumber(),
          totalCost: prevQty.neg().mul(avgCost).toNumber(),
          balanceValue: 0,
          inventoryValueId: locked.id,
          refType: "StockAdjustment" satisfies StockLedgerRefType,
          refId: adjustment.id,
          refDocNumber: adjustment.docNumber,
          createdById: input.actorId,
        });
        rowsZeroed += 1;
      }

      await tx.item.update({ where: { id: input.itemId }, data: { isActive: false } });
      return { retired: true, rowsZeroed };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
