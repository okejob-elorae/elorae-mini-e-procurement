import { describe, expect, it } from "vitest";
import {
  applyDirection,
  classifyVariance,
  isCronEnabled,
  parseReconDirection,
  parseReconThreshold,
} from "./reconciliation";

describe("classifyVariance", () => {
  it("returns IN_SYNC for zero variance", () => {
    expect(classifyVariance(0, 5, "MATCH_JUBELIO")).toEqual({
      action: "IN_SYNC",
      needsStockWrite: false,
      needsPush: false,
    });
  });

  it("flags all non-zero when FLAG_ONLY regardless of threshold", () => {
    expect(classifyVariance(3, 5, "FLAG_ONLY")).toEqual({
      action: "FLAGGED",
      needsStockWrite: false,
      needsPush: false,
    });
    expect(classifyVariance(-2, 10, "FLAG_ONLY").action).toBe("FLAGGED");
  });

  it("auto-corrects within threshold for MATCH_JUBELIO", () => {
    expect(classifyVariance(4, 5, "MATCH_JUBELIO")).toEqual({
      action: "AUTO_CORRECTED",
      needsStockWrite: true,
      needsPush: false,
    });
  });

  it("flags when above threshold", () => {
    expect(classifyVariance(6, 5, "MATCH_JUBELIO").action).toBe("FLAGGED");
  });

  it("reasserts Elorae within threshold", () => {
    expect(classifyVariance(-3, 5, "REASSERT_ELORAE")).toEqual({
      action: "AUTO_CORRECTED",
      needsStockWrite: false,
      needsPush: true,
    });
  });
});

describe("applyDirection", () => {
  it("sets Elorae qty to Jubelio for MATCH_JUBELIO", () => {
    expect(applyDirection("MATCH_JUBELIO", 100, 95)).toEqual({
      newEloraeQty: 95,
      needsPush: false,
    });
  });

  it("keeps Elorae qty and pushes for REASSERT_ELORAE", () => {
    expect(applyDirection("REASSERT_ELORAE", 100, 95)).toEqual({
      newEloraeQty: 100,
      needsPush: true,
    });
  });
});

describe("config parsers", () => {
  it("defaults threshold to 0", () => {
    expect(parseReconThreshold(undefined)).toBe(0);
  });

  it("defaults direction to FLAG_ONLY", () => {
    expect(parseReconDirection(undefined)).toBe("FLAG_ONLY");
    expect(parseReconDirection("invalid")).toBe("FLAG_ONLY");
  });

  it("parses cron enabled", () => {
    expect(isCronEnabled("true")).toBe(true);
    expect(isCronEnabled("false")).toBe(false);
  });
});
