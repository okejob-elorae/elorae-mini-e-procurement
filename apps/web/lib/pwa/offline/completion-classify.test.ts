import { describe, it, expect } from "vitest";
import { classifyCompletionResult } from "./completion-classify";

describe("classifyCompletionResult", () => {
  it("classifies ok as evict", () => {
    expect(classifyCompletionResult({ ok: true })).toBe("evict");
  });

  it("classifies a thrown/network failure as retry", () => {
    expect(classifyCompletionResult({ thrown: true })).toBe("retry");
  });

  it("classifies FORBIDDEN as retry (unattended queue must wait for re-login, not drop the row)", () => {
    expect(classifyCompletionResult({ ok: false, reason: "FORBIDDEN" })).toBe("retry");
  });

  it("classifies UNEXPECTED as retry", () => {
    expect(classifyCompletionResult({ ok: false, reason: "UNEXPECTED" })).toBe("retry");
  });

  it.each([
    "NOT_FOUND", "INVALID_STATE", "OVER_PLANNED", "LINE_MISMATCH", "INVALID_QTY", "NO_LINES",
    "NOT_CARRIER", "MISSING_PROOF", "MISSING_NOTA_PHOTO", "MISSING_SIGNED_BY", "MISSING_GPS",
    "STORE_NOT_GEOCODED", "GPS_OUT_OF_RADIUS", "MISSING_DATES", "MISSING_CARRIER", "MISSING_RESI",
    "OVER_DELIVER", "INSUFFICIENT_STOCK", "INVALID_DATES", "INVALID_REQUEST",
  ])("classifies %s as terminal", (reason) => {
    expect(classifyCompletionResult({ ok: false, reason })).toBe("terminal");
  });

  it("classifies an unrecognized reason as retry (fail open toward retry, never silently discard)", () => {
    expect(classifyCompletionResult({ ok: false, reason: "SOME_FUTURE_CODE" })).toBe("retry");
  });
});
