import type { CommissionEvent } from "./compute";
import { compareYearMonth } from "./month";

/**
 * Pure helpers the recap page and its export share. Client-safe: the imports are a type and the
 * import-free month module, so nothing here reaches `@elorae/db`.
 */

/** The `"YYYY-MM"` key `delta` months from `yearMonth` (negative goes back). */
export function shiftYearMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(index / 12);
  const shiftedMonth = index - shiftedYear * 12 + 1;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

/**
 * The months a selector offers, newest first: `count` months ending at `current`, plus `selected`
 * when it falls outside that run, so an old month reached by URL still shows as chosen.
 */
export function recapMonthOptions(current: string, selected: string, count: number): string[] {
  const months = Array.from({ length: Math.max(1, count) }, (_, i) => shiftYearMonth(current, -i));
  if (!months.includes(selected)) months.push(selected);
  return months.sort((a, b) => compareYearMonth(b, a));
}

export function detailKey(salesmanId: string, categoryId: string | null): string {
  return `${salesmanId}\u0000${categoryId ?? ""}`;
}

export type DetailRates = { rates: number[]; unrated: boolean };

/**
 * The per-piece rates behind each SPG × category breakdown row, keyed by `detailKey`. One month's
 * EARNED events share the month's rate, but its REVERSED events mirror the rate of each voided
 * report's own approval month, so a row can carry more than one; they come back ascending.
 */
export function ratesByDetail(events: readonly CommissionEvent[]): Map<string, DetailRates> {
  const byKey = new Map<string, { rates: Set<number>; unrated: boolean }>();
  for (const event of events) {
    const key = detailKey(event.salesmanId, event.categoryId);
    const entry = byKey.get(key) ?? { rates: new Set<number>(), unrated: false };
    if (event.ratePerPiece === null) entry.unrated = true;
    else entry.rates.add(event.ratePerPiece);
    byKey.set(key, entry);
  }
  const result = new Map<string, DetailRates>();
  for (const [key, entry] of byKey) {
    result.set(key, { rates: Array.from(entry.rates).sort((a, b) => a - b), unrated: entry.unrated });
  }
  return result;
}

export type PayoutGrandTotals = {
  pieces: number;
  figure: number;
  setAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  correctionsApplied: number;
  pendingDifference: number;
};

/** A payout month's totals over the per-SPG rows (`CommissionRecapRow`), in whole cents. */
export function sumPayoutRows(rows: ReadonlyArray<Omit<PayoutGrandTotals, never>>): PayoutGrandTotals {
  const c = (n: number) => Math.round(n * 100);
  const t = rows.reduce(
    (sum, row) => ({
      pieces: sum.pieces + row.pieces,
      figure: sum.figure + c(row.figure),
      setAmount: sum.setAmount + c(row.setAmount),
      paidAmount: sum.paidAmount + c(row.paidAmount),
      unpaidAmount: sum.unpaidAmount + c(row.unpaidAmount),
      correctionsApplied: sum.correctionsApplied + c(row.correctionsApplied),
      pendingDifference: sum.pendingDifference + c(row.pendingDifference),
    }),
    { pieces: 0, figure: 0, setAmount: 0, paidAmount: 0, unpaidAmount: 0, correctionsApplied: 0, pendingDifference: 0 },
  );
  const r = (n: number) => (n === 0 ? 0 : n / 100);
  return {
    pieces: t.pieces,
    figure: r(t.figure),
    setAmount: r(t.setAmount),
    paidAmount: r(t.paidAmount),
    unpaidAmount: r(t.unpaidAmount),
    correctionsApplied: r(t.correctionsApplied),
    pendingDifference: r(t.pendingDifference),
  };
}

/** Whole rupiah, id-ID grouped, with the minus ahead of the currency so a reversal reads as one. */
export function formatSignedRupiah(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}Rp ${Math.abs(amount).toLocaleString("id-ID")}`;
}

/** A row's store names, joined in name order; an id with no name prints as itself. */
export function storeLabel(storeIds: readonly string[], storeNames: Record<string, string>): string {
  return storeIds
    .map((id) => storeNames[id] ?? id)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}
