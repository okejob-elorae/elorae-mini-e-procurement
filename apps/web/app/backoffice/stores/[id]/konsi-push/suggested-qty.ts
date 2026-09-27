/**
 * The quantity a gap row starts at, or null when the row should start unchecked because main
 * cannot spare even one unit. Import-free on purpose: the `"use client"` push form imports it.
 *
 * A row with no target starts at 1; otherwise it asks for what is missing — target minus on hand
 * minus what is already on order — at least 1, and never more than main can spare. The shortfall
 * is rounded to 2dp before `ceil` because the three figures are Decimals and float subtraction
 * adds noise (1.1 − 0.1 is 1.0000000000000002, which `ceil` would turn into 2).
 */
export function suggestedGapQty(input: {
  target: number | null;
  onHand: number;
  inTransit: number;
  available: number;
}): number | null {
  const { target, onHand, inTransit, available } = input;
  const raw = target === null ? 1 : Math.ceil(Math.round((target - onHand - inTransit) * 100) / 100);
  const cap = Math.floor(available);
  if (cap < 1) return null;
  return Math.min(Math.max(1, raw), cap);
}
