import { describe, expect, it } from "vitest";
import { overReceiveBy, sumRollLengths } from "./over-receive";

describe("sumRollLengths", () => {
  it("sums decimal lengths exactly", () => {
    expect(sumRollLengths([50.1, 50.2])).toBe(100.3);
  });

  it("returns 0 for no rolls", () => {
    expect(sumRollLengths([])).toBe(0);
  });
});

describe("overReceiveBy", () => {
  it("is exactly 0 when the receipt lands on the ordered quantity", () => {
    const overBy = overReceiveBy(20.1, 80.2, 100.3);
    expect(overBy.gt(0)).toBe(false);
    expect(overBy.toNumber()).toBe(0);
  });

  it("is 0 for rolls that sum to the ordered quantity", () => {
    const overBy = overReceiveBy("0", sumRollLengths([50.1, 50.2]), "100.30");
    expect(overBy.gt(0)).toBe(false);
  });

  it("is positive when over, negative when under", () => {
    expect(overReceiveBy(0, 101, 100).toNumber()).toBe(1);
    expect(overReceiveBy(0, 99, 100).toNumber()).toBe(-1);
  });
});
