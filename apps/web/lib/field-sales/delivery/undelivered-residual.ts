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

/**
 * The goods value one delivery carried: its exact 2dp net, `subtotal − discountAmount − Σ line
 * discountAmount`, never its `total`. `FieldSalesDelivery.total` is the whole-rupiah charged figure
 * (`recordFieldSalesDelivery`), so a fully delivered order's rounded totals can sum to less than
 * its own `total`, and `undeliveredResidual` fed those would report that rounding as goods
 * still awaiting delivery — on a DELIVERED order, forever. The exact nets sum back to the order
 * total by construction (the closing delivery absorbs every discount remainder), so the residual
 * measures only what has not shipped. Callers pass this, not `total`, into `deliveredTotals`.
 */
export function deliveredGoodsValue(delivery: {
  subtotal: number;
  discountAmount: number;
  lineDiscounts: number[];
}): number {
  const lineDiscountTotal = delivery.lineDiscounts.reduce((sum, discount) => sum + discount, 0);
  return delivery.subtotal - delivery.discountAmount - lineDiscountTotal;
}
