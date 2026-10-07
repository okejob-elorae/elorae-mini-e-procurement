import { describe, expect, it } from "vitest";
import { maxIssuedNumber, resyncedCounter } from "./recover";

const oct = { year: 2026, month: 10 };

describe("maxIssuedNumber", () => {
  it("reads the highest YEARLY number of the current year, case-insensitively", () => {
    const issued = ["WO/2026/0005", "WO/2026/0012", "WO/2025/0099", "wo/2026/0013"];
    expect(maxIssuedNumber(issued, { prefix: "WO/", resetPeriod: "YEARLY" }, oct)).toBe(13);
  });

  it("reads the sequence of a MONTHLY number, not the month", () => {
    const issued = ["WO/2026/09/0005", "WO/2026/08/0040"];
    expect(maxIssuedNumber(issued, { prefix: "WO/", resetPeriod: "MONTHLY" }, { year: 2026, month: 9 })).toBe(5);
  });

  it("counts every year for a NEVER counter", () => {
    const issued = ["WO/2024/0040", "WO/2026/0007"];
    expect(maxIssuedNumber(issued, { prefix: "WO/", resetPeriod: "NEVER" }, oct)).toBe(40);
  });

  it("normalises an edited prefix without a slash and ignores old-prefix rows", () => {
    const issued = ["PRD/2026/0003", "WO/2026/0099"];
    expect(maxIssuedNumber(issued, { prefix: "PRD", resetPeriod: "YEARLY" }, oct)).toBe(3);
  });

  it("ignores numbers with a non-digit tail", () => {
    const issued = ["WO/2026/0005-A", "WO/2026/0002"];
    expect(maxIssuedNumber(issued, { prefix: "WO/", resetPeriod: "YEARLY" }, oct)).toBe(2);
  });

  it("treats regex metacharacters in the prefix literally", () => {
    const issued = ["WOX2026/0009", "W.O/2026/0004"];
    expect(maxIssuedNumber(issued, { prefix: "W.O/", resetPeriod: "YEARLY" }, oct)).toBe(4);
  });

  it("returns 0 when nothing matches", () => {
    expect(maxIssuedNumber([], { prefix: "WO/", resetPeriod: "YEARLY" }, oct)).toBe(0);
  });
});

describe("resyncedCounter", () => {
  it("never rewinds inside the same period", () => {
    const config = { lastNumber: 20, year: 2026, month: 10, resetPeriod: "YEARLY" };
    expect(resyncedCounter(config, 13, oct)).toEqual({ lastNumber: 20, year: 2026, month: 10 });
    expect(resyncedCounter(config, 25, oct)).toEqual({ lastNumber: 25, year: 2026, month: 10 });
  });

  it("restarts from what was issued when the stored YEARLY year is stale", () => {
    const config = { lastNumber: 90, year: 2025, month: 12, resetPeriod: "YEARLY" };
    expect(resyncedCounter(config, 4, oct)).toEqual({ lastNumber: 4, year: 2026, month: 10 });
  });

  it("restarts when the stored MONTHLY month is stale", () => {
    const config = { lastNumber: 30, year: 2026, month: 9, resetPeriod: "MONTHLY" };
    expect(resyncedCounter(config, 2, oct)).toEqual({ lastNumber: 2, year: 2026, month: 10 });
  });

  it("keeps the larger figure for a NEVER counter whatever the stored period", () => {
    const config = { lastNumber: 50, year: 2024, month: 3, resetPeriod: "NEVER" };
    expect(resyncedCounter(config, 40, oct).lastNumber).toBe(50);
    expect(resyncedCounter(config, 60, oct).lastNumber).toBe(60);
  });
});
