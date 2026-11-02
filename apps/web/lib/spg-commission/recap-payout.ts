import type { SpgReportCommission } from "./payout";

/**
 * What the recap shows per SPG per report in one PAYOUT month, truthfully: the per-SPG figure the
 * computation gives today (category rate of the sales month × her own confirmed pieces), what is
 * stored, what was actually PAID, the corrections already applied from that report, and the
 * difference still waiting for her next payout.
 *
 * Owner decision 2026-11-02: there is no equal split anywhere. A row not yet paid is paid at the
 * per-SPG figure when it is marked paid (so a stored figure that differs "is replaced", `differs`),
 * and a row already paid is never changed — its difference = figure − paid − corrections already
 * applied rides once on the SPG's next payout (`lib/spg/koreksi.ts`). A unit is CLOSED when her row
 * is paid, or when she has no row and the report is closed (a locked cycle; a putus month with a
 * paid row); only closed units carry a difference. A unit HELD for an owner decision (`alasanTahan`:
 * an old-rule report with pieces that have no category rate — rates exist only from 2026-10 and a
 * past month cannot be given one — or a konsi cycle whose official figures were not all recorded on
 * the phones, open question Q7) carries none either, and an unpaid row of it is not paid.
 *
 * Client-safe: plain values in, plain values out.
 */

export type PayoutStatus = "BELUM_DITETAPKAN" | "DITETAPKAN" | "DIBAYAR" | "TANPA_BARIS";

/** One SPG's stored commission on one report. */
export type StoredSpgCommission = {
  salesmanId: string;
  /* Gross whole rupiah as stored, before any lost-goods deduction. */
  commission: number;
  /* Pieces stored with it: putus only. Null for konsi, which stores no pieces per SPG. */
  pieces: number | null;
  /* Set or locked under the old rule (item rate, equal split). */
  oldRule: boolean;
  paid: boolean;
};

export type PayoutReportInput = {
  key: string;
  kind: "KONSI" | "PUTUS";
  storeId: string;
  salesMonth: string;
  /* The payout month the report belongs to (the month it was checked / locked). */
  payoutMonth: string;
  /* KONSI: the cycle is locked. PUTUS: some row of the store × month is paid. */
  closed: boolean;
  /* The report's stored rows; null for a checked putus month the office has not set yet. */
  stored: readonly StoredSpgCommission[] | null;
  /* The computation of the same report (`commissionPerSpg`). */
  computed: readonly SpgReportCommission[];
  /* Σ corrections already applied from this report, per SPG. */
  appliedBySalesman: ReadonlyMap<string, number>;
  /* SPGs whose unit on this report waits for an owner decision. */
  heldSalesmen?: ReadonlySet<string>;
};

export type PayoutLine = {
  reportKey: string;
  kind: "KONSI" | "PUTUS";
  storeId: string;
  salesMonth: string;
  payoutMonth: string;
  salesmanId: string;
  status: PayoutStatus;
  /* The per-SPG figure today. */
  figure: number;
  pieces: number;
  noRatePieces: number;
  /* The stored figure; null while the report is not set, or for an SPG with no row on it. */
  setAmount: number | null;
  /* The stored figure of her row if it is paid, else 0. */
  paidAmount: number;
  /* Σ corrections already applied from this report to her. */
  correctionsFromThis: number;
  /* figure − paid − corrections applied, for a closed unit; else 0. */
  pendingDifference: number;
  /* An unpaid stored row that is replaced by the per-SPG figure when paid (never a held one). */
  differs: boolean;
  /* Waits for an owner decision: no automatic difference, and an unpaid row of it is not paid. */
  held: boolean;
};

export type PayoutTotals = {
  figure: number;
  setAmount: number;
  paidAmount: number;
  /* Σ figure − corrections already applied, over her unpaid and not-yet-set lines (a held line at its stored figure). */
  unpaidAmount: number;
  hasUnset: boolean;
  /* Σ corrections applied in this payout month. */
  correctionsApplied: number;
  pendingDifference: number;
  differs: boolean;
};

const cents = (n: number) => Math.round(n * 100);
const rupiah = (c: number) => (c === 0 ? 0 : c / 100);
const sameCents = (a: number, b: number) => cents(a) === cents(b);

