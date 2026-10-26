import Decimal from "decimal.js";

/**
 * Splits `total` across `weights` so the parts sum exactly to `total`: whole units when `total`
 * is an integer, 0.01 steps otherwise. Largest remainder wins the leftover units; ties go to the
 * lower index. All-zero or empty weights give zeros / an empty list.
 */
export function apportion(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((acc, w) => acc.plus(w), new Decimal(0));
  if (sum.lte(0)) return weights.map(() => 0);

  const scale = Number.isInteger(total) ? 1 : 100;
  const totalUnits = new Decimal(total).times(scale).round();
  const exact = weights.map((w) => totalUnits.times(w).div(sum));
  const floors = exact.map((e) => e.floor());
  const assigned = floors.reduce((acc, f) => acc.plus(f), new Decimal(0));
  let leftover = totalUnits.minus(assigned).toNumber();

  const order = exact
    .map((e, i) => ({ i, rem: e.minus(floors[i]) }))
    .sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i);

  const units = floors.map((f) => f.toNumber());
  for (const { i } of order) {
    if (leftover <= 0) break;
    units[i] += 1;
    leftover -= 1;
  }
  return units.map((u) => new Decimal(u).div(scale).toDecimalPlaces(2).toNumber());
}
