import { compareYearMonth, wibYearMonth } from "./month";
import { resolveRate } from "./resolve-rate";

/**
 * The SPG commission computation over plain rows: which pieces each SPG earned from an approved
 * konsi sell-through report, at which rate, and in which WIB month, plus the monthly recap built
 * from those events.
 *
 * Client-safe and import-free apart from `./month` and `./resolve-rate`, which are client-safe
 * themselves; the query layer (`queries.ts`) loads the rows. No commission amount is stored: every
 * event is recomputed from the reports each time, so a month's recap is a reading. Only the split
 * WEIGHTS between SPGs are snapshotted, at approval (`KonsiSellThroughSpgShare`), so a later ledger
 * row cannot shift a closed month's split.
 *
 * Event-month accounting: a report EARNS in the WIB month of its `approvedAt`; a void REVERSES the
 * exact same pieces and amounts, at the same (approval-month) rate, in the WIB month of its
 * `voidedAt`. Baseline reports confirm nothing and emit no events.
 */

export type CommissionRate = { itemCategoryId: string; effectiveFrom: string; amountPerPiece: number };

export type SpgPosQty = { salesmanId: string; qty: number };

export type CommissionReportLine = {
  itemId: string;
  variantSku: string;
  categoryId: string | null;
  /* What the report treated as POS-sold for the line: its stored `posSoldQty`, which already includes `latePosSoldQty`. */
  posQty: number;
  billedQty: number;
  /* Each SPG's POS qty for the line — only the split key, never the amount earned. */
  perSpgPosQty: SpgPosQty[];
};

export type CommissionReport = {
  id: string;
  storeId: string;
  baseline: boolean;
  approvedAt: Date;
  voidedAt: Date | null;
  lines: CommissionReportLine[];
};

export type CommissionEventKind = "EARNED" | "REVERSED";

export type CommissionEvent = {
  yearMonth: string;
  kind: CommissionEventKind;
  sellThroughId: string;
  storeId: string;
  salesmanId: string;
  categoryId: string | null;
  /* Positive for EARNED, the negated EARNED figure for REVERSED. */
  pieces: number;
  /* Whole rupiah per piece in force in the APPROVAL month, or null when the line has no category or the category no rate. */
  ratePerPiece: number | null;
  /* Whole rupiah; 0 when `ratePerPiece` is null. */
  amount: number;
};

export type RecapTotals = {
  /* Net signed pieces in the month: earned pieces minus reversed ones. */
  pieces: number;
  /* Sum of EARNED amounts in the month, never negative. */
  earned: number;
  /* Sum of REVERSED amounts in the month, never positive. */
  reversed: number;
  net: number;
  /* EARNED pieces in the month that earned nothing for want of a category or rate. */
  noRatePieces: number;
};

export type RecapRow = RecapTotals & { salesmanId: string; storeIds: string[] };

export type RecapDetailRow = RecapTotals & { salesmanId: string; categoryId: string | null };

export type RecapNoRateRow = { categoryId: string | null; pieces: number };

export type RecapSummary = {
  rows: RecapRow[];
  detail: RecapDetailRow[];
  noRate: RecapNoRateRow[];
  events: CommissionEvent[];
};

const roundQty = (n: number) => Math.round(n * 100) / 100;

/* Negating 0 yields -0, which a strict comparison reads as a different value. */
const negate = (n: number) => (n === 0 ? 0 : -n);

/* A plain code-unit comparison, so ordering never depends on the host locale. */
const compareId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/* Orders category ids ascending, with null after every real id. */
function compareCategory(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareId(a, b);
}

/* Orders category ids ascending, with null before every real id. */
function compareCategoryNullFirst(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareId(a, b);
}

/**
 * The pieces a report line confirms as SPG sales: the smaller of what it billed and what it treated
 * as POS-sold, never negative, in whole pieces. Billed units beyond the POS figure (a shortfall
 * billed under BILL) are not SPG sales; a REDUCE line billing fewer than POS confirms only those.
 */
export function confirmedPieces(line: { posQty: number; billedQty: number }): number {
  const confirmed = roundQty(Math.min(line.billedQty, line.posQty));
  if (!Number.isFinite(confirmed) || confirmed <= 0) return 0;
  return Math.floor(confirmed);
}

