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
  // POSITIVE rows for goods back in Gudang Utama when a shipment is refused at the store door or
  // cancelled whole (owner answers P16/P24/P40). Kept apart from KONSI_TRANSFER, which
  // `biayaSatuanKonsi` averages, and from FIELD_SALES_CONSUME.
  "KONSI_TRANSFER_RETURN",
  "FIELD_SALES_CONSUME_RETURN",
  "FIELD_RETURN",
  "STORE_RETURN_RECEIVE",
] as const;

export type StockAdjustmentSource = (typeof STOCK_ADJUSTMENT_SOURCES)[number];

export function isStockAdjustmentSource(value: unknown): value is StockAdjustmentSource {
  return (
    typeof value === "string" &&
    (STOCK_ADJUSTMENT_SOURCES as readonly string[]).includes(value)
  );
}
