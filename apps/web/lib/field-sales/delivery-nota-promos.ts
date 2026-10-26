type PromoNamedLine = { id: string; appliedPromoName: string | null };

/**
 * The promo names a delivery-built nota tagihan prints. A delivery line has no promo of its
 * own; its discount traces back to the order line it was cut from (`orderLineId`), whose
 * `appliedPromoName` the order detail already resolved. A line whose order line is unknown
 * gets `null`.
 */
export function promoNameForDeliveryLine(
  orderLines: PromoNamedLine[],
  orderLineId: string,
): string | null {
  return orderLines.find((line) => line.id === orderLineId)?.appliedPromoName ?? null;
}
