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
 * `discountAmount` less its share of the delivery's header `discountAmount`. The header is mostly
 * the order discount, but on the delivery that closes the order it also absorbs the line-discount
 * residue of order lines that delivery does not carry (`allocateDeliveryDiscounts`).
 *
 * The header is split across the lines in proportion to each line's gross NET of its own line
 * discount, `max(0, lineTotal − discountAmount)`, because that is the base the order promo was
 * computed on (`computeOrderPromos` in `@elorae/db`'s promo module takes its percentage of the
 * net subtotal). Splitting by gross would hand a heavily line-discounted line too much of the
 * header, and a line fully discounted at line level a positive share that drives it below zero.
 * The split is a largest-remainder allocation in whole sen, ties going to the earlier line, so
 * the shares sum back to the header exactly and the values sum to `deliveredGoodsValue` of the
 * same delivery, never to its gross subtotal.
 *
 * When every weight is zero (every line fully discounted at line level, yet a header remains),
 * the split falls back to gross weights, and to the first line when the gross is zero too. That
 * fallback is the conservative one: it can only push a line's net DOWN, at worst below zero,
 * which the retur pricing reads as unpriceable, whereas leaving the header unallocated would
 * credit every line its full net and over-credit the store by the whole header.
 *
 * Returned in the order of `lines`; pass them in a stable order (by id) so the tie-break is
 * deterministic. A line whose gross is unknown is passed as 0 and weighs nothing. Import-free on
 * purpose: callers convert Decimal columns with `Number()` before passing them in.
 */
export function deliveredLineNetValues(delivery: {
  discountAmount: number;
  lines: Array<{ lineTotal: number; discountAmount: number }>;
}): number[] {
  const toCents = (n: number) => Math.round(Number((n * 100).toFixed(4)));
  const grossCents = delivery.lines.map((l) => toCents(l.lineTotal));
  const lineDiscountCents = delivery.lines.map((l) => toCents(l.discountAmount));
  const headerCents = toCents(delivery.discountAmount);

  const netWeights = grossCents.map((g, i) => Math.max(0, g - lineDiscountCents[i]));
  const sumOf = (values: number[]) => values.reduce((sum, v) => sum + v, 0);
  const weights = sumOf(netWeights) > 0 ? netWeights : grossCents.map((g) => Math.max(0, g));
  const weightTotal = sumOf(weights);

  const shares = grossCents.map(() => 0);
  if (shares.length > 0 && headerCents !== 0) {
    if (weightTotal <= 0) {
      shares[0] = headerCents;
    } else {
      const exact = weights.map((w) => (headerCents * w) / weightTotal);
      exact.forEach((e, i) => {
        shares[i] = Math.floor(e);
      });
      let leftover = headerCents - sumOf(shares);
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

  return delivery.lines.map((_, i) => (grossCents[i] - lineDiscountCents[i] - shares[i]) / 100);
}
