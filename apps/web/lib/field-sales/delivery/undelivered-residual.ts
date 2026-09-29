/**
 * What is still owed on ONE approved putus order: its total minus everything already delivered
 * against it, floored at zero PER ORDER. Never floor a grand sum — an over-delivered order must
 * not lend negative headroom to a sibling order's shortfall, so callers add up the per-order
 * results, not the raw differences.
 *
 * Shared by credit exposure and the dashboard's awaiting-delivery bucket so the two cannot
 * disagree on what "undelivered" is worth. Import-free on purpose: callers convert Decimal
 * columns with `Number()` before passing them in.
 */
export function undeliveredResidual(orderTotal: number, deliveredTotals: number[]): number {
  const delivered = deliveredTotals.reduce((sum, total) => sum + total, 0);
  return Math.max(0, orderTotal - delivered);
}
