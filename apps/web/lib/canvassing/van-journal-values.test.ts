import { describe, expect, it } from "vitest";
import { lineCostTotal, reconcileSplit } from "./van-journal-values";

describe("lineCostTotal", () => {
  it("sums qty times unit cost across lines", () => {
    expect(lineCostTotal([{ qty: 3, unitCost: 1000 }, { qty: 2, unitCost: 2500 }])).toBe(8000);
  });

  it("returns zero for no lines", () => {
    expect(lineCostTotal([])).toBe(0);
  });

  it("rounds to cents so the journal cannot be rejected as unbalanced", () => {
    const total = lineCostTotal([{ qty: 3, unitCost: 0.1 }, { qty: 3, unitCost: 0.2 }]);
    expect(total).toBe(0.9);
    expect(Math.round(total * 100)).toBe(total * 100);
  });

  it("handles fractional quantities", () => {
    expect(lineCostTotal([{ qty: 2.5, unitCost: 400 }])).toBe(1000);
  });

  it("rounds per-line before summing, not sum-then-round: pins rounding strategy", () => {
    /*
     * This test discriminates between the correct per-line rounding strategy
     * and a broken sum-then-round approach. Three lines of { qty: 1, unitCost: 0.005 }:
     * - Per-line rounding (correct): 0.005 → rounds to 1¢ per line → 3 lines = 3¢ → 0.03
     * - Sum-then-round (wrong): raw sum 0.015 → 1.5¢ → rounds to 2¢ → 0.02
     */
    expect(lineCostTotal([
      { qty: 1, unitCost: 0.005 },
      { qty: 1, unitCost: 0.005 },
      { qty: 1, unitCost: 0.005 },
    ])).toBe(0.03);
  });
});

describe("reconcileSplit", () => {
  it("splits returned value from variance value", () => {
    const split = reconcileSplit([
      { countedQty: 8, varianceQty: 2, unitCost: 1000 },
      { countedQty: 5, varianceQty: 0, unitCost: 500 },
    ]);
    expect(split.returned).toBe(10_500);
    expect(split.variance).toBe(2_000);
  });

  it("reports zero variance when everything was counted", () => {
    const split = reconcileSplit([{ countedQty: 10, varianceQty: 0, unitCost: 1000 }]);
    expect(split.returned).toBe(10_000);
    expect(split.variance).toBe(0);
  });

  it("reports zero returned when the van sold out and only variance remains", () => {
    const split = reconcileSplit([{ countedQty: 0, varianceQty: 3, unitCost: 1000 }]);
    expect(split.returned).toBe(0);
    expect(split.variance).toBe(3_000);
  });

  it("keeps a negative variance (counted more than expected) as a negative value", () => {
    const split = reconcileSplit([{ countedQty: 12, varianceQty: -2, unitCost: 1000 }]);
    expect(split.returned).toBe(12_000);
    expect(split.variance).toBe(-2_000);
  });

  it("rounds per-line on both accumulators before summing: pins rounding strategy", () => {
    /*
     * This test discriminates between the correct per-line rounding strategy
     * and a broken sum-then-round approach. Three lines of { countedQty: 1, varianceQty: 1, unitCost: 0.005 }:
     * - Per-line rounding (correct): each value 0.005 → rounds to 1¢ per line → 3 lines = 3¢ per accumulator → 0.03
     * - Sum-then-round (wrong): raw sum 0.015 → 1.5¢ → rounds to 2¢ → 0.02
     */
    const split = reconcileSplit([
      { countedQty: 1, varianceQty: 1, unitCost: 0.005 },
      { countedQty: 1, varianceQty: 1, unitCost: 0.005 },
      { countedQty: 1, varianceQty: 1, unitCost: 0.005 },
    ]);
    expect(split.returned).toBe(0.03);
    expect(split.variance).toBe(0.03);
  });
});
