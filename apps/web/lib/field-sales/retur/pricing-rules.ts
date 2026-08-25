/**
 * Deliberately import-free, same rule as variance.ts: these are consumed by a "use client"
 * component, and any import here would drag its whole module graph — including the
 * @elorae/db barrel (Prisma + the mariadb driver) — into the browser bundle.
 */

export function round2(n: number): number {
  /*
   * Scaling through a fixed-precision string before rounding matters: 1.005 * 100 evaluates to
   * 100.49999999999999 in IEEE-754, so Math.round on the raw product loses the .5 boundary and
   * returns 1 instead of 1.01. toFixed(6) restores the boundary without reintroducing its own
   * imprecision at this magnitude, and Math.round then rounds half away from zero as intended.
   */
  const scaled = Number((Math.abs(n) * 100).toFixed(6));
  return (Math.sign(n) * Math.round(scaled)) / 100;
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
