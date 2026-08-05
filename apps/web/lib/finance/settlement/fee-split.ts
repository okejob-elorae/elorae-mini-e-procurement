export type MarketplaceFeeRole =
  | "MARKETPLACE_FEE_ADMIN"
  | "MARKETPLACE_FEE_SERVICE"
  | "MARKETPLACE_FEE_COMMISSION"
  | "MARKETPLACE_FEE_PROCESSING"
  | "MARKETPLACE_FEE_OTHER";

export type FeeCategoryTotals = {
  admin: number;
  service: number;
  commission: number;
  processing: number;
};

export type FeeSplitLine = {
  role: MarketplaceFeeRole;
  debit: number;
  credit: number;
};

const toCents = (value: number): number => Math.round(value * 100);

/**
 * A journal line must carry exactly one of debit/credit greater than zero
 * (`postJournal` throws BAD_LINE otherwise), so a negative amount becomes a
 * credit — a contra-expense — and a zero amount is dropped entirely.
 */
function line(role: MarketplaceFeeRole, cents: number): FeeSplitLine | null {
  if (cents === 0) return null;
  const amount = Math.abs(cents) / 100;
  return cents > 0 ? { role, debit: amount, credit: 0 } : { role, debit: 0, credit: amount };
}

/**
 * Splits a settlement's total expense into per-category journal lines.
 *
 * Only four fee columns are persisted per settlement line, so anything the
 * excel charges beyond them — Seller Fee sheet items, adjustments, and every
 * TikTok fee (its parser zeroes all four columns) — lands in the residual
 * `MARKETPLACE_FEE_OTHER` line. The residual is computed from
 * `totalPengeluaran`, which guarantees the split sums back to it and keeps
 * the journal balanced.
 */
export function splitMarketplaceFees(
  totals: FeeCategoryTotals,
  totalPengeluaran: number,
): FeeSplitLine[] {
  const categories: Array<[MarketplaceFeeRole, number]> = [
    ["MARKETPLACE_FEE_ADMIN", toCents(totals.admin)],
    ["MARKETPLACE_FEE_SERVICE", toCents(totals.service)],
    ["MARKETPLACE_FEE_COMMISSION", toCents(totals.commission)],
    ["MARKETPLACE_FEE_PROCESSING", toCents(totals.processing)],
  ];

  const categorized = categories.reduce((sum, [, cents]) => sum + cents, 0);
  const residual = toCents(totalPengeluaran) - categorized;

  return [...categories, ["MARKETPLACE_FEE_OTHER", residual] as [MarketplaceFeeRole, number]]
    .map(([role, cents]) => line(role, cents))
    .filter((l): l is FeeSplitLine => l !== null);
}
