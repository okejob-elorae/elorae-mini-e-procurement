import { prisma } from "@elorae/db";
import { variantDetailForSku } from "@/lib/items/variants";

export type AssortmentLineRow = {
  id: string;
  itemId: string;
  itemSku: string;
  productName: string;
  variantSku: string;
  variantLabel: string | null;
  targetQty: number | null;
  createdAt: Date;
};

/**
 * The store's configured assortment, for the CRUD screen. One row per `StoreAssortmentLine` —
 * this never touches `StoreStock`, so it is safe to call even for a store that has never
 * received a single unit of any line on it.
 */
export async function listAssortmentLines(storeId: string): Promise<AssortmentLineRow[]> {
  const rows = await prisma.storeAssortmentLine.findMany({
    where: { storeId },
    orderBy: [{ item: { sku: "asc" } }, { variantSku: "asc" }],
    select: {
      id: true,
      itemId: true,
      variantSku: true,
      targetQty: true,
      createdAt: true,
      item: { select: { sku: true, nameId: true, variants: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    itemSku: r.item.sku,
    productName: r.item.nameId,
    variantSku: r.variantSku,
    variantLabel: variantDetailForSku(r.item.variants, r.variantSku),
    targetQty: r.targetQty === null ? null : r.targetQty.toNumber(),
    createdAt: r.createdAt,
  }));
}

export type AssortmentGapRow = {
  itemId: string;
  variantSku: string;
  productName: string;
  itemSku: string;
  onHandQty: number;
  targetQty: number | null;
};

/**
 * Compares the store's assortment against its `StoreStock` ledger to answer "what is this store
 * supposed to have that it doesn't?"
 *
 * A `StoreAssortmentLine` with NO matching `StoreStock` row at all is the never-received case —
 * the single most important gap this feature exists to surface — so the ledger is read as one
 * batched `findMany` keyed into a `${itemId}::${variantSku}` map rather than joined, and a key
 * with no entry resolves to `onHandQty: 0`. An inner join would silently drop that row instead
 * of reporting it as a gap.
 *
 * `targetQty === null` means "must merely be present" — the gap test is `onHandQty <= 0`, never
 * coerced through a `?? 0` on `targetQty` itself (that would turn "must be present" into "never
 * a gap", since `qty >= 0` holds for every non-negative row). `targetQty !== null` means the gap
 * test is `onHandQty < targetQty`.
 *
 * Grain is per assortment line, i.e. per (itemId, variantSku) — never aggregated to item level.
 * Two variants of one item are two independent lines and two independent `StoreStock` rows; one
 * stocked and one not must produce exactly one gap.
 */
export async function listAssortmentGaps(storeId: string): Promise<AssortmentGapRow[]> {
  const lines = await prisma.storeAssortmentLine.findMany({
    where: { storeId },
    select: {
      itemId: true,
      variantSku: true,
      targetQty: true,
      item: { select: { sku: true, nameId: true } },
    },
  });
  if (lines.length === 0) return [];

  const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
  const stockRows = await prisma.storeStock.findMany({
    where: { storeId, itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qty: true },
  });
  const onHandByKey = new Map(stockRows.map((r) => [`${r.itemId}::${r.variantSku}`, r.qty.toNumber()]));

  const gaps: AssortmentGapRow[] = [];
  for (const line of lines) {
    const onHandQty = onHandByKey.get(`${line.itemId}::${line.variantSku}`) ?? 0;
    const targetQty = line.targetQty === null ? null : line.targetQty.toNumber();
    const isGap = targetQty === null ? onHandQty <= 0 : onHandQty < targetQty;
    if (!isGap) continue;
    gaps.push({
      itemId: line.itemId,
      variantSku: line.variantSku,
      productName: line.item.nameId,
      itemSku: line.item.sku,
      onHandQty,
      targetQty,
    });
  }
  return gaps;
}
