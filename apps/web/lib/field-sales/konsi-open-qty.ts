import type { Prisma } from "@elorae/db";

/**
 * Konsi quantity approved for a store but not yet on its shelf — keyed `${itemId}::${variantSku}`,
 * the sum of two parts:
 *
 * - Σ(qty − deliveredQty − cancelledQty) over the store's APPROVED konsi order lines: not yet put
 *   on any shipment;
 * - Σ(qty − returnedQty) over the lines of the store's IN_TRANSIT konsi transfers: shipped (the
 *   order line already counts them as delivered, since Gudang Utama gives them up when the surat
 *   jalan is made) but not yet received by the store, so they are in neither StoreStock nor the
 *   order's remainder.
 *
 * Konsi stock reaches `StoreStock` only when the store receives its shipment, so until then these
 * units are on nobody's store balance; an assortment-gap test that reads `StoreStock` alone would
 * report them as missing and invite the admin to send them twice. Both gap tests
 * (`listAssortmentGaps` and the approve-time `currentAssortmentGapKeys`) add this to on-hand, and
 * both go through this one helper so the two cannot disagree. Takes the caller's client so the
 * approve path reads inside its own transaction.
 */
export async function openKonsiQtyByKey(
  client: {
    fieldSalesOrderLine: Prisma.TransactionClient["fieldSalesOrderLine"];
    konsiTransferLine: Prisma.TransactionClient["konsiTransferLine"];
  },
  storeId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  const open = new Map<string, number>();
  if (itemIds.length === 0) return open;
  const [rows, transit] = await Promise.all([
    client.fieldSalesOrderLine.findMany({
      where: { itemId: { in: itemIds }, order: { storeId, orderType: "KONSI", status: "APPROVED" } },
      select: { itemId: true, variantSku: true, qty: true, deliveredQty: true, cancelledQty: true },
    }),
    client.konsiTransferLine.findMany({
      where: { itemId: { in: itemIds }, transfer: { storeId, status: "IN_TRANSIT" } },
      select: { itemId: true, variantSku: true, qty: true, returnedQty: true },
    }),
  ]);
  const add = (itemId: string, variantSku: string | null, n: number) => {
    if (n <= 0) return;
    const key = `${itemId}::${variantSku ?? ""}`;
    open.set(key, (open.get(key) ?? 0) + n);
  };
  for (const row of rows) add(row.itemId, row.variantSku, row.qty - row.deliveredQty - row.cancelledQty);
  for (const row of transit) add(row.itemId, row.variantSku, Number(row.qty) - row.returnedQty);
  return open;
}
