import type { Prisma } from "@elorae/db";

/**
 * Konsi quantity already approved for a store but not yet delivered to it — Σ(qty − deliveredQty
 * − cancelledQty) over the store's APPROVED konsi order lines, keyed `${itemId}::${variantSku}`.
 * Konsi stock reaches `StoreStock` only when a delivery shipment completes, so until then these
 * units are on nobody's store balance; an assortment-gap test that reads `StoreStock` alone would
 * report them as missing and invite the admin to send them twice. Both gap tests
 * (`listAssortmentGaps` and the approve-time `currentAssortmentGapKeys`) add this to on-hand, and
 * both go through this one helper so the two cannot disagree. Takes the caller's client so the
 * approve path reads inside its own transaction.
 */
export async function openKonsiQtyByKey(
  client: { fieldSalesOrderLine: Prisma.TransactionClient["fieldSalesOrderLine"] },
  storeId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  const open = new Map<string, number>();
  if (itemIds.length === 0) return open;
  const rows = await client.fieldSalesOrderLine.findMany({
    where: { itemId: { in: itemIds }, order: { storeId, orderType: "KONSI", status: "APPROVED" } },
    select: { itemId: true, variantSku: true, qty: true, deliveredQty: true, cancelledQty: true },
  });
  for (const row of rows) {
    const remaining = row.qty - row.deliveredQty - row.cancelledQty;
    if (remaining <= 0) continue;
    const key = `${row.itemId}::${row.variantSku ?? ""}`;
    open.set(key, (open.get(key) ?? 0) + remaining);
  }
  return open;
}
