import { wibYearMonth } from "./marketplace-demand";
import type { DemandRow } from "./types";

/**
 * Consignment demand for the forecast, read from APPROVED, non-baseline konsi sell-through
 * reports. A line's billed units count minus its POS-sold units: every SPG POS sale already
 * writes `SalesHistory` (channel OFFLINE) at the moment of sale, so counting `billedQty` whole
 * would count those units twice. Demand lands on the WIB month of the report's `periodEnd`.
 */

export type KonsiReportLineInput = {
  itemId: string;
  itemSku: string;
  productName: string;
  billedQty: number;
  posSoldQty: number;
  unitPrice: number | null;
};

export type KonsiReportInput = {
  periodEnd: Date;
  lines: KonsiReportLineInput[];
};

export type KonsiDemandResult = {
  rows: DemandRow[];
  monthly: { year: number; month: number; qty: number }[];
};

export function buildKonsiDemand(reports: readonly KonsiReportInput[]): KonsiDemandResult {
  const rows: DemandRow[] = [];
  const qtyByMonth = new Map<string, { year: number; month: number; qty: number }>();

  for (const report of reports) {
    const { year, month } = wibYearMonth(report.periodEnd);
    for (const line of report.lines) {
      const qty = line.billedQty - line.posSoldQty;
      if (qty <= 0) continue;
      rows.push({
        parentSku: line.itemSku,
        productName: line.productName,
        netQuantity: qty,
        lineTotal: (line.unitPrice ?? 0) * qty,
        orderDate: report.periodEnd,
        year,
        month,
        itemId: line.itemId,
      });
      const key = `${year}-${month}`;
      const bucket = qtyByMonth.get(key) ?? { year, month, qty: 0 };
      bucket.qty += qty;
      qtyByMonth.set(key, bucket);
    }
  }

  return {
    rows,
    monthly: [...qtyByMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month),
  };
}
