/**
 * Deliberately import-free. Unlike variance.ts, no "use client" component imports this file
 * directly today — only pricing.ts, queries.ts, approve-writer.ts, valuation-writer.ts and the
 * setLinePriceAction server action do,
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
 * The price the store was actually billed per unit: the delivery line's NET value divided by its
 * qty. The net value is NOT `FieldSalesDeliveryLine.lineTotal`, which is stored gross; the caller
 * derives it with `deliveredLineNetValues` (`lib/field-sales/delivery/undelivered-residual.ts`),
 * which takes off the line's own discount and its share of the delivery's header discount (the
 * order discount, plus on an order's closing delivery any line-discount residue it absorbed).
 * Passing the gross here credits the store for discounts it never paid.
 * Deliberately UNROUNDED: the caller multiplies by the credited qty and rounds once, so that
 * the line total is exact. Rounding here first is what produces 12 x 833.333,33 = 9.999.999,96.
 */
export function effectiveUnitPrice(netLineValue: number, qty: number): number | null {
  if (qty <= 0) return null;
  return netLineValue / qty;
}

/**
 * Prices that differ by less than this many rupiah are the SAME price. Each delivery rounds its
 * own discount shares (`allocateDeliveryDiscounts`), so one item at one promo shipped in two
 * deliveries comes out a few sen apart per unit (967 against 966.50) — that is rounding, not two
 * prices, and demanding an admin pick between them would leave nearly every promo store's retur
 * unpriced. A spread of a whole rupiah or more is a genuinely different price.
 */
export const SAME_PRICE_TOLERANCE_RUPIAH = 1;

/**
 * AUTO when the candidates are all the same price within `SAME_PRICE_TOLERANCE_RUPIAH`, judged
 * by the spread of the WHOLE set (max − min, strictly below the tolerance) rather than pairwise:
 * 966.40, 967.20 and 967.90 are each within a rupiah of their neighbour, but the set spans 1.50
 * and is AMBIGUOUS, because a pairwise rule would chain any number of small steps into one
 * "same" price. The spread is measured on 2dp-rounded values so IEEE-754 noise (`0.1 + 0.2 !==
 * 0.3`) never decides it.
 *
 * An AUTO verdict prices at the LOWEST candidate, never an average or the newest, so a retur is
 * never credited above the cheapest of the near-equal bills; `index` names that candidate so the
 * caller records its delivery line as the price source (the first such candidate on a tie). The
 * `price` is that candidate's full-precision, unrounded value, `prices[index]`.
 */
export function classifyPriceCandidates(
  prices: number[],
): { kind: "AUTO"; price: number; index: number } | { kind: "AMBIGUOUS" } | { kind: "UNPRICEABLE" } {
  if (prices.length === 0) return { kind: "UNPRICEABLE" };
  const cents = prices.map((p) => Math.round(round2(p) * 100));
  const spreadCents = Math.max(...cents) - Math.min(...cents);
  if (spreadCents >= SAME_PRICE_TOLERANCE_RUPIAH * 100) return { kind: "AMBIGUOUS" };
  let index = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] < prices[index]) index = i;
  }
  return { kind: "AUTO", price: prices[index], index };
}
