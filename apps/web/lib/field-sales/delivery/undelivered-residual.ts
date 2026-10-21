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

/**
 * What the store was billed for each line of one delivery, exact to the sen: the line's gross
 * `lineTotal` (`qty × unitPrice`, which `recordFieldSalesDelivery` stores GROSS) less its own
 * `discountAmount` less its share of the delivery's header `discountAmount` (the order discount).
 * The header share is split across the lines in proportion to their gross, the same basis
 * `allocateDeliveryDiscounts` pro-rates the order discount on, and by largest remainder in whole
 * sen, ties going to the earlier line, so the shares sum back to the header exactly. The values
 * therefore sum to `deliveredGoodsValue` of the same delivery, never to its gross subtotal.
 *
 * Returned in the order of `lines`; pass them in a stable order (by id) so the tie-break is
 * deterministic. A line whose gross is unknown is passed as 0 and takes no header share. A
 * delivery whose gross sums to nothing puts the whole header on its first line. Import-free on
 * purpose: callers convert Decimal columns with `Number()` before passing them in.
 */
export function deliveredLineNetValues(delivery: {
  discountAmount: number;
  lines: Array<{ lineTotal: number; discountAmount: number }>;
}): number[] {
  const toCents = (n: number) => Math.round(Number((n * 100).toFixed(4)));
  const grossCents = delivery.lines.map((l) => toCents(l.lineTotal));
  const headerCents = toCents(delivery.discountAmount);
  const grossTotal = grossCents.reduce((sum, g) => sum + g, 0);

  const shares = grossCents.map(() => 0);
  if (shares.length > 0 && headerCents !== 0) {
    if (grossTotal <= 0) {
      shares[0] = headerCents;
    } else {
      const exact = grossCents.map((g) => (headerCents * g) / grossTotal);
      exact.forEach((e, i) => {
        shares[i] = Math.floor(e);
      });
      let leftover = headerCents - shares.reduce((sum, s) => sum + s, 0);
      const byRemainder = exact
        .map((e, i) => ({ i, frac: e - Math.floor(e) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
      for (const { i } of byRemainder) {
        if (leftover <= 0) break;
        shares[i] += 1;
        leftover -= 1;
      }
    }
  }

  return delivery.lines.map((l, i) => (grossCents[i] - toCents(l.discountAmount) - shares[i]) / 100);
}
