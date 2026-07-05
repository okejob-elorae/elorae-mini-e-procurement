export type PromoType = "PERCENT" | "FIXED" | "TIERED";
export type PromoLevel = "LINE" | "ORDER";
export type PromoTierInput = { minQty: number; unitPrice: number };
export type PromoInput = {
  id: string;
  type: PromoType;
  level: PromoLevel;
  value: number | null;
  minQty: number | null;
  minOrderSubtotal: number | null;
  minOrderQty: number | null;
  priority: number;
  itemIds: string[];
  tiers: PromoTierInput[];
};
export type PromoOrderLine = { itemId: string; qty: number; unitPrice: number; avgCost: number };
export type PromoLineResult = { discountAmount: number; appliedPromoId: string | null; belowCost: boolean };
export type PromoOrderResult = { lines: PromoLineResult[]; orderDiscountAmount: number; appliedOrderPromoId: string | null };

// Deterministic pick of the highest-discount candidate; tiebreak higher priority then lexicographically-lower id.
function pickBest<T extends { discount: number; promo: PromoInput }>(cands: T[]): T | null {
  let best: T | null = null;
  for (const c of cands) {
    if (c.discount <= 0) continue;
    if (
      !best ||
      c.discount > best.discount ||
      (c.discount === best.discount && c.promo.priority > best.promo.priority) ||
      (c.discount === best.discount && c.promo.priority === best.promo.priority && c.promo.id < best.promo.id)
    ) {
      best = c;
    }
  }
  return best;
}

function lineDiscount(promo: PromoInput, line: PromoOrderLine): number {
  const lineTotal = line.qty * line.unitPrice;
  if (promo.minQty !== null && line.qty < promo.minQty) return 0;
  if (promo.type === "PERCENT") return promo.value === null ? 0 : (lineTotal * promo.value) / 100;
  if (promo.type === "FIXED") return promo.value === null ? 0 : Math.min(promo.value * line.qty, lineTotal);
  if (promo.type === "TIERED") {
    let tierPrice: number | null = null;
    let bestMin = -1;
    for (const t of promo.tiers) {
      if (line.qty >= t.minQty && t.minQty > bestMin) {
        bestMin = t.minQty;
        tierPrice = t.unitPrice;
      }
    }
    if (tierPrice === null) return 0;
    return Math.max(0, lineTotal - tierPrice * line.qty);
  }
  return 0;
}

export function computeOrderPromos(input: { lines: PromoOrderLine[]; activePromos: PromoInput[] }): PromoOrderResult {
  const linePromos = input.activePromos.filter((p) => p.level === "LINE");
  const orderPromos = input.activePromos.filter((p) => p.level === "ORDER");

  const lines: PromoLineResult[] = input.lines.map((line) => {
    const lineTotal = line.qty * line.unitPrice;
    const cands = linePromos
      .filter((p) => p.itemIds.includes(line.itemId))
      .map((promo) => ({ promo, discount: Math.min(lineDiscount(promo, line), lineTotal) }));
    const best = pickBest(cands);
    const discountAmount = best ? best.discount : 0;
    const netUnit = line.qty > 0 ? (lineTotal - discountAmount) / line.qty : 0;
    return { discountAmount, appliedPromoId: best ? best.promo.id : null, belowCost: line.qty > 0 && netUnit < line.avgCost };
  });

  const subtotal = input.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const lineDiscTotal = lines.reduce((s, l) => s + l.discountAmount, 0);
  const netSubtotal = subtotal - lineDiscTotal;
  const totalQty = input.lines.reduce((s, l) => s + l.qty, 0);

  const orderCands = orderPromos
    .filter((p) => (p.minOrderSubtotal === null || netSubtotal >= p.minOrderSubtotal) && (p.minOrderQty === null || totalQty >= p.minOrderQty))
    .map((promo) => {
      let discount = 0;
      if (promo.type === "PERCENT" && promo.value !== null) discount = (netSubtotal * promo.value) / 100;
      else if (promo.type === "FIXED" && promo.value !== null) discount = Math.min(promo.value, netSubtotal);
      // TIERED is line-level only (backoffice validation enforces level=LINE for TIERED); order-level TIERED yields no discount.
      return { promo, discount: Math.min(discount, netSubtotal) };
    });
  const bestOrder = netSubtotal > 0 ? pickBest(orderCands) : null;

  return {
    lines,
    orderDiscountAmount: bestOrder ? bestOrder.discount : 0,
    appliedOrderPromoId: bestOrder ? bestOrder.promo.id : null,
  };
}
