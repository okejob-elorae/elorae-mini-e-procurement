import { compareYearMonth } from "./month";

/**
 * Picks the SPG commission rate in force for a category in a WIB month: the row with the latest
 * `effectiveFrom` that is not after `yearMonth`, or `null` when none has started yet.
 *
 * Kept apart from `rates.ts`, and free of `@elorae/db`, so the pure commission computation and
 * client components can use it without pulling Prisma into their bundle.
 */
export function resolveRate<T extends { itemCategoryId: string; effectiveFrom: string }>(
  rates: readonly T[],
  itemCategoryId: string,
  yearMonth: string,
): T | null {
  let best: T | null = null;
  for (const rate of rates) {
    if (rate.itemCategoryId !== itemCategoryId) continue;
    if (compareYearMonth(rate.effectiveFrom, yearMonth) > 0) continue;
    if (best === null || compareYearMonth(rate.effectiveFrom, best.effectiveFrom) > 0) best = rate;
  }
  return best;
}
