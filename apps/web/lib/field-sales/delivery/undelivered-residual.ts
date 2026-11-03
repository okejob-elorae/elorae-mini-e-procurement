/**
 * What is still owed on ONE approved putus order: its total minus everything already delivered
 * against it, floored at zero PER ORDER. Never floor a grand sum — an over-delivered order must
 * not lend negative headroom to a sibling order's shortfall, so callers add up the per-order
 * results, not the raw differences.
 *
 * Now used only by the dashboard awaiting-delivery bucket and the store order summary; credit
 * exposure measures the order's own open quantity (`nilaiBelumDinota`), and both remaining callers
 * move to it once a voided or corrected nota (P16/P25, P24) can leave a phantom residual here
 * (FOLLOWUPS). Import-free on purpose: callers convert Decimal columns with `Number()` first.
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

/** One order line as `nilaiBelumDinota` reads it (Decimals converted with `Number()`). */
export type BarisBelumDinota = {
  qty: number;
  deliveredQty: number;
  cancelledQty: number;
  lineTotal: number;
  discountAmount: number;
};

/**
 * What an approved putus order still owes that is on NO nota (Q10), measured from the order's own
 * open quantity: open = max(0, qty − deliveredQty − cancelledQty) per line, valued at the line's
 * gross less its line discount and its pro-rata share of the order discount — the same pro-rata
 * keys `allocateDeliveryDiscounts` uses. Because it follows the order lines, it stays right after a
 * nota is voided (P16/P25: the pieces reopen on the order) or corrected at handover (P24: refused
 * pieces reopen, lost pieces do not). Unrounded per delivery, so it can differ by the planner's sen
 * rounding from `total − Σ deliveredGoodsValue`. Lines with qty ≤ 0 are ignored; a fully open order
 * returns its own total; floored at zero. Computed in sen.
 */
export function nilaiBelumDinota(order: { total: number; orderDiscountAmount: number; lines: BarisBelumDinota[] }): number {
  const baris = order.lines.filter((l) => l.qty > 0);
  const terbuka = baris.map((l) => Math.max(0, l.qty - l.deliveredQty - l.cancelledQty));
  if (baris.length > 0 && baris.every((l, i) => terbuka[i] === l.qty)) return Math.max(0, order.total);
  if (terbuka.reduce((s, n) => s + n, 0) === 0) return 0;
  let grossTerbuka = 0;
  let diskonBarisTerbuka = 0;
  let grossSemua = 0;
  baris.forEach((l, i) => {
    const grossSen = Math.round(l.lineTotal * 100);
    const diskonSen = Math.round(l.discountAmount * 100);
    grossSemua += grossSen;
    grossTerbuka += (grossSen * terbuka[i]) / l.qty;
    diskonBarisTerbuka += (diskonSen * terbuka[i]) / l.qty;
  });
  const diskonPesananTerbuka = grossSemua > 0 ? (Math.round(order.orderDiscountAmount * 100) * grossTerbuka) / grossSemua : 0;
  return Math.max(0, Math.round(grossTerbuka - diskonBarisTerbuka - diskonPesananTerbuka)) / 100;
}
