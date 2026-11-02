import {
  computeCommissionEvents,
  type CommissionEvent,
  type CommissionRate,
  type CommissionReport,
  type CommissionReportLine,
  type SpgPosQty,
} from "./compute";
import { isYearMonth, wibYearMonth } from "./month";

/**
 * SPG commission per checked sales report — the one calculation every SPG's commission comes
 * from (owner decision 2026-11-01): the rate per item CATEGORY in force in the sales month
 * (Settings → Komisi SPG, `resolveRate`), times the pieces each SPG sold HERSELF. "Menu tim, dengan
 * tarif per kategori Rp 2.000: Ani Rp 40.000, Sari Rp 20.000" — Ani sold 20 and Sari 10 of the 30
 * the store sold, so each is paid for her own pieces, never an equal share. It applies to SPGs at
 * consignment AND putus stores.
 *
 * A sales report is one store × one WIB sales month that the office has CHECKED:
 * - KONSI: the consignment cycle, checked when the office locks its official figures
 *   (`kunciAngka`, `lib/konsinyasi/writer.ts`). A line confirms the smaller of the official sold
 *   quantity and what the SPGs recorded at the till, as the team's sell-through rule did
 *   (`confirmedPieces`): pieces the store reported but no SPG recorded are no SPG's sale.
 * - PUTUS: the store's SPG sales of the month (`SpgSale`), checked with "Tandai laporan dicek" on
 *   Komisi SPG (`SpgSalesCheck`). There is no second count, so every recorded piece confirms.
 *
 * Commission belongs to the sales month but is PAID in the month the report was checked, with the
 * sales month as its note: October sales checked on 5 November are paid in November as "Komisi
 * penjualan Oktober 2026" (`payoutMonth`, `salesMonthNoteId`). The rate is the SALES month's, which
 * Settings → Komisi SPG closes once the month is over (`setRate` refuses a past month), so the
 * check date never moves an amount.
 *
 * Per item, each SPG's weight is her own sales minus her own notes' shopper returns of the month,
 * never below zero; the confirmed pieces are split over those weights by largest remainder. At a
 * putus store the weights ARE the pieces. A sale whose item has no category, or whose category has
 * no rate for the month, earns 0 and is reported as unrated.
 *
 * `Item.commissionPerPcs` and the old equal split (`bagiKomisi`) are no source of any figure here.
 *
 * Client-safe: plain values in, plain values out; `laporan-queries.ts` loads the rows.
 */

export type SalesReportKind = "KONSI" | "PUTUS";

/** One SPG sale line (+qty) or shopper-return line (−qty) of the sales month, credited to the seller of the original note. */
export type SpgSaleMovement = { salesmanId: string; itemId: string; categoryId: string | null; qty: number };

export type SalesReport = {
  /* `konsi:<cycleId>` or `putus:<storeId>:<salesMonth>` (`konsiReportKey`, `putusReportKey`). */
  key: string;
  kind: SalesReportKind;
  storeId: string;
  /* The WIB month (`"YYYY-MM"`) the goods were sold in. */
  salesMonth: string;
  /* When the office checked the report: the cycle's lock, the putus month's check. Fixes the payout month. */
  checkedAt: Date;
  /* KONSI: the locked official sold quantities per item; null for PUTUS, which has no second count. */
  official: ReadonlyArray<{ itemId: string; qty: number }> | null;
  movements: readonly SpgSaleMovement[];
};

export const konsiReportKey = (cycleId: string) => `konsi:${cycleId}`;
export const putusReportKey = (storeId: string, salesMonth: string) => `putus:${storeId}:${salesMonth}`;

/** The WIB month a report checked at `checkedAt` is paid in. */
export function payoutMonth(checkedAt: Date): string {
  return wibYearMonth(checkedAt);
}

const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** "2026-10" → "Oktober 2026", fixed Indonesian names so server text never depends on the host's ICU. */
export function salesMonthLabelId(yearMonth: string): string {
  if (!isYearMonth(yearMonth)) return yearMonth;
  const [year, month] = yearMonth.split("-").map(Number);
  return `${MONTH_NAMES_ID[month - 1]} ${year}`;
}

/** The note a payout carries in kabar and audit text: "Komisi penjualan Oktober 2026". */
export function salesMonthNoteId(salesMonth: string): string {
  return `Komisi penjualan ${salesMonthLabelId(salesMonth)}`;
}

