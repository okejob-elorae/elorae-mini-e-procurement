import { describe, it, expect } from "vitest";
import { distributeDiscountProRata } from "./promo-distribute";

describe("distributeDiscountProRata", () => {
  it("splits proportionally by line total", () => {
    expect(distributeDiscountProRata([100, 300], 40)).toEqual([10, 30]);
  });
  it("largest-remainder: sum equals the item discount exactly (no rounding drift)", () => {
    const out = distributeDiscountProRata([100, 100, 100], 10); // 3.33 each
    expect(out.reduce((s, n) => s + n, 0)).toBe(10);
    expect(out.every((n) => Number.isInteger(n))).toBe(true);
  });
  it("zero discount → zeros", () => {
    expect(distributeDiscountProRata([100, 200], 0)).toEqual([0, 0]);
  });
  it("single line → whole discount", () => {
    expect(distributeDiscountProRata([500], 37)).toEqual([37]);
  });
  it("all-zero line totals → zeros (no divide-by-zero)", () => {
    expect(distributeDiscountProRata([0, 0], 0)).toEqual([0, 0]);
  });
});
