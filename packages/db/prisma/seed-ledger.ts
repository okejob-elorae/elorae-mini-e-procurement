import type { Prisma } from "../generated/prisma/client";
import { appendStockLedger, normaliseVariantKey } from "../src/stock-ledger";

/**
 * Appends the OPENING ledger entry behind each listed InventoryValue row, spelled the way the
 * cutover migration spelled it (OPENING / OpeningBalance, refId = the row id, empty doc number,
 * qty = balanceQty = qtyOnHand, no cost columns: null means unreconstructible, so none is invented).
 *
 * Scoped strictly to the ids passed in: an empty list appends nothing and this never widens to all
 * rows. Rows are folded on the normalised key (itemId, COALESCE(variantSku, '')) and summed, as the
 * migration did, so an item holding both a null and a "" row gets one entry carrying both.
 * Idempotent: a key that already has an OPENING entry is skipped. Returns the count appended.
 */
export async function appendSeedOpeningBalances(
  tx: Prisma.TransactionClient,
  inventoryValueIds: string[],
): Promise<number> {
  if (inventoryValueIds.length === 0) return 0;

  const rows = await tx.inventoryValue.findMany({
    where: { id: { in: inventoryValueIds } },
    orderBy: { id: "asc" },
    select: { id: true, itemId: true, variantSku: true, qtyOnHand: true },
  });

  const buckets = new Map<string, { id: string; itemId: string; variantKey: string; qty: number }>();
  for (const row of rows) {
    const variantKey = normaliseVariantKey(row.variantSku);
    const key = `${row.itemId}\u0000${variantKey}`;
    const qty = Number(row.qtyOnHand);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.qty += qty;
    } else {
      buckets.set(key, { id: row.id, itemId: row.itemId, variantKey, qty });
    }
  }

  let appended = 0;
  for (const bucket of buckets.values()) {
    if (bucket.qty === 0) continue;

    const existing = await tx.stockLedgerEntry.findFirst({
      where: {
        locationType: "MAIN",
        locationId: "",
        itemId: bucket.itemId,
        variantSku: bucket.variantKey,
        type: "OPENING",
      },
      select: { id: true },
    });
    if (existing) continue;

    await appendStockLedger(tx, {
      location: { type: "MAIN" },
      itemId: bucket.itemId,
      variantSku: bucket.variantKey,
      type: "OPENING",
      qty: bucket.qty,
      balanceQty: bucket.qty,
      refType: "OpeningBalance",
      refId: bucket.id,
      refDocNumber: "",
    });
    appended += 1;
  }

  return appended;
}
