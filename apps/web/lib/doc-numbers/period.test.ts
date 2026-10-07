import { describe, expect, it } from "vitest";
import { docNumberPeriod } from "./period";

describe("docNumberPeriod", () => {
  it("rolls to the next month at 00:00 WIB on the 1st", () => {
    expect(docNumberPeriod(new Date("2026-10-31T17:00:00.000Z"))).toEqual({ year: 2026, month: 11 });
  });

  it("stays in the month one millisecond before WIB midnight", () => {
    expect(docNumberPeriod(new Date("2026-10-31T16:59:59.999Z"))).toEqual({ year: 2026, month: 10 });
  });

  it("rolls the year at the WIB new year", () => {
    expect(docNumberPeriod(new Date("2026-12-31T17:30:00.000Z"))).toEqual({ year: 2027, month: 1 });
  });

  it("reads a mid-month instant plainly", () => {
    expect(docNumberPeriod(new Date("2026-06-15T03:00:00.000Z"))).toEqual({ year: 2026, month: 6 });
  });
});
