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
  | "NOT_JUBELIO_INGEST"
  | "HAS_MAPPING"
  | "VARIANTLESS_ROW"
  | "VARIANT_NOT_SUPERSEDED"
  | "OPEN_RESERVATION"
  | "STORE_OR_VAN_STOCK"
  | "PENDING_RETURN";

export type SupersededCandidate = {
  itemId: string;
  sku: string;
  source: string;
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
  source: string;
  reason?: SupersededRefusal;
  rows: Array<{ id: string; variantSku: string | null; qtyOnHand: Prisma.Decimal; reservedQty: Prisma.Decimal }>;
  twinSkus: string[];
};

async function checkItem(db: Db, itemId: string): Promise<ItemCheck> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { sku: true, source: true } });
  if (!item) return { sku: "", source: "", reason: "NOT_FOUND", rows: [], twinSkus: [] };

  const rows = await db.inventoryValue.findMany({
    where: { itemId },
    select: { id: true, variantSku: true, qtyOnHand: true, reservedQty: true },
    orderBy: { id: "asc" },
  });
  const base = { sku: item.sku, source: item.source, rows };

  /*
   * Only a catalog-ingested item is superseded by a later ingest. An ERP-created item whose
   * variant SKUs happen to collide with mapped ones is a different problem, never retired here.
   */
  if (item.source !== "JUBELIO_INGEST") {
    return { ...base, reason: "NOT_JUBELIO_INGEST", twinSkus: [] };
  }
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
  /*
   * A variant counts as covered only when a mapped twin item exists AND holds its own stock row
   * for that variant: a mapping alone (orphaned under relationMode "prisma", or with no row) is
   * not something Jubelio's stock webhook can set, so the variant would be governed by nothing.
   */
  const twinIds = [...new Set(twinMappings.map((m) => m.itemId))];
  const twins = twinIds.length === 0
    ? []
    : await db.item.findMany({ where: { id: { in: twinIds } }, select: { id: true, sku: true } });
  const liveTwinIds = new Set(twins.map((t) => t.id));
  const twinRows = liveTwinIds.size === 0
    ? []
    : await db.inventoryValue.findMany({
      where: { itemId: { in: [...liveTwinIds] }, variantSku: { in: variants } },
      select: { itemId: true, variantSku: true },
    });
  const twinRowKeys = new Set(twinRows.map((r) => `${r.itemId}:${(r.variantSku ?? "").trim().toLowerCase()}`));
  /*
   * The column collation is case-insensitive, so the match is too; see `matchKey` in
   * `apps/web/lib/items/variant-rows.ts`.
   */
  const covered = new Set(
    twinMappings
      .filter((m) => twinRowKeys.has(`${m.itemId}:${m.erpVariantSku.trim().toLowerCase()}`))
      .map((m) => m.erpVariantSku.trim().toLowerCase()),
  );
  const twinSkus = twins.map((t) => t.sku).sort();

  if (variants.length === 0 || !variants.every((v) => covered.has(v.trim().toLowerCase()))) {
    return { ...base, reason: "VARIANT_NOT_SUPERSEDED", twinSkus };
  }
  const reservedHeld = rows.some((r) => !new Prisma.Decimal(r.reservedQty.toString()).isZero());
  if (reservedHeld || (await db.stockReservation.count({ where: { itemId, state: "RESERVED" } })) > 0) {
    return { ...base, reason: "OPEN_RESERVATION", twinSkus };
  }
  const storeStock = await db.storeStock.count({ where: { itemId, qty: { not: 0 } } });
  const vanStock = await db.vanStock.count({ where: { itemId, qty: { not: 0 } } });
  if (storeStock > 0 || vanStock > 0) {
    return { ...base, reason: "STORE_OR_VAN_STOCK", twinSkus };
  }
  /* Accepting a pending return line resolved to this item would write stock back onto a retired row. */
  if ((await db.salesReturnItem.count({ where: { itemId, decision: "PENDING" } })) > 0) {
    return { ...base, reason: "PENDING_RETURN", twinSkus };
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
      source: check.source,
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
 * Retires one superseded item in a single transaction: locks every one of its stock rows, then
 * re-checks it qualifies, zeroes each non-zero row, and marks the item inactive. A row already at
 * zero is skipped and an already inactive item is left as it is, so a replay writes nothing; every
 * refusal returns before any write.
 */
export async function retireSupersededItem(
  prisma: PrismaClient,
  input: { itemId: string; actorId: string | null },
): Promise<RetireSupersededResult> {
  return prisma.$transaction(
    async (tx) => {
      /*
       * The lock is the transaction's first statement, as in `applyJubelioStockAdjustment`: the
       * snapshot the plain reads below (and `setMainStock`'s own pre-read) see is taken after it,
       * so no concurrent writer can move a row between the check and its write. One statement
       * over every row also gives a single, deterministic lock order.
       */
      await tx.$queryRaw`
        SELECT \`id\` FROM \`InventoryValue\` WHERE \`itemId\` = ${input.itemId} ORDER BY \`id\` ASC FOR UPDATE
      `;
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
        /*
         * Keyed per attempt, not per row: if a later write puts stock back on a retired row, a
         * re-run zeroes it again under the next key instead of colliding with the first.
         */
        const attempt = (await tx.stockAdjustment.count({
          where: { idempotencyKey: { startsWith: `retire-superseded:${locked.id}:` } },
        })) + 1;

        const adjustment = await tx.stockAdjustment.create({
          data: {
            docNumber: `RETIRE-${locked.id}-${attempt}`,
            itemId: input.itemId,
            type: prevQty.gt(0) ? AdjustmentType.NEGATIVE : AdjustmentType.POSITIVE,
            qtyChange: prevQty.abs().toNumber(),
            reason,
            prevQty: prevQty.toNumber(),
            newQty: 0,
            prevAvgCost: avgCost.toNumber(),
            newAvgCost: avgCost.toNumber(),
            source: "SUPERSEDED_ITEM_RETIRE" satisfies StockAdjustmentSource,
            idempotencyKey: `retire-superseded:${locked.id}:${attempt}`,
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

      await tx.item.updateMany({ where: { id: input.itemId, isActive: true }, data: { isActive: false } });
      return { retired: true, rowsZeroed };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