/**
 * Splits `total` whole pieces across SPGs in proportion to their weights, by largest remainder:
 * each takes the floor of its quota, and the pieces left over go one each to the largest
 * fractional remainders, a tie going to the lower salesman id. Repeated salesmen are merged and
 * non-positive weights dropped. The result always sums to exactly `total` when any weight is
 * positive — over the weights' own sum, whatever it is — and is empty otherwise. Ordered by
 * salesman id; SPGs left with 0 pieces are omitted.
 *
 * Weights are scaled to hundredths and compared as integers, so the remainders are exact.
 */
export function splitByLargestRemainder(total: number, weights: readonly SpgPosQty[]): Array<{ salesmanId: string; pieces: number }> {
  const whole = Number.isFinite(total) ? Math.floor(total) : 0;
  if (whole <= 0) return [];

  const scaled = new Map<string, number>();
  for (const w of weights) {
    const units = Number.isFinite(w.qty) ? Math.round(w.qty * 100) : 0;
    if (units <= 0) continue;
    scaled.set(w.salesmanId, (scaled.get(w.salesmanId) ?? 0) + units);
  }
  let sum = 0;
  for (const units of scaled.values()) sum += units;
  if (sum <= 0) return [];

  const shares = Array.from(scaled, ([salesmanId, units]) => {
    const numerator = whole * units;
    const pieces = Math.floor(numerator / sum);
    return { salesmanId, pieces, remainder: numerator - pieces * sum };
  });
  let left = whole - shares.reduce((s, r) => s + r.pieces, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || compareId(a.salesmanId, b.salesmanId));
  for (const share of byRemainder) {
    if (left <= 0) break;
    share.pieces += 1;
    left -= 1;
  }

  return shares
    .filter((s) => s.pieces > 0)
    .sort((a, b) => compareId(a.salesmanId, b.salesmanId))
    .map((s) => ({ salesmanId: s.salesmanId, pieces: s.pieces }));
}

/**
 * The per-SPG units in positions `[skip, skip + take)` of an ordered run of POS units — how
 * `perSpgPosQtyForLines` (`split-weights.ts`) says which of a window's SpgSale units a report
 * counted. A row may straddle either edge and is split there. Units of a row with no known SPG are
 * consumed (they still take their positions) but add to no SPG's weight, so
 * `splitByLargestRemainder` then divides the line's confirmed pieces over the SPGs that remain.
 * Ordered by salesman id.
 */
export function takeUnitsBySalesman(
  rows: ReadonlyArray<{ salesmanId: string | null; units: number }>,
  skip: number,
  take: number,
): SpgPosQty[] {
  const start = Math.max(0, skip);
  const end = start + Math.max(0, take);
  const bySalesman = new Map<string, number>();
  let position = 0;
  for (const row of rows) {
    if (position >= end) break;
    const units = Math.max(0, row.units);
    const from = Math.max(position, start);
    const to = Math.min(position + units, end);
    if (to > from && row.salesmanId !== null) {
      bySalesman.set(row.salesmanId, roundQty((bySalesman.get(row.salesmanId) ?? 0) + (to - from)));
    }
    position += units;
  }
  return Array.from(bySalesman, ([salesmanId, qty]) => ({ salesmanId, qty })).sort((a, b) => compareId(a.salesmanId, b.salesmanId));
}

/**
 * Every commission event the given reports produce, in report order, then by salesman id and
 * category (null first), each EARNED event directly followed by its reversal when the report was
 * voided. Pieces are split per line and summed per (report, SPG, category), so one event carries
 * one rate.
 */
