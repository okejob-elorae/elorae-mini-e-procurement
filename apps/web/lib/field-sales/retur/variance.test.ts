import { describe, it, expect } from "vitest";
import { lineVariance, isSettled } from "./variance";

describe("lineVariance", () => {
  it("is negative when received is short of claimed", () => {
    expect(lineVariance(3, 1)).toBe(-2);
  });

  it("is positive when received exceeds claimed (surplus)", () => {
    expect(lineVariance(2, 5)).toBe(3);
  });

  it("is zero when received matches claimed exactly", () => {
    expect(lineVariance(4, 4)).toBe(0);
  });

  it("is zero when the line has not been received yet", () => {
    expect(lineVariance(4, null)).toBe(0);
  });
});

describe("isSettled", () => {
  it("is true for SALESMAN_BEARS", () => {
    expect(isSettled("SALESMAN_BEARS")).toBe(true);
  });

  it("is true for WRITE_OFF", () => {
    expect(isSettled("WRITE_OFF")).toBe(true);
  });

  it("is true for ACCEPT_SURPLUS", () => {
    expect(isSettled("ACCEPT_SURPLUS")).toBe(true);
  });

  it("is false for INVESTIGATE — it holds for re-check, it does not settle", () => {
    expect(isSettled("INVESTIGATE")).toBe(false);
  });

  it("is false for null — no resolution has ever been recorded", () => {
    expect(isSettled(null)).toBe(false);
  });

  it("is false for an unrecognised value", () => {
    expect(isSettled("SOMETHING_ELSE")).toBe(false);
  });
});
