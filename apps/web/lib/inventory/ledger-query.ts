import { Prisma } from "@elorae/db";

/**
 * The columns both `StockLedgerEntry` readers need — the item-scoped movement card
 * (`stock-ledger-card.ts`) and the store-scoped movement list (`store-stock-card.ts`).
 * This is deliberately the INTERSECTION, not the union: the item card additionally needs
 * `locationType`/`locationId`/`balanceQty`/`unitCost`/`createdById` (it groups by location
 * and reads a running balance) and the store card additionally needs `itemId` (it is
 * already scoped to one store, so it needs to know which item moved). Each caller spreads
 * this block and adds its own extras rather than one bloated block both over-select from —
 * over-selecting is how a payload quietly grows.
 */
export const LEDGER_ROW_SELECT = {
  id: true,
  variantSku: true,
  refType: true,
  refId: true,
  refDocNumber: true,
  qty: true,
  createdAt: true,
};

/**
 * Newest-first, id as tiebreaker. DESCENDING is load-bearing wherever this is paired with a
 * `take` ceiling: the ceiling then drops the OLDEST rows, so the recent end — and any running
 * balance read off the last row — survives truncation. An ascending fetch under the same
 * ceiling would keep the oldest rows and silently make the visible balance wrong.
 */
export const LEDGER_ORDER_BY: Prisma.StockLedgerEntryOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

/**
 * True when a fetch capped with `take: limit` returned exactly `limit` rows — the ceiling
 * was hit, so rows beyond it exist and were dropped. Equality, not `>=`: `take` caps the
 * fetch itself, so `rowCount` can never exceed `limit`; testing for exact equality is just
 * being explicit about which comparison is meaningful. This can false-positive when the true
 * total is exactly `limit` (nothing was actually dropped) — the harmless direction: it
 * over-warns rather than under-warns, the trade every truncation notice on these audit
 * surfaces wants.
 *
 * This is NOT the same test as a display cap over a fully-known count (see
 * `isSectionTruncated` in `stock-ledger-card.ts`), which is deliberately `>` instead — do not
 * fold the two together.
 */
export function isCeilingReached(rowCount: number, limit: number): boolean {
  return rowCount === limit;
}
