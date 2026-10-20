import { describe, it, expect } from "vitest";
import { deliveredGoodsValue, undeliveredResidual } from "./undelivered-residual";

describe("undeliveredResidual", () => {
  it("returns the whole order total when nothing was delivered", () => {
    expect(undeliveredResidual(1000, [])).toBe(1000);
  });

  it("returns the difference after a partial delivery", () => {
    expect(undeliveredResidual(800, [300])).toBe(500);
  });

  it("subtracts every delivery of the order", () => {
    expect(undeliveredResidual(1000, [250, 250, 100])).toBe(400);
  });

  it("floors an over-delivered order at zero instead of going negative", () => {
    expect(undeliveredResidual(500, [400, 300])).toBe(0);
  });

  /* No rounding happens here: the floor absorbs NEGATIVE float drift, while positive drift (e.g. 0.8 − [0.1, 0.7]) survives as ~1e-16, which formatIdr renders as 0. */
  it("floors negative float drift to zero and sums decimal totals within float precision", () => {
    expect(undeliveredResidual(0.3, [0.1, 0.2])).toBe(0);
    expect(undeliveredResidual(100.5, [50.25, 25.125])).toBeCloseTo(25.125, 10);
  });

  it("returns zero for an empty or zero total", () => {
    expect(undeliveredResidual(0, [])).toBe(0);
    expect(undeliveredResidual(0, [10])).toBe(0);
  });
});

describe("deliveredGoodsValue", () => {
  it("is the exact net of both discount levels, not a rounded figure", () => {
    expect(deliveredGoodsValue({ subtotal: 2000, discountAmount: 0, lineDiscounts: [100.6] })).toBeCloseTo(1899.4, 10);
  });

  it("subtracts the header discount and every line discount", () => {
    expect(deliveredGoodsValue({ subtotal: 10000, discountAmount: 500, lineDiscounts: [600, 400] })).toBe(8500);
  });

  it("is the subtotal when nothing is discounted", () => {
    expect(deliveredGoodsValue({ subtotal: 1000, discountAmount: 0, lineDiscounts: [] })).toBe(1000);
  });

  it("leaves a fully delivered order with no residual when its rounded total fell under the order total", () => {
    /* Order total 1899.40, charged as 1899: residual against the total would be 0.40 forever. */
    const exact = deliveredGoodsValue({ subtotal: 2000, discountAmount: 0, lineDiscounts: [100.6] });
    expect(undeliveredResidual(1899.4, [exact])).toBeCloseTo(0, 6);
    expect(undeliveredResidual(1899.4, [1899])).toBeCloseTo(0.4, 6);
  });
});
