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
] as const;

export type StockLedgerRefType = (typeof STOCK_LEDGER_REF_TYPES)[number];

export function isStockLedgerRefType(value: unknown): value is StockLedgerRefType {
  return (
    typeof value === "string" &&
    (STOCK_LEDGER_REF_TYPES as readonly string[]).includes(value)
  );
}
