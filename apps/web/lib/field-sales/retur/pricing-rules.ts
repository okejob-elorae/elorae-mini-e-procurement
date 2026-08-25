/**
 * Deliberately import-free, same rule as variance.ts: these are consumed by a "use client"
 * component, and any import here would drag its whole module graph — including the
 * @elorae/db barrel (Prisma + the mariadb driver) — into the browser bundle.
 */

export function round2(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100;
}

/**
 * The price the store was actually billed per unit, taken from the delivery line's lineTotal —
 * which is already net of its pro-rated line discount and its share of the order discount.
 * Deliberately UNROUNDED: the caller multiplies by the credited qty and rounds once, so that
 * the line total is exact. Rounding here first is what produces 12 x 833.333,33 = 9.999.999,96.
 */
export function effectiveUnitPrice(lineTotal: number, qty: number): number | null {
  if (qty <= 0) return null;
  return lineTotal / qty;
}

export function classifyPriceCandidates(
  prices: number[],
): { kind: "AUTO"; price: number } | { kind: "AMBIGUOUS" } | { kind: "UNPRICEABLE" } {
  if (prices.length === 0) return { kind: "UNPRICEABLE" };
  const distinct = Array.from(new Set(prices));
  if (distinct.length === 1) return { kind: "AUTO", price: distinct[0] };
  return { kind: "AMBIGUOUS" };
}
