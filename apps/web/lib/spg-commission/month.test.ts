import { describe, expect, it } from "vitest";
import { compareYearMonth, isYearMonth, wibYearMonth } from "./month";

describe("isYearMonth", () => {
  it("accepts a zero-padded YYYY-MM", () => {
    expect(isYearMonth("2026-10")).toBe(true);
    expect(isYearMonth("2026-01")).toBe(true);
    expect(isYearMonth("2026-12")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth("2026-00")).toBe(false);
    expect(isYearMonth("2026-1")).toBe(false);
    expect(isYearMonth("26-10")).toBe(false);
    expect(isYearMonth("2026-10-01")).toBe(false);
    expect(isYearMonth(" 2026-10")).toBe(false);
    expect(isYearMonth("")).toBe(false);
    expect(isYearMonth(undefined)).toBe(false);
    expect(isYearMonth(202610)).toBe(false);
  });
});

describe("wibYearMonth", () => {
  it("names the WIB month, not the UTC one, across a month boundary", () => {
    expect(wibYearMonth(new Date("2026-10-31T16:59:59.999Z"))).toBe("2026-10");
    expect(wibYearMonth(new Date("2026-10-31T17:00:00.000Z"))).toBe("2026-11");
    expect(wibYearMonth(new Date("2026-10-31T17:30:00.000Z"))).toBe("2026-11");
  });

  it("rolls the year at WIB midnight on 1 January", () => {
    expect(wibYearMonth(new Date("2026-12-31T16:59:59.999Z"))).toBe("2026-12");
    expect(wibYearMonth(new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01");
  });

  it("returns a key isYearMonth accepts", () => {
    expect(isYearMonth(wibYearMonth(new Date("2026-03-05T03:00:00.000Z")))).toBe(true);
  });
});

describe("compareYearMonth", () => {
  it("orders months chronologically, across a year boundary", () => {
    expect(compareYearMonth("2026-10", "2026-11")).toBeLessThan(0);
    expect(compareYearMonth("2026-12", "2027-01")).toBeLessThan(0);
    expect(compareYearMonth("2027-01", "2026-12")).toBeGreaterThan(0);
    expect(compareYearMonth("2026-10", "2026-10")).toBe(0);
  });
});
