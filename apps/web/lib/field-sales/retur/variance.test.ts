import { describe, it, expect } from "vitest";
import { lineVariance, isSettled, allDiscrepantLinesSettled, isValidResolutionDirection } from "./variance";

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

describe("isValidResolutionDirection", () => {
  it("accepts SALESMAN_BEARS on a shortage (variance < 0)", () => {
    expect(isValidResolutionDirection("SALESMAN_BEARS", -2)).toBe(true);
  });

  it("accepts WRITE_OFF on a shortage", () => {
    expect(isValidResolutionDirection("WRITE_OFF", -2)).toBe(true);
  });

  it("rejects ACCEPT_SURPLUS on a shortage", () => {
    expect(isValidResolutionDirection("ACCEPT_SURPLUS", -2)).toBe(false);
  });

  it("accepts ACCEPT_SURPLUS on an over line (variance > 0)", () => {
    expect(isValidResolutionDirection("ACCEPT_SURPLUS", 3)).toBe(true);
  });

  it("rejects SALESMAN_BEARS on an over line", () => {
    expect(isValidResolutionDirection("SALESMAN_BEARS", 3)).toBe(false);
  });

  it("rejects WRITE_OFF on an over line", () => {
    expect(isValidResolutionDirection("WRITE_OFF", 3)).toBe(false);
  });

  it("accepts INVESTIGATE on a shortage", () => {
    expect(isValidResolutionDirection("INVESTIGATE", -2)).toBe(true);
  });

  it("accepts INVESTIGATE on an over line", () => {
    expect(isValidResolutionDirection("INVESTIGATE", 3)).toBe(true);
  });

  it("rejects everything when variance is zero — a settled direction check has no direction", () => {
    expect(isValidResolutionDirection("INVESTIGATE", 0)).toBe(false);
  });

  it("rejects an unrecognised type in either direction", () => {
    expect(isValidResolutionDirection("SOMETHING_ELSE", -2)).toBe(false);
    expect(isValidResolutionDirection("SOMETHING_ELSE", 3)).toBe(false);
  });
});

describe("allDiscrepantLinesSettled", () => {
  it("counts a line with zero variance and no resolutions as settled", () => {
    const settled = allDiscrepantLinesSettled([{ qty: 3, receivedQty: 3, resolutions: [] }]);
    expect(settled).toBe(true);
  });

  it("does not settle a line whose latest resolution is INVESTIGATE", () => {
    const settled = allDiscrepantLinesSettled([
      { qty: 5, receivedQty: 2, resolutions: [{ type: "INVESTIGATE" }] },
    ]);
    expect(settled).toBe(false);
  });

  it("settles a line whose latest resolution is SALESMAN_BEARS", () => {
    const settled = allDiscrepantLinesSettled([
      { qty: 5, receivedQty: 2, resolutions: [{ type: "SALESMAN_BEARS" }] },
    ]);
    expect(settled).toBe(true);
  });

  it("does not settle a discrepant line with no resolutions at all", () => {
    const settled = allDiscrepantLinesSettled([{ qty: 5, receivedQty: 2, resolutions: [] }]);
    expect(settled).toBe(false);
  });

  it("only looks at the latest (first) resolution, not every past one", () => {
    const settled = allDiscrepantLinesSettled([
      { qty: 5, receivedQty: 2, resolutions: [{ type: "INVESTIGATE" }, { type: "WRITE_OFF" }] },
    ]);
    expect(settled).toBe(false);
  });

  it("requires every discrepant line to settle, not just one of several", () => {
    const settled = allDiscrepantLinesSettled([
      { qty: 5, receivedQty: 2, resolutions: [{ type: "SALESMAN_BEARS" }] },
      { qty: 4, receivedQty: 1, resolutions: [{ type: "INVESTIGATE" }] },
    ]);
    expect(settled).toBe(false);
  });

  it("passes when every line is either non-discrepant or settled", () => {
    const settled = allDiscrepantLinesSettled([
      { qty: 3, receivedQty: 3, resolutions: [] },
      { qty: 5, receivedQty: 2, resolutions: [{ type: "WRITE_OFF" }] },
      { qty: 2, receivedQty: 4, resolutions: [{ type: "ACCEPT_SURPLUS" }] },
    ]);
    expect(settled).toBe(true);
  });
});