export function computeCommissionEvents(reports: readonly CommissionReport[], rates: readonly CommissionRate[]): CommissionEvent[] {
  const events: CommissionEvent[] = [];

  for (const report of reports) {
    if (report.baseline) continue;
    const earnedMonth = wibYearMonth(report.approvedAt);
    const reversedMonth = report.voidedAt ? wibYearMonth(report.voidedAt) : null;

    const pieces = new Map<string, { salesmanId: string; categoryId: string | null; pieces: number }>();
    for (const line of report.lines) {
      for (const share of splitByLargestRemainder(confirmedPieces(line), line.perSpgPosQty)) {
        const key = `${share.salesmanId}\u0000${line.categoryId ?? ""}`;
        const entry = pieces.get(key);
        if (entry) entry.pieces += share.pieces;
        else pieces.set(key, { salesmanId: share.salesmanId, categoryId: line.categoryId, pieces: share.pieces });
      }
    }

    const ordered = Array.from(pieces.values()).sort(
      (a, b) => compareId(a.salesmanId, b.salesmanId) || compareCategoryNullFirst(a.categoryId, b.categoryId),
    );
    for (const entry of ordered) {
      const rate = entry.categoryId === null ? null : resolveRate(rates, entry.categoryId, earnedMonth);
      const ratePerPiece = rate ? rate.amountPerPiece : null;
      const amount = ratePerPiece === null ? 0 : ratePerPiece * entry.pieces;
      const base = { sellThroughId: report.id, storeId: report.storeId, salesmanId: entry.salesmanId, categoryId: entry.categoryId, ratePerPiece };
      events.push({ yearMonth: earnedMonth, kind: "EARNED", ...base, pieces: entry.pieces, amount });
      if (reversedMonth !== null) {
        events.push({ yearMonth: reversedMonth, kind: "REVERSED", ...base, pieces: negate(entry.pieces), amount: negate(amount) });
      }
    }
  }

  return events;
}

function emptyTotals(): RecapTotals {
  return { pieces: 0, earned: 0, reversed: 0, net: 0, noRatePieces: 0 };
}

function addEvent(totals: RecapTotals, event: CommissionEvent): void {
  totals.pieces += event.pieces;
  if (event.kind === "EARNED") {
    totals.earned += event.amount;
    if (event.ratePerPiece === null) totals.noRatePieces += event.pieces;
  } else {
    totals.reversed += event.amount;
  }
  totals.net = totals.earned + totals.reversed;
}

/**
 * The recap for one WIB month: one row per SPG with an event in it, the SPG × category breakdown,
 * and the categories (null for uncategorised items) whose EARNED pieces had no rate. A reversal of
 * an unrated earning mirrors it at 0, so it is not flagged again. Rows are ordered by salesman id,
 * detail by salesman id then category (null last); a row may be negative, never floored.
 */
export function summariseRecap(allEvents: readonly CommissionEvent[], yearMonth: string): RecapSummary {
  const events = allEvents.filter((e) => compareYearMonth(e.yearMonth, yearMonth) === 0);

  const rows = new Map<string, RecapRow & { stores: Set<string> }>();
  const detail = new Map<string, RecapDetailRow>();
  const noRate = new Map<string, RecapNoRateRow>();

  for (const event of events) {
    let row = rows.get(event.salesmanId);
    if (!row) {
      row = { salesmanId: event.salesmanId, storeIds: [], stores: new Set(), ...emptyTotals() };
      rows.set(event.salesmanId, row);
    }
    row.stores.add(event.storeId);
    addEvent(row, event);

    const detailKey = `${event.salesmanId}\u0000${event.categoryId ?? ""}`;
    let detailRow = detail.get(detailKey);
    if (!detailRow) {
      detailRow = { salesmanId: event.salesmanId, categoryId: event.categoryId, ...emptyTotals() };
      detail.set(detailKey, detailRow);
    }
    addEvent(detailRow, event);

    if (event.kind === "EARNED" && event.ratePerPiece === null && event.pieces > 0) {
      const noRateKey = event.categoryId ?? "";
      const entry = noRate.get(noRateKey);
      if (entry) entry.pieces += event.pieces;
      else noRate.set(noRateKey, { categoryId: event.categoryId, pieces: event.pieces });
    }
  }

  return {
    rows: Array.from(rows.values())
      .sort((a, b) => compareId(a.salesmanId, b.salesmanId))
      .map(({ stores, ...row }) => ({ ...row, storeIds: Array.from(stores).sort(compareId) })),
    detail: Array.from(detail.values()).sort(
      (a, b) => compareId(a.salesmanId, b.salesmanId) || compareCategory(a.categoryId, b.categoryId),
    ),
    noRate: Array.from(noRate.values()).sort((a, b) => compareCategory(a.categoryId, b.categoryId)),
    events,
  };
}
