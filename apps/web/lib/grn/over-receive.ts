import { Decimal } from "decimal.js";

/**
 * Sums roll lengths without binary-float drift, so 50.1 + 50.2 is exactly 100.3.
 */
export function sumRollLengths(lengths: number[]): number {
  return lengths
    .reduce((sum, length) => sum.plus(new Decimal(length)), new Decimal(0))
    .toNumber();
}

/**
 * How far a receipt overshoots the ordered quantity (negative when under).
 * Computed exactly so a receipt that lands on the ordered quantity is never
 * flagged as an over-receipt by float noise.
 */
export function overReceiveBy(
  alreadyReceived: number | string,
  lineQty: number,
  ordered: number | string
): Decimal {
  return new Decimal(alreadyReceived)
    .plus(new Decimal(lineQty))
    .minus(new Decimal(ordered));
}
