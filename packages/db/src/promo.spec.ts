import { describe, it, expect } from "vitest";
import { computeOrderPromos, type PromoInput, type PromoOrderLine } from "./promo";

const line = (o: Partial<PromoOrderLine> & { itemId: string; qty: number; unitPrice: number }): PromoOrderLine =>
  ({ avgCost: 0, ...o });

describe("computeOrderPromos", () => {
  it("no promos → zero discounts", () => {
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 2, unitPrice: 100 })], activePromos: [] });
    expect(r.lines[0]).toEqual({ discountAmount: 0, appliedPromoId: null, belowCost: false });
    expect(r.orderDiscountAmount).toBe(0);
    expect(r.appliedOrderPromoId).toBeNull();
  });

  it("PERCENT line promo discounts matching line", () => {
    const promo: PromoInput = { id: "p1", type: "PERCENT", level: "LINE", value: 10, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 2, unitPrice: 100 })], activePromos: [promo] });
    expect(r.lines[0].discountAmount).toBe(20); // 10% of 200
    expect(r.lines[0].appliedPromoId).toBe("p1");
  });

  it("FIXED is per-unit, capped at line total", () => {
    const promo: PromoInput = { id: "p1", type: "FIXED", level: "LINE", value: 30, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 3, unitPrice: 100 })], activePromos: [promo] });
    expect(r.lines[0].discountAmount).toBe(90); // 30 * 3
    const r2 = computeOrderPromos({ lines: [line({ itemId: "a", qty: 2, unitPrice: 10 })], activePromos: [promo] });
    expect(r2.lines[0].discountAmount).toBe(20); // 30*2=60 capped at lineTotal 20
  });

  it("TIERED uses the highest tier reached", () => {
    const promo: PromoInput = { id: "p1", type: "TIERED", level: "LINE", value: null, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [{ minQty: 5, unitPrice: 90 }, { minQty: 10, unitPrice: 80 }] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 10, unitPrice: 100 })], activePromos: [promo] });
    expect(r.lines[0].discountAmount).toBe(200); // lineTotal 1000 - 80*10=800
    const r2 = computeOrderPromos({ lines: [line({ itemId: "a", qty: 3, unitPrice: 100 })], activePromos: [promo] });
    expect(r2.lines[0].discountAmount).toBe(0); // below first tier
  });

  it("line minQty gates the promo", () => {
    const promo: PromoInput = { id: "p1", type: "PERCENT", level: "LINE", value: 10, minQty: 5, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    expect(computeOrderPromos({ lines: [line({ itemId: "a", qty: 3, unitPrice: 100 })], activePromos: [promo] }).lines[0].discountAmount).toBe(0);
    expect(computeOrderPromos({ lines: [line({ itemId: "a", qty: 5, unitPrice: 100 })], activePromos: [promo] }).lines[0].discountAmount).toBe(50);
  });

  it("best-value line promo wins; tiebreak on priority then id", () => {
    const p10: PromoInput = { id: "b", type: "PERCENT", level: "LINE", value: 10, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const p20: PromoInput = { id: "c", type: "PERCENT", level: "LINE", value: 20, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 1, unitPrice: 100 })], activePromos: [p10, p20] });
    expect(r.lines[0].appliedPromoId).toBe("c"); // 20 > 10
  });

  it("order promo applies on net subtotal after line discounts", () => {
    const lineP: PromoInput = { id: "l", type: "PERCENT", level: "LINE", value: 10, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const orderP: PromoInput = { id: "o", type: "PERCENT", level: "ORDER", value: 10, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: [], tiers: [] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 1, unitPrice: 1000 })], activePromos: [lineP, orderP] });
    expect(r.lines[0].discountAmount).toBe(100); // 10% line
    expect(r.orderDiscountAmount).toBe(90); // 10% of net 900, not gross 1000
    expect(r.appliedOrderPromoId).toBe("o");
  });

  it("order promo gated by minOrderSubtotal / minOrderQty on net", () => {
    const orderP: PromoInput = { id: "o", type: "FIXED", level: "ORDER", value: 50, minQty: null, minOrderSubtotal: 1000, minOrderQty: null, priority: 0, itemIds: [], tiers: [] };
    expect(computeOrderPromos({ lines: [line({ itemId: "a", qty: 1, unitPrice: 500 })], activePromos: [orderP] }).orderDiscountAmount).toBe(0);
    expect(computeOrderPromos({ lines: [line({ itemId: "a", qty: 1, unitPrice: 1500 })], activePromos: [orderP] }).orderDiscountAmount).toBe(50);
  });

  it("flags belowCost when net unit < avgCost", () => {
    const promo: PromoInput = { id: "p1", type: "PERCENT", level: "LINE", value: 50, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 1, unitPrice: 100, avgCost: 70 })], activePromos: [promo] });
    expect(r.lines[0].discountAmount).toBe(50); // net unit 50 < cost 70
    expect(r.lines[0].belowCost).toBe(true);
  });

  it("order-level TIERED promo yields no discount", () => {
    const orderTiered: PromoInput = { id: "ot1", type: "TIERED", level: "ORDER", value: null, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: [], tiers: [{ minQty: 5, unitPrice: 80 }] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 10, unitPrice: 100 })], activePromos: [orderTiered] });
    expect(r.orderDiscountAmount).toBe(0);
    expect(r.appliedOrderPromoId).toBeNull();
  });

  it("qty 0 line never flags belowCost", () => {
    const promo: PromoInput = { id: "p1", type: "PERCENT", level: "LINE", value: 10, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 0, unitPrice: 100, avgCost: 50 })], activePromos: [promo] });
    expect(r.lines[0].belowCost).toBe(false);
    expect(r.lines[0].discountAmount).toBe(0);
  });
});
