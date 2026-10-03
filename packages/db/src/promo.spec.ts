import { describe, it, expect } from "vitest";
import { computeBonusLines, computeOrderPromos, type PromoInput, type PromoOrderLine } from "./promo";

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

const bonus = (o: Partial<PromoInput> & { id: string; itemIds: string[] }): PromoInput => ({
  type: "BONUS",
  level: "LINE",
  value: null,
  minQty: null,
  minOrderSubtotal: null,
  minOrderQty: null,
  priority: 0,
  tiers: [],
  bonusBuyQty: 6,
  bonusFreeQty: 1,
  bonusItemId: null,
  ...o,
});

describe("computeOrderPromos — BONUS promos never discount", () => {
  it("a LINE-level BONUS promo leaves the line undiscounted", () => {
    const r = computeOrderPromos({ lines: [line({ itemId: "a", qty: 12, unitPrice: 100 })], activePromos: [bonus({ id: "b", itemIds: ["a"] })] });
    expect(r.lines[0]).toEqual({ discountAmount: 0, appliedPromoId: null, belowCost: false });
  });

  it("an ORDER-level BONUS promo carrying a value still yields no order discount", () => {
    const r = computeOrderPromos({
      lines: [line({ itemId: "a", qty: 12, unitPrice: 100 })],
      activePromos: [bonus({ id: "b", level: "ORDER", value: 50, itemIds: [] })],
    });
    expect(r.orderDiscountAmount).toBe(0);
    expect(r.appliedOrderPromoId).toBeNull();
  });

  it("a BONUS promo next to a PERCENT promo does not change the PERCENT result", () => {
    const pct: PromoInput = { id: "p", type: "PERCENT", level: "LINE", value: 10, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [] };
    const sendiri = computeOrderPromos({ lines: [line({ itemId: "a", qty: 12, unitPrice: 100 })], activePromos: [pct] });
    const bersama = computeOrderPromos({ lines: [line({ itemId: "a", qty: 12, unitPrice: 100 })], activePromos: [bonus({ id: "b", itemIds: ["a"], priority: 99 }), pct] });
    expect(bersama).toEqual(sendiri);
  });
});

