import { describe, expect, it } from "vitest";
import { apportion } from "./apportion";

describe("apportion", () => {
  it("keeps exact whole splits", () => {
    expect(apportion(100, [33, 33, 34])).toEqual([33, 33, 34]);
  });

  it("gives the extra unit to the largest remainder", () => {
    expect(apportion(10, [33, 33, 34])).toEqual([3, 3, 4]);
  });

  it("breaks ties toward the lower index", () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(7, [50, 50])).toEqual([4, 3]);
  });

  it("uses 0.01 steps for a non-integer total", () => {
    expect(apportion(10.5, [50, 50])).toEqual([5.25, 5.25]);
  });

  it("returns zeros for all-zero weights and [] for none", () => {
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
    expect(apportion(5, [])).toEqual([]);
  });

  it("always sums to the total", () => {
    const parts = apportion(97, [13.7, 22.1, 9.9, 18.3, 7.7, 16.4, 11.9]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(97);
    expect(parts.every((p) => Number.isInteger(p))).toBe(true);
  });
});