const compareId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * One line per SPG per report: every SPG the computation credits with a piece, every SPG with a
 * stored row (a konsi row only when its commission is not zero or it is paid — a salaried SPG who
 * sold nothing has a Rp 0 row that is no commission), and every SPG with a correction already
 * applied from it. Lines keep the report order, then salesman id.
 */
export function payoutLinesOf(reports: readonly PayoutReportInput[]): PayoutLine[] {
  const lines: PayoutLine[] = [];
  for (const report of reports) {
    const computed = new Map(report.computed.filter((c) => c.pieces > 0).map((c) => [c.salesmanId, c]));
    const stored = new Map((report.stored ?? []).map((s) => [s.salesmanId, s]));
    const relevantStored = [...stored.values()].filter((s) => report.kind === "PUTUS" || !sameCents(s.commission, 0));
    const applied = [...report.appliedBySalesman].filter(([, n]) => cents(n) !== 0).map(([id]) => id);
    const ids = [...new Set([...computed.keys(), ...relevantStored.map((s) => s.salesmanId), ...applied])].sort(compareId);
    for (const salesmanId of ids) {
      const c = computed.get(salesmanId);
      const s = stored.get(salesmanId);
      const figure = c?.amount ?? 0;
      const pieces = c?.pieces ?? 0;
      const correctionsFromThis = rupiah(cents(report.appliedBySalesman.get(salesmanId) ?? 0));
      const status: PayoutStatus = report.stored === null ? "BELUM_DITETAPKAN" : s ? (s.paid ? "DIBAYAR" : "DITETAPKAN") : "TANPA_BARIS";
      const paidAmount = s?.paid ? s.commission : 0;
      const held = report.heldSalesmen?.has(salesmanId) ?? false;
      const closedUnit = s ? s.paid : report.closed;
      const pendingDifference = closedUnit && !held ? rupiah(cents(figure) - cents(paidAmount) - cents(correctionsFromThis)) : 0;
      // A held row is not replaced when paid — it is not paid at all until the owner decides.
      const differs =
        !held &&
        status === "DITETAPKAN" &&
        s !== undefined &&
        (!sameCents(s.commission, figure) || (report.kind === "PUTUS" && (s.oldRule || s.pieces !== pieces)));
      lines.push({
        reportKey: report.key,
        kind: report.kind,
        storeId: report.storeId,
        salesMonth: report.salesMonth,
        payoutMonth: report.payoutMonth,
        salesmanId,
        status,
        figure,
        pieces,
        noRatePieces: c?.noRatePieces ?? 0,
        setAmount: s ? s.commission : null,
        paidAmount,
        correctionsFromThis,
        pendingDifference,
        differs,
        held,
      });
    }
  }
  return lines;
}

/** Each SPG's totals over her lines, plus the corrections applied to her in this payout month. */
export function payoutTotalsBySpg(
  lines: readonly PayoutLine[],
  corrections: ReadonlyArray<{ salesmanId: string; amount: number }> = [],
): Map<string, PayoutTotals> {
  const bySpg = new Map<string, PayoutTotals>();
  const of = (id: string) => {
    let t = bySpg.get(id);
    if (!t) {
      t = { figure: 0, setAmount: 0, paidAmount: 0, unpaidAmount: 0, hasUnset: false, correctionsApplied: 0, pendingDifference: 0, differs: false };
      bySpg.set(id, t);
    }
    return t;
  };
  for (const line of lines) {
    const t = of(line.salesmanId);
    t.figure = rupiah(cents(t.figure) + cents(line.figure));
    t.setAmount = rupiah(cents(t.setAmount) + cents(line.setAmount ?? 0));
    t.paidAmount = rupiah(cents(t.paidAmount) + cents(line.paidAmount));
    if (line.status === "BELUM_DITETAPKAN" || line.status === "DITETAPKAN") {
      // A held row waits for an owner decision: the only figure known for it is the stored one.
      const owed = line.held && line.setAmount !== null ? line.setAmount : line.figure;
      t.unpaidAmount = rupiah(cents(t.unpaidAmount) + cents(owed) - cents(line.correctionsFromThis));
    }
    if (line.status === "BELUM_DITETAPKAN") t.hasUnset = true;
    t.pendingDifference = rupiah(cents(t.pendingDifference) + cents(line.pendingDifference));
    if (line.differs) t.differs = true;
  }
  for (const c of corrections) {
    const t = of(c.salesmanId);
    t.correctionsApplied = rupiah(cents(t.correctionsApplied) + cents(c.amount));
  }
  return bySpg;
}
