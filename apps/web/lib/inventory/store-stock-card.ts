import { prisma } from "@elorae/db";
import { getStockAcrossLocations } from "./stock-across-locations";

export type StoreStockRow = {
  itemId: string;
  variantSku: string;
  itemName: string;
  /** Can be negative — a konsi retur is allowed to drive this below zero, by design. */
  qty: number;
  mainQty: number;
  vanQty: number;
};

export type StoreStockMovementKind = "TRANSFER_IN" | "RETUR_OUT";

export type StoreStockMovement = {
  id: string;
  kind: StoreStockMovementKind;
  docNo: string;
  /** Where clicking this row should navigate — the source document's own detail page. */
  href: string;
  occurredAt: Date;
  itemName: string;
  variantSku: string;
  qty: number;
};

export type StoreStockCardData = {
  rows: StoreStockRow[];
  negativeCount: number;
  movements: StoreStockMovement[];
};

/**
 * Read-only view for the store detail page's konsi stock card. Combines the store's own
 * `StoreStock` ledger with `getStockAcrossLocations` for the "where else does this sit"
 * figure — main warehouse and van — never an "available" number (that helper deliberately
 * exposes none, and this must not invent one either).
 *
 * Movements are derived from the two documents that actually move store stock, never a new
 * ledger table: `KonsiTransferLine` rows (stock in, one per konsi transfer) and `FieldReturnLine`
 * rows on an APPROVED retur (stock out, credited qty — the same figure the writer itself
 * decremented by). Each links back to the document that caused it: a transfer has no detail
 * page of its own, so it links to the order it was issued for; a retur links to its own detail
 * page.
 */
export async function getStoreStockCard(storeId: string): Promise<StoreStockCardData> {
  const stockRows = await prisma.storeStock.findMany({
    where: { storeId },
    select: { itemId: true, variantSku: true, qty: true, item: { select: { nameId: true } } },
  });

  const itemIds = Array.from(new Set(stockRows.map((r) => r.itemId)));
  const elsewhere = await getStockAcrossLocations(itemIds);

  const rows: StoreStockRow[] = stockRows.map((r) => {
    const loc = elsewhere.get(`${r.itemId}::${r.variantSku}`);
    return {
      itemId: r.itemId,
      variantSku: r.variantSku,
      itemName: r.item.nameId,
      qty: r.qty.toNumber(),
      mainQty: loc?.main ?? 0,
      vanQty: loc?.van ?? 0,
    };
  });

  /* Negative rows sort first, then alphabetically by item + variant. */
  rows.sort((a, b) => {
    if (a.qty < 0 && b.qty >= 0) return -1;
    if (a.qty >= 0 && b.qty < 0) return 1;
    return a.itemName.localeCompare(b.itemName) || a.variantSku.localeCompare(b.variantSku);
  });

  const negativeCount = rows.filter((r) => r.qty < 0).length;

  const [transferLines, returnLines] = await Promise.all([
    prisma.konsiTransferLine.findMany({
      where: { transfer: { storeId } },
      select: {
        id: true,
        productName: true,
        variantSku: true,
        qty: true,
        transfer: { select: { docNo: true, createdAt: true, orderId: true } },
      },
    }),
    prisma.fieldReturnLine.findMany({
      where: { returnDoc: { storeId, status: "APPROVED" } },
      select: {
        id: true,
        variantSku: true,
        creditedQty: true,
        item: { select: { nameId: true } },
        returnDoc: { select: { id: true, docNo: true, approvedAt: true, createdAt: true } },
      },
    }),
  ]);

  const movements: StoreStockMovement[] = [
    ...transferLines.map((l): StoreStockMovement => ({
      id: `ktrf-${l.id}`,
      kind: "TRANSFER_IN",
      docNo: l.transfer.docNo,
      href: `/backoffice/field-sales-orders/${l.transfer.orderId}`,
      occurredAt: l.transfer.createdAt,
      itemName: l.productName,
      variantSku: l.variantSku,
      qty: l.qty.toNumber(),
    })),
    ...returnLines
      .filter((l) => l.creditedQty !== null && l.creditedQty > 0)
      .map((l): StoreStockMovement => ({
        id: `fret-${l.id}`,
        kind: "RETUR_OUT",
        docNo: l.returnDoc.docNo,
        href: `/backoffice/field-returns/${l.returnDoc.id}`,
        /* approvedAt is when the decrement actually happened; falls back only for a row that
           somehow reads APPROVED with no stamped approvedAt. */
        occurredAt: l.returnDoc.approvedAt ?? l.returnDoc.createdAt,
        itemName: l.item.nameId,
        variantSku: l.variantSku,
        qty: l.creditedQty as number,
      })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  return { rows, negativeCount, movements };
}
