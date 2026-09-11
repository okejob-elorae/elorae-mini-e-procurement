import { prisma } from "@elorae/db";

export type StockAcrossLocationsRow = {
  main: number;
  van: number;
  store: number;
  total: number;
};

/**
 * The single place that folds main + van + store stock. Nothing else may hand-roll this union.
 *
 * This is NOT the source of "available for sale". That stays InventoryValue.qtyOnHand minus
 * reservedQty, main-only. Store stock living in a table the marketplace path never reads is what
 * makes "virtual warehouse stock is excluded from available-for-sale" true by construction rather
 * than by remembering a filter — do not add an `available` field here.
 */
export async function getStockAcrossLocations(itemIds: string[]): Promise<Map<string, StockAcrossLocationsRow>> {
  const out = new Map<string, StockAcrossLocationsRow>();
  if (itemIds.length === 0) return out;

  /* InventoryValue is the only one of the three with a nullable variantSku, so normalise here. */
  const key = (itemId: string, variantSku: string | null) => `${itemId}::${variantSku ?? ""}`;
  const bump = (k: string, field: "main" | "van" | "store", n: number) => {
    const row = out.get(k) ?? { main: 0, van: 0, store: 0, total: 0 };
    row[field] += n;
    row.total += n;
    out.set(k, row);
  };

  const [main, van, store] = await Promise.all([
    prisma.inventoryValue.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, variantSku: true, qtyOnHand: true } }),
    prisma.vanStock.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, variantSku: true, qty: true } }),
    prisma.storeStock.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, variantSku: true, qty: true } }),
  ]);

  for (const r of main) bump(key(r.itemId, r.variantSku), "main", r.qtyOnHand.toNumber());
  for (const r of van) bump(key(r.itemId, r.variantSku), "van", r.qty.toNumber());
  for (const r of store) bump(key(r.itemId, r.variantSku), "store", r.qty.toNumber());

  return out;
}
