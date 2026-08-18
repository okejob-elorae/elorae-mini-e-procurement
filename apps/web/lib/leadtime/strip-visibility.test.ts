import { describe, expect, it } from "vitest";
import {
  shouldCollapseToCompletedSummary,
  shouldHideLiveStrip,
} from "./strip-visibility";

describe("shouldHideLiveStrip", () => {
  it("hides a cancelled PO, not a closed or over-received one", () => {
    expect(shouldHideLiveStrip("PO", "CANCELLED")).toBe(true);
    expect(shouldHideLiveStrip("PO", "CLOSED")).toBe(false);
    expect(shouldHideLiveStrip("PO", "OVER")).toBe(false);
    expect(shouldHideLiveStrip("PO", "SUBMITTED")).toBe(false);
  });

  it("hides draft and cancelled WOs", () => {
    expect(shouldHideLiveStrip("WO", "DRAFT")).toBe(true);
    expect(shouldHideLiveStrip("WO", "CANCELLED")).toBe(true);
    expect(shouldHideLiveStrip("WO", "IN_PRODUCTION")).toBe(false);
    expect(shouldHideLiveStrip("WO", "COMPLETED")).toBe(false);
  });
});

describe("shouldCollapseToCompletedSummary", () => {
  it("collapses a completed WO, not a closed PO", () => {
    expect(shouldCollapseToCompletedSummary("WO", "COMPLETED")).toBe(true);
    expect(shouldCollapseToCompletedSummary("PO", "CLOSED")).toBe(false);
    expect(shouldCollapseToCompletedSummary("PO", "OVER")).toBe(false);
  });
});