describe("computeBonusLines", () => {
  it("no promos → no bonus lines", () => {
    expect(computeBonusLines({ lines: [{ itemId: "a", variantSku: "", qty: 12 }], activePromos: [] })).toEqual([]);
  });

  it("same simple item: floor(qty / buy) × free", () => {
    const r = computeBonusLines({ lines: [{ itemId: "a", variantSku: "", qty: 13 }], activePromos: [bonus({ id: "b", itemIds: ["a"] })] });
    expect(r).toEqual([{ promoId: "b", itemId: "a", variantSku: "", qty: 2, itemIds: ["a"], qtyDibeli: 13 }]);
  });

  it("below the threshold → nothing", () => {
    expect(computeBonusLines({ lines: [{ itemId: "a", variantSku: "", qty: 5 }], activePromos: [bonus({ id: "b", itemIds: ["a"] })] })).toEqual([]);
  });

  it("variants are aggregated per item and the free units go to the largest variant", () => {
    const r = computeBonusLines({
      lines: [
        { itemId: "a", variantSku: "A-S", qty: 4 },
        { itemId: "a", variantSku: "A-M", qty: 5 },
      ],
      activePromos: [bonus({ id: "b", itemIds: ["a"], bonusBuyQty: 3, bonusFreeQty: 1 })],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ itemId: "a", variantSku: "A-M", qty: 3, qtyDibeli: 9 });
  });

  it("a variant tie goes to the variant ordered first", () => {
    const r = computeBonusLines({
      lines: [
        { itemId: "a", variantSku: "A-L", qty: 3 },
        { itemId: "a", variantSku: "A-S", qty: 3 },
      ],
      activePromos: [bonus({ id: "b", itemIds: ["a"] })],
    });
    expect(r[0].variantSku).toBe("A-L");
  });

  it("a gift item that is not on the order comes back with variantSku null", () => {
    const r = computeBonusLines({
      lines: [{ itemId: "a", variantSku: "", qty: 12 }],
      activePromos: [bonus({ id: "b", itemIds: ["a"], bonusItemId: "hadiah", bonusFreeQty: 2 })],
    });
    expect(r).toEqual([{ promoId: "b", itemId: "hadiah", variantSku: null, qty: 4, itemIds: ["a"], qtyDibeli: 12 }]);
  });

  it("a gift item that IS on the order takes its largest ordered variant", () => {
    const r = computeBonusLines({
      lines: [
        { itemId: "a", variantSku: "", qty: 6 },
        { itemId: "g", variantSku: "G-S", qty: 1 },
        { itemId: "g", variantSku: "G-M", qty: 2 },
      ],
      activePromos: [bonus({ id: "b", itemIds: ["a"], bonusItemId: "g" })],
    });
    expect(r[0]).toMatchObject({ itemId: "g", variantSku: "G-M", qty: 1 });
  });

  it("one bonus promo per item: the one giving the most free units wins", () => {
    const r = computeBonusLines({
      lines: [{ itemId: "a", variantSku: "", qty: 13 }],
      activePromos: [
        bonus({ id: "p1", itemIds: ["a"], bonusBuyQty: 6 }),
        bonus({ id: "p2", itemIds: ["a"], bonusBuyQty: 4 }),
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ promoId: "p2", qty: 3 });
  });

  it("equal free units: higher priority, then lower id", () => {
    const hasil = (promos: PromoInput[]) => computeBonusLines({ lines: [{ itemId: "a", variantSku: "", qty: 6 }], activePromos: promos })[0].promoId;
    expect(hasil([bonus({ id: "x", itemIds: ["a"], priority: 1 }), bonus({ id: "y", itemIds: ["a"], priority: 5 })])).toBe("y");
    expect(hasil([bonus({ id: "y", itemIds: ["a"] }), bonus({ id: "x", itemIds: ["a"] })])).toBe("x");
  });

  it("a multi-item promo counts its items together and gives the most-ordered one", () => {
    const r = computeBonusLines({
      lines: [
        { itemId: "a", variantSku: "", qty: 4 },
        { itemId: "b", variantSku: "", qty: 3 },
      ],
      activePromos: [bonus({ id: "p", itemIds: ["a", "b"] })],
    });
    expect(r).toEqual([{ promoId: "p", itemId: "a", variantSku: "", qty: 1, itemIds: ["a", "b"], qtyDibeli: 7 }]);
  });

  it("an item claimed by a better promo no longer counts for another", () => {
    const r = computeBonusLines({
      lines: [
        { itemId: "a", variantSku: "", qty: 6 },
        { itemId: "b", variantSku: "", qty: 6 },
      ],
      activePromos: [
        bonus({ id: "p1", itemIds: ["a", "b"] }),
        bonus({ id: "p2", itemIds: ["b"], bonusBuyQty: 2 }),
      ],
    });
    expect(r).toEqual([
      { promoId: "p2", itemId: "b", variantSku: "", qty: 3, itemIds: ["b"], qtyDibeli: 6 },
      { promoId: "p1", itemId: "a", variantSku: "", qty: 1, itemIds: ["a"], qtyDibeli: 6 },
    ]);
  });

  it("promos with a missing or zero buy/free quantity are ignored", () => {
    const r = computeBonusLines({
      lines: [{ itemId: "a", variantSku: "", qty: 12 }],
      activePromos: [
        bonus({ id: "p1", itemIds: ["a"], bonusBuyQty: null }),
        bonus({ id: "p2", itemIds: ["a"], bonusFreeQty: 0 }),
        bonus({ id: "p3", itemIds: ["a"], bonusBuyQty: 1.5 }),
      ],
    });
    expect(r).toEqual([]);
  });

  it("non-BONUS promos never produce bonus lines", () => {
    const pct: PromoInput = { id: "p", type: "PERCENT", level: "LINE", value: 10, minQty: null, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: ["a"], tiers: [], bonusBuyQty: 1, bonusFreeQty: 1 };
    expect(computeBonusLines({ lines: [{ itemId: "a", variantSku: "", qty: 12 }], activePromos: [pct] })).toEqual([]);
  });

  it("respects the date window and store scope when those fields are present", () => {
    const now = new Date("2026-09-30T05:00:00Z");
    const lines = [{ itemId: "a", variantSku: "", qty: 6 }];
    const run = (p: Partial<PromoInput>) => computeBonusLines({ lines, activePromos: [bonus({ id: "b", itemIds: ["a"], ...p })], now, storeId: "s1" });
    expect(run({ startsAt: new Date("2026-10-01T00:00:00Z") })).toEqual([]);
    expect(run({ endsAt: new Date("2026-09-29T00:00:00Z") })).toEqual([]);
    expect(run({ allStores: false, storeIds: ["s2"] })).toEqual([]);
    expect(run({ allStores: false, storeIds: ["s1"], startsAt: new Date("2026-09-01T00:00:00Z") })).toHaveLength(1);
  });

  it("zero-qty lines do not count and do not pick the variant", () => {
    const r = computeBonusLines({
      lines: [
        { itemId: "a", variantSku: "A-S", qty: 0 },
        { itemId: "a", variantSku: "A-M", qty: 6 },
      ],
      activePromos: [bonus({ id: "b", itemIds: ["a"] })],
    });
    expect(r[0].variantSku).toBe("A-M");
  });
});
