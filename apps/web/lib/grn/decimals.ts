/* Tolerates float noise: 0.1 + 0.2 and 1.005 * 100 style drift never reads as a third decimal. */
export function hasAtMostTwoDecimals(n: number): boolean {
  if (!Number.isFinite(n)) return false;
  return Math.abs(n * 100 - Math.round(n * 100)) <= 1e-6;
}
