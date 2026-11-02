import type { SpgReportCommission } from "./payout";

/**
 * What the recap shows as PAID next to what the computation reads today, per SPG per report.
 *
 * The figure that is paid is the one the office stored when it set the commission: a consignment
 * cycle's `ConsignmentCommission.commission`, written when its official figures are locked, and a
 * putus month's `SpgCommission.commission`, written by "Tetapkan" on Komisi SPG. The computation
 * (`payout.ts`) re-reads the reports' current inputs, so it moves when a receipt or a shopper
 * return syncs after the lock or the set, and it never reproduces a cycle locked, or a month set,
 * under the old rule (item rate, equal split). The recap therefore never presents the computation
 * as the paid figure: it shows the stored one, the computation beside it, and flags a difference
 * the way Komisi SPG does. A checked putus month with no stored rows is "belum ditetapkan" — nothing
 * is set, so nothing is paid.
 *
 * Client-safe: plain values in, plain values out.
 */

export type PayoutStatus = "BELUM_DITETAPKAN" | "DITETAPKAN" | "DIBAYAR";

/** One SPG's stored commission on one report. */
export type StoredSpgCommission = {
  salesmanId: string;
  /* Gross whole rupiah as stored, before any lost-goods deduction. */
  commission: number;
  /* Pieces stored with it: putus only. Null for konsi, which stores no pieces per SPG. */
  pieces: number | null;
  /* Set under the old rule (item rate, equal split): always a difference. */
  oldRule: boolean;
  paid: boolean;
};

export type PayoutReportInput = {
  key: string;
  kind: "KONSI" | "PUTUS";
  storeId: string;
  salesMonth: string;
  /* The report's stored rows; null for a checked putus month the office has not set yet. */
  stored: readonly StoredSpgCommission[] | null;
  /* The computation of the same report (`commissionPerSpg`). */
  computed: readonly SpgReportCommission[];
};

export type PayoutLine = {
  reportKey: string;
  kind: "KONSI" | "PUTUS";
  storeId: string;
  salesMonth: string;
  salesmanId: string;
  status: PayoutStatus;
  /* The stored figure — what is paid. Null while the report is not set; 0 for an SPG the set report has no row for. */
  setAmount: number | null;
  /* The computation's figure for her today. */
  computedAmount: number;
  computedPieces: number;
  computedNoRatePieces: number;
  /* Stored and computed disagree; never true for a report that is not set yet (that is `BELUM_DITETAPKAN`). */
  differs: boolean;
};

export type PayoutTotals = {
  /* Σ stored figures. */
  setAmount: number;
  /* Σ computed figures of reports not set yet: paid only once the office sets them. */
  unsetAmount: number;
  /* Σ stored figures already marked paid. */
  paidAmount: number;
  differs: boolean;
  hasUnset: boolean;
};

const sameCents = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

const compareId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * One line per SPG per report: every SPG the computation credits with a piece, plus every SPG
 * with a stored row — a konsi row only when its commission is not zero (a salaried SPG who sold
 * nothing has a Rp 0 row that is no commission), a putus row always (each one was set for pieces).
 * A konsi line differs when the amounts differ to the cent, as Komisi SPG compares a cycle; a putus
 * line also when only one side has her, the pieces differ, or the row was set under the old rule,
 * as `sudahBerbeda` does, so a report flagged there has at least one flagged line here. Lines keep the report order, then
 * salesman id.
 */
export function payoutLinesOf(reports: readonly PayoutReportInput[]): PayoutLine[] {
  const lines: PayoutLine[] = [];
  for (const report of reports) {
    const computed = new Map(report.computed.filter((c) => c.pieces > 0).map((c) => [c.salesmanId, c]));
    const stored = new Map((report.stored ?? []).map((s) => [s.salesmanId, s]));
    const relevantStored = [...stored.values()].filter((s) => report.kind === "PUTUS" || !sameCents(s.commission, 0));
    const ids = [...new Set([...computed.keys(), ...relevantStored.map((s) => s.salesmanId)])].sort(compareId);
    for (const salesmanId of ids) {
      const c = computed.get(salesmanId);
      const s = stored.get(salesmanId);
      const computedAmount = c?.amount ?? 0;
      const computedPieces = c?.pieces ?? 0;
      const base = {
        reportKey: report.key,
        kind: report.kind,
        storeId: report.storeId,
        salesMonth: report.salesMonth,
        salesmanId,
        computedAmount,
        computedPieces,
        computedNoRatePieces: c?.noRatePieces ?? 0,
      };
      if (report.stored === null) {
        lines.push({ ...base, status: "BELUM_DITETAPKAN", setAmount: null, differs: false });
        continue;
      }
      const setAmount = s?.commission ?? 0;
      const differs =
        !sameCents(setAmount, computedAmount) ||
        (report.kind === "PUTUS" && (s === undefined || c === undefined || s.oldRule || s.pieces !== computedPieces));
      lines.push({ ...base, status: s?.paid ? "DIBAYAR" : "DITETAPKAN", setAmount, differs });
    }
  }
  return lines;
}

/** Each SPG's totals over her lines. */
export function payoutTotalsBySpg(lines: readonly PayoutLine[]): Map<string, PayoutTotals> {
  const bySpg = new Map<string, PayoutTotals>();
  for (const line of lines) {
    const t = bySpg.get(line.salesmanId) ?? { setAmount: 0, unsetAmount: 0, paidAmount: 0, differs: false, hasUnset: false };
    if (line.status === "BELUM_DITETAPKAN") {
      t.unsetAmount += line.computedAmount;
      t.hasUnset = true;
    } else {
      t.setAmount += line.setAmount ?? 0;
      if (line.status === "DIBAYAR") t.paidAmount += line.setAmount ?? 0;
    }
    if (line.differs) t.differs = true;
    bySpg.set(line.salesmanId, t);
  }
  return bySpg;
}
