import { wibYearMonth } from "./marketplace-demand";
import type { DemandRow } from "./types";

export type SalesHistoryDemandRecord = {
  parentSku: string;
  productName: string;
  netQuantity: number;
  lineTotal: number;
  orderDate: Date;
  itemId: string | null;
  /** True when the row resolved to a catalog item (`resolutionStatus = MAPPED`). */
  mapped: boolean;
};

/**
 * Folds `SalesHistory` rows into one demand row per article per WIB month. A mapped row groups
 * by its item, an unmapped one by its own parent SKU. The month is part of the key: grouping by
 * article alone put an item's whole history on the month of its first row, which flattened the
 * monthly series the base rate and seasonal indices are computed from.
 */
export function salesHistoryToDemandRows(records: readonly SalesHistoryDemandRecord[]): DemandRow[] {
  const grouped = new Map<string, DemandRow>();

  for (const r of records) {
    const { year, month } = wibYearMonth(r.orderDate);
    const article = r.itemId && r.mapped ? `item:${r.itemId}` : `sku:${r.parentSku}`;
    const key = `${article}|${year}-${month}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.netQuantity += r.netQuantity;
      existing.lineTotal += r.lineTotal;
    } else {
      grouped.set(key, {
        parentSku: r.parentSku,
        productName: r.productName,
        netQuantity: r.netQuantity,
        lineTotal: r.lineTotal,
        orderDate: r.orderDate,
        year,
        month,
        itemId: r.itemId && r.mapped ? r.itemId : null,
      });
    }
  }

  return [...grouped.values()];
}
