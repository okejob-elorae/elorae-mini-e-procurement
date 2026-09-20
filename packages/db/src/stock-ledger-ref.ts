/**
 * Canonical registry of StockLedgerEntry.refType values.
 *
 * `refType` is a free-form String column; this registry is the type-level contract.
 * Every writer that appends a ledger entry MUST use a value from here, and the
 * movement view's label map is keyed off this union, so a new member fails to
 * compile until it has operator-facing copy in both locales.
 *
 * NOT the same vocabulary as StockMovement.refType, which uses SCREAMING_SNAKE
 * ("ADJUSTMENT", "OPNAME", "RECON") and is a different model. Two files write both
 * a few lines apart — lib/reconciliation/umkm-opening-stock.ts and
 * lib/inventory/reconciliation-runner.ts — so never fold the two sets together.
 *
 * "OpeningBalance" is written by the cutover migration itself and has no document.
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
