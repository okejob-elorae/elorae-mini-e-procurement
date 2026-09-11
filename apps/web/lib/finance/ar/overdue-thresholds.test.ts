import { describe, it, expect } from "vitest";
import { parseOverdueThresholds, DEFAULT_OVERDUE_THRESHOLDS } from "./overdue-thresholds";

describe("parseOverdueThresholds", () => {
  it("parses a valid comma-separated list, sorted ascending", () => {
    expect(parseOverdueThresholds("0,7,30,60")).toEqual([0, 7, 30, 60]);
  });

  it("trims surrounding spaces on each entry", () => {
    expect(parseOverdueThresholds(" 0, 7 , 30,60 ")).toEqual([0, 7, 30, 60]);
  });

  it("collapses duplicate values", () => {
    expect(parseOverdueThresholds("0,7,7,30,30")).toEqual([0, 7, 30]);
  });

  it("sorts unsorted input ascending", () => {
    expect(parseOverdueThresholds("30,0,60,7")).toEqual([0, 7, 30, 60]);
  });

  it("falls back to defaults when a value is negative", () => {
    expect(parseOverdueThresholds("-1,7,30")).toEqual(DEFAULT_OVERDUE_THRESHOLDS);
  });

  it("falls back to defaults when a value is non-numeric", () => {
    expect(parseOverdueThresholds("a,7,30")).toEqual(DEFAULT_OVERDUE_THRESHOLDS);
  });

  it("falls back to defaults for an empty string", () => {
    expect(parseOverdueThresholds("")).toEqual(DEFAULT_OVERDUE_THRESHOLDS);
  });

  it("falls back to defaults for a string of only commas and spaces", () => {
    expect(parseOverdueThresholds(" , , ")).toEqual(DEFAULT_OVERDUE_THRESHOLDS);
  });

  it("falls back to defaults for null", () => {
    expect(parseOverdueThresholds(null)).toEqual(DEFAULT_OVERDUE_THRESHOLDS);
  });

  it("falls back to defaults for undefined", () => {
    expect(parseOverdueThresholds(undefined)).toEqual(DEFAULT_OVERDUE_THRESHOLDS);
  });

  it("accepts a single threshold", () => {
    expect(parseOverdueThresholds("0")).toEqual([0]);
  });
});
