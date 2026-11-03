import {
  computeCommissionEvents,
  confirmedPieces,
  splitByLargestRemainder,
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
 * Per item × line category, each SPG's weight is her own sales minus her own notes' approved shopper
 * returns (counted in the ORIGINAL note's month, P9), never below zero; the confirmed pieces are
 * split over those weights by largest remainder. At a putus store the weights ARE the pieces. The
 * category is the one stored on the sale line at sale time (P8); a line with no category, or whose
 * category has no rate for the month, earns 0 and is reported as unrated.
 *
 * `Item.commissionPerPcs` is no source of any figure here, and the old equal split is gone (owner,
 * 2026-11-02: "jangan ada harga rata-rata"). A row not yet paid is paid at this figure; a row
 * already paid is never changed — its difference reaches the SPG as a correction on her next
 * payout (`lib/spg/koreksi.ts`).
 *
 * Client-safe: plain values in, plain values out; `laporan-queries.ts` loads the rows.
 */

export type SalesReportKind = "KONSI" | "PUTUS";

/**
 * One SPG sale line (+qty) or shopper-return line (−qty) of the sales month, credited to the seller of
 * the original note, with the category stored on the sale line (null: sold without one).
 */
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

/** Category key for ordering: a real id sorts by code unit, "no category" (null) sorts last. */
const NO_CATEGORY = "\uffff";
const categoryKey = (c: string | null) => c ?? NO_CATEGORY;

/**
 * The report as the team's computation reads it: one line per item × LINE CATEGORY (owner
 * 2026-11-02, P8 — a piece keeps the category stored on its sale line, so one item re-categorised
 * mid-month forms two lines, each at its own rate), its weights each SPG's net pieces (clamped at
 * zero), its POS figure their sum, and its billed figure:
 * - PUTUS: the POS figure itself — every recorded piece confirms.
 * - KONSI: per ITEM the official quantity caps the item's net POS pieces (`confirmedPieces`, the cap
 *   rule of today, unchanged), and `min(official, POS)` is split over the item's category lines by
 *   largest remainder on their net POS pieces, a tie going to the lower category id with "no
 *   category" last. Each line is billed its share.
 * Lines are ordered by item id then category (null last), weights by salesman id.
 */
export function toCommissionReport(report: SalesReport): CommissionReport {
  const byLine = new Map<string, { itemId: string; categoryId: string | null; perSpg: Map<string, number> }>();
  for (const m of report.movements) {
    if (!Number.isFinite(m.qty) || m.qty === 0) continue;
    const key = `${m.itemId}\u0000${m.categoryId ?? ""}`;
    let line = byLine.get(key);
    if (!line) {
      line = { itemId: m.itemId, categoryId: m.categoryId, perSpg: new Map() };
      byLine.set(key, line);
    }
    line.perSpg.set(m.salesmanId, (line.perSpg.get(m.salesmanId) ?? 0) + m.qty);
  }

  const official = new Map<string, number>();
  for (const o of report.official ?? []) {
    if (!Number.isFinite(o.qty) || o.qty <= 0) continue;
    official.set(o.itemId, (official.get(o.itemId) ?? 0) + o.qty);
  }

  const built = Array.from(byLine.values(), (line) => {
    const perSpgPosQty: SpgPosQty[] = Array.from(line.perSpg, ([salesmanId, qty]) => ({ salesmanId, qty }))
      .filter((w) => w.qty > 0)
      .sort((a, b) => compareId(a.salesmanId, b.salesmanId));
    const posQty = perSpgPosQty.reduce((n, w) => n + w.qty, 0);
    return { itemId: line.itemId, categoryId: line.categoryId, posQty, perSpgPosQty };
  }).filter((l) => l.posQty > 0);

  // KONSI: the item's confirmed pieces, split over its category lines by their POS pieces.
  const billedByLine = new Map<string, number>();
  if (report.official !== null) {
    const byItem = new Map<string, typeof built>();
    for (const l of built) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
    for (const [itemId, lines] of byItem) {
      const itemPos = lines.reduce((n, l) => n + l.posQty, 0);
      const confirmed = confirmedPieces({ posQty: itemPos, billedQty: official.get(itemId) ?? 0 });
      const shares = splitByLargestRemainder(
        confirmed,
        lines.map((l) => ({ salesmanId: categoryKey(l.categoryId), qty: l.posQty })),
      );
      const perCategory = new Map(shares.map((s) => [s.salesmanId, s.pieces]));
      for (const l of lines) billedByLine.set(`${itemId}\u0000${l.categoryId ?? ""}`, perCategory.get(categoryKey(l.categoryId)) ?? 0);
    }
  }

  const lines: CommissionReportLine[] = built
    .map((l) => ({
      itemId: l.itemId,
      variantSku: "",
      categoryId: l.categoryId,
      posQty: l.posQty,
      billedQty: report.official === null ? l.posQty : (billedByLine.get(`${l.itemId}\u0000${l.categoryId ?? ""}`) ?? 0),
      perSpgPosQty: l.perSpgPosQty,
    }))
    .sort((a, b) => compareId(a.itemId, b.itemId) || compareId(categoryKey(a.categoryId), categoryKey(b.categoryId)));

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

/**
 * Whether the report confirms at least one piece to some SPG — what "Tandai laporan dicek" and
 * "Tetapkan" need (`TANPA_PENJUALAN`, `TANPA_SPG`). A month whose sales were all returned by
 * shoppers confirms none. Pieces never depend on the rates, so none are read.
 */
export function confirmsAnyPiece(report: SalesReport): boolean {
  return commissionPerSpg(report, []).some((r) => r.pieces > 0);
}

/** The report's totals: confirmed pieces, whole-rupiah commission, and pieces without a rate. */
export function reportTotals(perSpg: readonly SpgReportCommission[]): { pieces: number; amount: number; noRatePieces: number } {
  return perSpg.reduce(
    (sum, r) => ({ pieces: sum.pieces + r.pieces, amount: sum.amount + r.amount, noRatePieces: sum.noRatePieces + r.noRatePieces }),
    { pieces: 0, amount: 0, noRatePieces: 0 },
  );
}
