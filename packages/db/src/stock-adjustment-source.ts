/**
 * Canonical registry of StockAdjustment.source values.
 *
 * `source` is a free-form String column in the schema; this registry is the
 * type-level contract. Any caller writing to StockAdjustment MUST use a value
 * from here. The audit dashboard and reconcile logic key off these strings.
 *
 * See docs/INTEGRATION-GUIDE.md §2 for which source applies to which workflow ("Which `source`
 * do I use?") and for the steps to add one ("Adding a new `source`").
 */
export const STOCK_ADJUSTMENT_SOURCES = [
  "ERP",
  "ERP_OPNAME",
  "ERP_RETURN_ACCEPT",
  "FULFILLMENT_CONSUME",
  "FIELD_SALES_CONSUME",
  "JUBELIO_WEBHOOK",
  "JUBELIO_RECONCILE",
  "VAN_LOAD",
  "VAN_RETURN",
  "SUPERSEDED_ITEM_RETIRE",
  "KONSI_TRANSFER",
  "FIELD_RETURN",
] as const;

export type StockAdjustmentSource = (typeof STOCK_ADJUSTMENT_SOURCES)[number];

export function isStockAdjustmentSource(value: unknown): value is StockAdjustmentSource {
  return (
    typeof value === "string" &&
    (STOCK_ADJUSTMENT_SOURCES as readonly string[]).includes(value)
  );
}
