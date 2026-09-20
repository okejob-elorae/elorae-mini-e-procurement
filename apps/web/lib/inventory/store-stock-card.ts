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

export type StoreStockMovement = {
  id: string;
  /*
   * Raw StockLedgerEntry.refType — a free-form String column, not the narrowed
   * StockLedgerRefType union. A fixture row or a future writer that reaches StoreStock
   * before its registry entry lands still has to render here rather than being dropped or
   * throwing; the component resolves it to a label/badge through a guard with a fallback,
   * the same way ledgerRefMessageKey does.
   */
  refType: string;
  docNo: string;
  /**
   * Where clicking this row should navigate — the source document's own detail page, or
   * `null` when this refType has no known destination (an unregistered refType, or a
   * registered one this card has not been taught a URL for yet). `null` renders the row
   * with no link rather than guessing a URL that 404s.
   */
  href: string | null;
  occurredAt: Date;
  itemName: string;
  variantSku: string;
  qty: number;
};

export type StoreStockCardData = {
  rows: StoreStockRow[];
  negativeCount: number;
  movements: StoreStockMovement[];
  /** True when the movement fetch below hit `STORE_MOVEMENT_LIMIT` — older rows exist and were dropped. */
  movementsTruncated: boolean;
  movementLimit: number;
};

/**
 * Ceiling on movement rows fetched for one store's card, across every item and variant. The
 * fetch below is already ordered newest-first, so applying `take` here keeps the recent end
 * and drops the oldest rows for free — no re-sort needed, unlike the item-scoped ledger card's
 * QUERY_ENTRY_LIMIT. 500 matches the display cap that sibling card already renders per section
 * without pagination or virtualization, a size proven to render fine in this same Table
 * component. The ledger repoint widened this card's input set from just KonsiTransfer +
 * approved FieldReturnLine to every SPG sale, store stocktake (up to ~300 rows per approval)
 * and admin-return receipt line touching this store, so an active KONSI store can reach
 * roughly 4-5k ledger rows a year — well past what this unpaginated single table should hold.
 */
export const STORE_MOVEMENT_LIMIT = 500;

/**
 * True when the fetch returned exactly STORE_MOVEMENT_LIMIT rows — the `take` ceiling was
 * hit, so older rows exist beyond it and were dropped. Equality, not `>=`: the fetch is
 * already bounded by `take`, so `rowCount` can never exceed the limit. Same reasoning as
 * the item-scoped ledger card's `isQueryTruncated`, pulled out as its own function so the
 * comparison is unit-testable without seeding STORE_MOVEMENT_LIMIT rows on the shared bed.
 */
export function isStoreMovementsTruncated(rowCount: number): boolean {
  return rowCount === STORE_MOVEMENT_LIMIT;
}

/**
 * Resolves a movement's detail-page link from its ledger refType + refId. KonsiTransfer has
 * no detail page of its own, so it links to the order it was issued for, resolved via
 * `transferOrderIds` (a batched KonsiTransfer lookup — refId alone is the transfer's id, not
 * the order's). Every other known kind links straight to its own document by refId. Anything
 * else — a refType this card has not been taught, or one outside the registry entirely —
 * gets no link.
 */
function movementHref(refType: string, refId: string, transferOrderIds: Map<string, string>): string | null {
  switch (refType) {
    case "KonsiTransfer": {
      const orderId = transferOrderIds.get(refId);
      return orderId ? `/backoffice/field-sales-orders/${orderId}` : null;
    }
    case "FieldReturn":
      return `/backoffice/field-returns/${refId}`;
    case "SpgSale":
      return `/backoffice/spg-sales/${refId}`;
    case "StoreStocktake":
      return `/backoffice/store-stocktakes/${refId}`;
    default:
      return null;
  }
}

/**
 * Read-only view for the store detail page's konsi stock card. Combines the store's own
 * `StoreStock` ledger with `getStockAcrossLocations` for the "where else does this sit"
 * figure — main warehouse and van — never an "available" number (that helper deliberately
 * exposes none, and this must not invent one either).
 *
 * Movements come straight from `StockLedgerEntry` scoped to `locationType: "STORE"` and this
 * store's id — every writer that ever touches this store's balance shows up here (konsi
 * transfer, konsi retur, an SPG sale, a store stocktake, the admin-return receipt-time
 * decrement), not just the two documents the old list could join through. One consequence:
 * the ledger only starts at the cutover date, so this card shows LESS pre-cutover history than
 * it used to — the UI carries a standing note about that rather than trying to merge in the
 * old document-derived rows.
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

  const ledgerRows = await prisma.stockLedgerEntry.findMany({
    where: { locationType: "STORE", locationId: storeId },
    /*
     * Newest first, and now capped at STORE_MOVEMENT_LIMIT. The `take` ceiling on a
     * descending fetch drops the OLDEST rows first — the end an operator can afford to
     * lose, since this card's whole purpose is "what happened here recently", not a full
     * archive. Same reasoning as the item-scoped ledger card's queryTruncated.
     */
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: STORE_MOVEMENT_LIMIT,
    select: {
      id: true,
      itemId: true,
      variantSku: true,
      refType: true,
      refId: true,
      refDocNumber: true,
      qty: true,
      createdAt: true,
    },
  });

  /*
   * StockLedgerEntry carries no relation to Item (itemId is a plain string column, and
   * relationMode = "prisma" means no FK to join on regardless), so item names are a batched
   * lookup — same idiom as the store/user label lookups in stock-ledger-card.ts. Item ids here
   * may include ones no longer in `rows` (fully returned/depleted stock still has history).
   */
  const ledgerItemIds = Array.from(new Set(ledgerRows.map((r) => r.itemId)));
  const ledgerItems =
    ledgerItemIds.length > 0
      ? await prisma.item.findMany({ where: { id: { in: ledgerItemIds } }, select: { id: true, nameId: true } })
      : [];
  const itemNameById = new Map(ledgerItems.map((i) => [i.id, i.nameId]));

  /*
   * KonsiTransfer has no detail page of its own, so its movement links to the order it was
   * issued for — which means resolving refId (the transfer's own id) to its orderId via a
   * second batched lookup, never a join.
   */
  const transferRefIds = Array.from(
    new Set(ledgerRows.filter((r) => r.refType === "KonsiTransfer").map((r) => r.refId)),
  );
  const transfers =
    transferRefIds.length > 0
      ? await prisma.konsiTransfer.findMany({ where: { id: { in: transferRefIds } }, select: { id: true, orderId: true } })
      : [];
  const transferOrderIds = new Map(transfers.map((t) => [t.id, t.orderId]));

  const movements: StoreStockMovement[] = ledgerRows.map((r) => ({
    id: r.id,
    refType: r.refType,
    docNo: r.refDocNumber,
    href: movementHref(r.refType, r.refId, transferOrderIds),
    occurredAt: r.createdAt,
    /* An item the lookup missed (hard-deleted, in principle) still renders — the raw id
       rather than a dropped row, same fallback the ledger card's location resolution uses. */
    itemName: itemNameById.get(r.itemId) ?? r.itemId,
    variantSku: r.variantSku,
    qty: Number(r.qty),
  }));

  return {
    rows,
    negativeCount,
    movements,
    movementsTruncated: isStoreMovementsTruncated(ledgerRows.length),
    movementLimit: STORE_MOVEMENT_LIMIT,
  };
}
