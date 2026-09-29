import { describe, it, expect } from "vitest";
import { undeliveredResidual } from "./undelivered-residual";

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