const compareId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * The report as the team's computation reads it: one line per item, its weights each SPG's net
 * pieces (clamped at zero), its POS figure their sum, and its billed figure the official quantity
 * (KONSI) or the POS figure itself (PUTUS). Lines are ordered by item id, weights by salesman id.
 */
export function toCommissionReport(report: SalesReport): CommissionReport {
  const byItem = new Map<string, { categoryId: string | null; perSpg: Map<string, number> }>();
  for (const m of report.movements) {
    if (!Number.isFinite(m.qty) || m.qty === 0) continue;
    let item = byItem.get(m.itemId);
    if (!item) {
      item = { categoryId: m.categoryId, perSpg: new Map() };
      byItem.set(m.itemId, item);
    }
    if (item.categoryId === null && m.categoryId !== null) item.categoryId = m.categoryId;
    item.perSpg.set(m.salesmanId, (item.perSpg.get(m.salesmanId) ?? 0) + m.qty);
  }

  const official = new Map<string, number>();
  for (const o of report.official ?? []) {
    if (!Number.isFinite(o.qty) || o.qty <= 0) continue;
    official.set(o.itemId, (official.get(o.itemId) ?? 0) + o.qty);
  }

  const lines: CommissionReportLine[] = Array.from(byItem, ([itemId, item]) => {
    const perSpgPosQty: SpgPosQty[] = Array.from(item.perSpg, ([salesmanId, qty]) => ({ salesmanId, qty }))
      .filter((w) => w.qty > 0)
      .sort((a, b) => compareId(a.salesmanId, b.salesmanId));
    const posQty = perSpgPosQty.reduce((n, w) => n + w.qty, 0);
    return {
      itemId,
      variantSku: "",
      categoryId: item.categoryId,
      posQty,
      billedQty: report.official === null ? posQty : official.get(itemId) ?? 0,
      perSpgPosQty,
    };
  })
    .filter((l) => l.posQty > 0)
    .sort((a, b) => compareId(a.itemId, b.itemId));

  return {
    id: report.key,
    storeId: report.storeId,
    baseline: false,
    approvedAt: report.checkedAt,
    voidedAt: null,
    salesMonth: report.salesMonth,
    lines,
  };
}

/** Every commission event of the given checked reports, dated in each report's payout month. */
export function salesReportEvents(reports: readonly SalesReport[], rates: readonly CommissionRate[]): CommissionEvent[] {
  return computeCommissionEvents(reports.map(toCommissionReport), rates);
}

export type SpgReportCommission = {
  salesmanId: string;
  /* Confirmed pieces credited to this SPG. */
  pieces: number;
  /* Whole rupiah: Σ pieces × the sales month's category rate. */
  amount: number;
  /* Pieces of hers that earned nothing for want of a category or a rate. */
  noRatePieces: number;
};

/** One report's commission per SPG, ordered by salesman id; an SPG with no confirmed piece is absent. */
export function commissionPerSpg(report: SalesReport, rates: readonly CommissionRate[]): SpgReportCommission[] {
  const bySpg = new Map<string, SpgReportCommission>();
  for (const event of salesReportEvents([report], rates)) {
    if (event.kind !== "EARNED") continue;
    const row = bySpg.get(event.salesmanId) ?? { salesmanId: event.salesmanId, pieces: 0, amount: 0, noRatePieces: 0 };
    row.pieces += event.pieces;
    row.amount += event.amount;
    if (event.ratePerPiece === null) row.noRatePieces += event.pieces;
    bySpg.set(event.salesmanId, row);
  }
  return Array.from(bySpg.values()).sort((a, b) => compareId(a.salesmanId, b.salesmanId));
}

/** The report's totals: confirmed pieces, whole-rupiah commission, and pieces without a rate. */
export function reportTotals(perSpg: readonly SpgReportCommission[]): { pieces: number; amount: number; noRatePieces: number } {
  return perSpg.reduce(
    (sum, r) => ({ pieces: sum.pieces + r.pieces, amount: sum.amount + r.amount, noRatePieces: sum.noRatePieces + r.noRatePieces }),
    { pieces: 0, amount: 0, noRatePieces: 0 },
  );
}
