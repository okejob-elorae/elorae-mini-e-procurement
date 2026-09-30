import { describe, expect, it } from "vitest";
import {
  classifyReconRow,
  classifyVariance,
  comparableEloraeQty,
  isCronEnabled,
  parseReconDirection,
  parseReconThreshold,
  sameQty2dp,
} from "./reconciliation";

describe("comparableEloraeQty", () => {
  it("floors at 0 while pushes are enabled", () => {
    expect(comparableEloraeQty(-5, 0, true)).toBe(0);
    expect(comparableEloraeQty(10, 3, true)).toBe(7);
  });

  it("keeps a negative on-hand negative while pushes are disabled", () => {
    expect(comparableEloraeQty(-5, 0, false)).toBe(-5);
  });

  it("leaves a positive on-hand unchanged while pushes are disabled", () => {
    expect(comparableEloraeQty(10, 0, false)).toBe(10);
  });
});

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

describe("classifyReconRow", () => {
  it("FLAGS a missing Jubelio figure and never auto-corrects it, even inside the threshold", () => {
    const out = classifyReconRow({
      eloraeQty: 3,
      jubelioQty: null,
      threshold: 1_000_000,
      direction: "MATCH_JUBELIO",
      pushEnabled: true,
    });
    expect(out.classified).toEqual({ action: "FLAGGED", needsStockWrite: false, needsPush: false });
    expect(out.storedJubelioQty).toBeNull();
    expect(out.variance).toBeNull();
  });

  it("never reads a missing figure as an in-sync 0 when Elorae is also 0", () => {
    const out = classifyReconRow({
      eloraeQty: 0,
      jubelioQty: null,
      threshold: 5,
      direction: "MATCH_JUBELIO",
      pushEnabled: true,
    });
    expect(out.classified.action).toBe("FLAGGED");
  });

  it("auto-corrects a real figure within the threshold under MATCH_JUBELIO", () => {
    const out = classifyReconRow({
      eloraeQty: 10,
      jubelioQty: 8,
      threshold: 5,
      direction: "MATCH_JUBELIO",
      pushEnabled: false,
    });
    expect(out.classified.needsStockWrite).toBe(true);
    expect(out.variance).toBe(2);
    expect(out.storedJubelioQty).toBe(8);
  });

  it("degrades REASSERT_ELORAE to FLAGGED while pushes are disabled", () => {
    const out = classifyReconRow({
      eloraeQty: 10,
      jubelioQty: 8,
      threshold: 5,
      direction: "REASSERT_ELORAE",
      pushEnabled: false,
    });
    expect(out.classified).toEqual({ action: "FLAGGED", needsStockWrite: false, needsPush: false });
  });

  it("computes the variance without float drift", () => {
    const out = classifyReconRow({
      eloraeQty: 0.3,
      jubelioQty: 0.1,
      threshold: 0,
      direction: "FLAG_ONLY",
      pushEnabled: false,
    });
    expect(out.variance).toBe(0.2);
  });
});

describe("sameQty2dp", () => {
  it("treats float noise below 2dp as equal", () => {
    expect(sameQty2dp(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameQty2dp(8, 8)).toBe(true);
  });

  it("distinguishes a real 2dp difference", () => {
    expect(sameQty2dp(8.01, 8)).toBe(false);
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
