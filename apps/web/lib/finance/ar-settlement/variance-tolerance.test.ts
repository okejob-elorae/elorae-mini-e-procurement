import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseVarianceTolerance,
  DEFAULT_VARIANCE_TOLERANCE,
  VARIANCE_TOLERANCE_SETTING_KEY,
} from "./variance-tolerance";

describe("parseVarianceTolerance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the settlement setting key", () => {
    expect(VARIANCE_TOLERANCE_SETTING_KEY).toBe("settlement.varianceToleranceRupiah");
  });

  it("falls back to the default when the setting is absent", () => {
    expect(parseVarianceTolerance(null)).toBe(DEFAULT_VARIANCE_TOLERANCE);
    expect(parseVarianceTolerance(undefined)).toBe(DEFAULT_VARIANCE_TOLERANCE);
  });

  it("falls back to the default on an empty or whitespace-only value", () => {
    expect(parseVarianceTolerance("")).toBe(DEFAULT_VARIANCE_TOLERANCE);
    expect(parseVarianceTolerance("   ")).toBe(DEFAULT_VARIANCE_TOLERANCE);
  });

  it("falls back to the default on a malformed value", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseVarianceTolerance("abc")).toBe(DEFAULT_VARIANCE_TOLERANCE);
    expect(parseVarianceTolerance("1,000")).toBe(DEFAULT_VARIANCE_TOLERANCE);
    expect(parseVarianceTolerance("1e6")).toBe(DEFAULT_VARIANCE_TOLERANCE);
    expect(parseVarianceTolerance("5.123")).toBe(DEFAULT_VARIANCE_TOLERANCE);
  });

  it("falls back to the default on a negative value rather than widening the gate", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseVarianceTolerance("-5")).toBe(DEFAULT_VARIANCE_TOLERANCE);
    expect(parseVarianceTolerance("-0.01")).toBe(DEFAULT_VARIANCE_TOLERANCE);
  });

  it("falls back to the default when the digits overflow to Infinity", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseVarianceTolerance("9".repeat(400))).toBe(DEFAULT_VARIANCE_TOLERANCE);
  });

  it("parses a valid whole-rupiah value", () => {
    expect(parseVarianceTolerance("500")).toBe(500);
    expect(parseVarianceTolerance("  1000  ")).toBe(1000);
    expect(parseVarianceTolerance("0")).toBe(0);
  });

  it("parses a valid two-decimal value", () => {
    expect(parseVarianceTolerance("0.50")).toBe(0.5);
    expect(parseVarianceTolerance("12.34")).toBe(12.34);
  });

  it("defaults to zero, so an unconfigured environment demands a reason for any variance", () => {
    expect(DEFAULT_VARIANCE_TOLERANCE).toBe(0);
  });
});
