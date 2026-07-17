import { describe, it, expect } from "vitest";
import type { PromoInput } from "@elorae/db/promo";
import { applyItemAggregatedPromos } from "./promo-apply";

const percentPromo = (itemId: string, pct: number, minQty: number | null = null): PromoInput => ({
  id: `p-${itemId}`, type: "PERCENT", level: "LINE", value: pct,
  minQty, minOrderSubtotal: null, minOrderQty: null, priority: 0, itemIds: [itemId], tiers: [],
});

describe("applyItemAggregatedPromos", () => {
  it("aggregates an item's variant lines, pro-rates the discount back per line", () => {
    // one item, two variant lines: 100 + 300 = 400; 10% → 40, split 10/30
    const r = applyItemAggregatedPromos(
      [
        { itemId: "a", qty: 1, unitPrice: 100, avgCost: 0 },
        { itemId: "a", qty: 3, unitPrice: 100, avgCost: 0 },
      ],
      [percentPromo("a", 10)],
    );
    expect(r.lineDiscounts).toEqual([10, 30]);
    expect(r.lineAppliedPromoId).toEqual(["p-a", "p-a"]);
  });

  it("min-qty promo evaluates on the item-summed qty (per-item, not per-variant)", () => {
    // promo needs qty >= 4; each variant is 2, sum is 4 → applies (per-item aggregate)
    const r = applyItemAggregatedPromos(
      [
        { itemId: "a", qty: 2, unitPrice: 100, avgCost: 0 },
        { itemId: "a", qty: 2, unitPrice: 100, avgCost: 0 },
      ],
      [percentPromo("a", 10, 4)],
    );
    expect(r.lineDiscounts.reduce((s, n) => s + n, 0)).toBe(40); // 10% of 400
  });

  it("no promo → zeros; alignment preserved across multiple items", () => {
    const r = applyItemAggregatedPromos(
      [
        { itemId: "a", qty: 1, unitPrice: 100, avgCost: 0 },
        { itemId: "b", qty: 1, unitPrice: 200, avgCost: 0 },
      ],
      [percentPromo("a", 50)],
    );
    expect(r.lineDiscounts).toEqual([50, 0]); // only item a discounted
  });
});
