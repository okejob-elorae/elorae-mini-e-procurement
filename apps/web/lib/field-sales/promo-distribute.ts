/**
 * Split an item-level discount across its variant lines pro-rata by line total.
 * Integer rupiah via largest-remainder so the parts sum to exactly `itemDiscount`.
 */
export function distributeDiscountProRata(lineTotals: number[], itemDiscount: number): number[] {
  const n = lineTotals.length;
  if (n === 0) return [];
  const total = lineTotals.reduce((s, t) => s + t, 0);
  if (itemDiscount <= 0 || total <= 0) return lineTotals.map(() => 0);

  const exact = lineTotals.map((t) => (t / total) * itemDiscount);
  const floors = exact.map((e) => Math.floor(e));
  let remainder = Math.round(itemDiscount - floors.reduce((s, f) => s + f, 0));
  // hand the leftover rupiah to the largest fractional parts first
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  const out = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++) { out[order[k].i] += 1; remainder -= 1; }
  return out;
}
