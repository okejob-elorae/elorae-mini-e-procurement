/**
 * Canonical registry of StockLedgerEntry.refType values.
 *
 * `refType` is a free-form String column, and every append/mover input types it as a bare
 * `string` — so this registry is a CONVENTION backed by review, NOT a compiler-enforced
 * contract. A writer can pass a value that is not a member here today: it compiles, tsc is
 * silent, the label map is never consulted for it, and both read surfaces render the bare
 * identifier to an operator. The `satisfies StockLedgerRefType` annotations at the existing
 * call sites pin those sites only; they constrain nothing about a new one. The compiler
 * enters one step later and only if someone independently adds the member HERE: the movement
 * view's label map is a Record over this union, so a new member fails to compile until it has
 * a MESSAGE KEY. The key is not the copy — the locale strings themselves are caught by a
 * test, not by tsc. Adding a writer and adding its value here are two separate acts, and
 * nothing but review joins them.
 *
 * At least THREE tables carry a refType column over three unrelated vocabularies —
 * StockLedgerEntry (this one), StockMovement and RejectedGoodsLedger — and they OVERLAP:
 * at least one spelling is a valid member of more than one of them, written a few lines from
 * a ledger append in every path that writes both tables. Membership is therefore never a safe
 * way to tell which table a value came from, and feeding one table's values through another's
 * resolver half-resolves them — most fall back to the raw string, the colliding ones resolve,
 * and the result reads on screen as a missing locale key rather than as the vocabulary mix-up
 * it is. Never fold the sets together in either direction.
 *
 * "OpeningBalance" is written by the cutover migration itself and has no document. The
 * migration is a writer like any other: deriving which values are reachable at a given
 * location from the TypeScript writers alone misses it.
 *
 * A ledger `refType` is not always a literal sitting next to the mover call. Three
 * functions in apps/web/lib/inventory/costing.ts — calculateMovingAverage,
 * reverseMovingAverage, reverseInventoryValue — take a `ref: StockRef` parameter and
 * spread it (`...ref`) into their own internal moveMainStock call, so the literal that
 * actually reaches this column lives in the CALLER, one or more files away from any
 * mover name. "VendorReturn" (apps/web/app/actions/vendor-returns.ts, via
 * reverseInventoryValue) was missed on the first sweep for exactly this reason — a grep
 * for a refType literal near a mover call cannot see it. Re-derive this list by tracing
 * every caller of appendStockLedger/moveMainStock/moveStoreStock/moveVanStock/
 * setMainStock/setStoreStock AND every caller of those three costing.ts functions, not
 * by grepping for `refType:` near a mover name.
 */
export const STOCK_LEDGER_REF_TYPES = [
  "FGReceipt",
  "FieldReturn",
  "FieldSalesConsume",
  "FulfillmentConsume",
  "GRN",
  "JubelioStockAdjustment",
  "KonsiTransfer",
  "MaterialIssue",
  "OpeningBalance",
  "OpeningStock",
  "Reconciliation",
  "SalesReturn",
  "SpgSale",
  "StockAdjustment",
  "StockOpname",
  "StoreStocktake",
  "VanLoad",
  "VanReconcile",
  "VanSale",
  "VendorReturn",
] as const;

export type StockLedgerRefType = (typeof STOCK_LEDGER_REF_TYPES)[number];

export function isStockLedgerRefType(value: unknown): value is StockLedgerRefType {
  return (
    typeof value === "string" &&
    (STOCK_LEDGER_REF_TYPES as readonly string[]).includes(value)
  );
}
