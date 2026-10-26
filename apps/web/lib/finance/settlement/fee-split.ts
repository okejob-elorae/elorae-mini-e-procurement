import type { PostingRole } from "@/lib/constants/journal-roles";

/**
 * Every per-category fee role. Derived from `PostingRole`, so a new
 * `MARKETPLACE_FEE_*` role is a type error in `CATEGORY_TOTAL_KEY` below until
 * it is mapped to a fee column (or is the residual `MARKETPLACE_FEE_OTHER`). The legacy lumped `MARKETPLACE_FEE` role has no suffix and is not
 * a member.
 */
export type MarketplaceFeeRole = Extract<PostingRole, `MARKETPLACE_FEE_${string}`>;

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

type CategorizedFeeRole = Exclude<MarketplaceFeeRole, "MARKETPLACE_FEE_OTHER">;

/**
 * Which persisted fee column feeds each categorized role. Typed as a full
 * `Record`, so a new `MARKETPLACE_FEE_*` role is a type error here until it is
 * mapped; `MARKETPLACE_FEE_OTHER` is the computed residual and has no column.
 */
const CATEGORY_TOTAL_KEY: Record<CategorizedFeeRole, keyof FeeCategoryTotals> = {
  MARKETPLACE_FEE_ADMIN: "admin",
  MARKETPLACE_FEE_SERVICE: "service",
  MARKETPLACE_FEE_COMMISSION: "commission",
  MARKETPLACE_FEE_PROCESSING: "processing",
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
  const categories = (
    Object.entries(CATEGORY_TOTAL_KEY) as Array<
      [CategorizedFeeRole, keyof FeeCategoryTotals]
    >
  ).map(([role, key]): [MarketplaceFeeRole, number] => [role, toCents(totals[key])]);

  const categorized = categories.reduce((sum, [, cents]) => sum + cents, 0);
  const residual = toCents(totalPengeluaran) - categorized;

  return [...categories, ["MARKETPLACE_FEE_OTHER", residual] as [MarketplaceFeeRole, number]]
    .map(([role, cents]) => line(role, cents))
    .filter((l): l is FeeSplitLine => l !== null);
}
