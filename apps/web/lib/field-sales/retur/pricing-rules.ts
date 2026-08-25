/**
 * Deliberately import-free. Unlike variance.ts, no "use client" component imports this file
 * directly today — only pricing.ts, queries.ts and the setLinePriceAction server action do,
 * and the clients that need this module's arithmetic (LinePriceControls, FieldReturnDetailClient)
 * either import variance.ts or take pre-computed values type-only from queries.ts. The rule is
 * kept anyway as cheap insurance: it costs nothing today, and it means a future client import of
 * this file can never accidentally drag @elorae/db (Prisma + the mariadb driver) into the browser
 * bundle the way it would if this file pulled in even a transitive server-only import.
 */

export function round2(n: number): number {
  /*
   * Scaling through a fixed-precision string before rounding matters: 1.005 * 100 evaluates to
   * 100.49999999999999 in IEEE-754, so Math.round on the raw product loses the .5 boundary and
   * returns 1 instead of 1.01. toFixed(6) rounds at 8 decimal places first, which recovers the
   * true .5 boundary in every case this module's money math produces. It narrows the window
   * for the underlying float-imprecision problem rather than eliminating it outright — a value
   * within roughly 5e-9 below a .5 boundary would still round up here — but that is sub-rupiah
   * and irrelevant at IDR's 2-decimal precision. Math.round then rounds half away from zero.
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

/**
 * De-dupes on a ROUNDED (2dp) key, not the raw float — two deliveries priced at the genuinely
 * same rupiah amount can still disagree in their last IEEE-754 bits (the classic `0.1 + 0.2 !==
 * 0.3`), and comparing raw floats would read that as two different prices and needlessly demand
 * an admin pick one. The representative `price` returned for an AUTO verdict is always
 * `prices[0]` (full precision, unrounded) — not the rounded key — so it stays the exact same
 * value `resolveLinePrice` pairs it with via `candidates[0]`.
 */
export function classifyPriceCandidates(
  prices: number[],
): { kind: "AUTO"; price: number } | { kind: "AMBIGUOUS" } | { kind: "UNPRICEABLE" } {
  if (prices.length === 0) return { kind: "UNPRICEABLE" };
  const distinctRounded = new Set(prices.map((p) => round2(p)));
  if (distinctRounded.size === 1) return { kind: "AUTO", price: prices[0] };
  return { kind: "AMBIGUOUS" };
}
