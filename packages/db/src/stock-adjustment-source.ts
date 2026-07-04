/**
 * Canonical registry of StockAdjustment.source values.
 *
 * `source` is a free-form String column in the schema; this registry is the
 * type-level contract. Any caller writing to StockAdjustment MUST use a value
 * from here. The audit dashboard and reconcile logic key off these strings.
 *
 * See docs/INTEGRATION-GUIDE.md for which source applies to which workflow.
 */
export const STOCK_ADJUSTMENT_SOURCES = [
  "ERP",
  "ERP_OPNAME",
  "ERP_RETURN_ACCEPT",
  "FULFILLMENT_CONSUME",
  "FIELD_SALES_CONSUME",
  "JUBELIO_WEBHOOK",
  "JUBELIO_RECONCILE",
] as const;

export type StockAdjustmentSource = (typeof STOCK_ADJUSTMENT_SOURCES)[number];

export function isStockAdjustmentSource(value: unknown): value is StockAdjustmentSource {
  return (
    typeof value === "string" &&
    (STOCK_ADJUSTMENT_SOURCES as readonly string[]).includes(value)
  );
}
