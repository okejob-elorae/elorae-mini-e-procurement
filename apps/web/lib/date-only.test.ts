import { describe, it, expect } from "vitest";
import { formatDateTimeJakarta, parseDateOnly, parseDateOnlyEnd, formatDisplayDate, formatDisplayDateTime, toDisplayDate } from "./date-only";

// Assert the resolved UTC instant (timezone-independent) so this passes on a UTC server
// AND a WIB dev machine. WIB = +07:00, so 2026-06-30 WIB spans 2026-06-29T17:00Z .. 2026-06-30T16:59:59.999Z.
describe("parseDateOnly / parseDateOnlyEnd (WIB-anchored)", () => {
  it("parseDateOnly = start of the WIB day", () => {
    expect(parseDateOnly("2026-06-30")!.toISOString()).toBe("2026-06-29T17:00:00.000Z");
  });
  it("parseDateOnlyEnd = inclusive end of the WIB day", () => {
    expect(parseDateOnlyEnd("2026-06-30")!.toISOString()).toBe("2026-06-30T16:59:59.999Z");
  });
  it("an order at 2026-07-01 06:54 WIB (2026-06-30T23:54Z) is AFTER the 30 Jun WIB end", () => {
    const orderUtc = new Date("2026-06-30T23:54:00.000Z"); // = 01 Jul 06:54 WIB
    expect(orderUtc.getTime()).toBeGreaterThan(parseDateOnlyEnd("2026-06-30")!.getTime());
  });
  it("blank / invalid → undefined", () => {
    expect(parseDateOnly("")).toBeUndefined();
    expect(parseDateOnly("  ")).toBeUndefined();
    expect(parseDateOnlyEnd("not-a-date")).toBeUndefined();
  });
});

describe("formatDateTimeJakarta", () => {
  it("renders the WIB date and 24h time, rolling the date over at WIB midnight", () => {
    expect(formatDateTimeJakarta(new Date("2026-06-29T17:05:00.000Z"))).toBe("2026-06-30 00:05");
    expect(formatDateTimeJakarta(new Date("2026-06-30T06:30:00.000Z"))).toBe("2026-06-30 13:30");
  });
});

describe("formatDisplayDate / formatDisplayDateTime (one on-screen format, WIB)", () => {
  // 25 Sep 2026 17:30 UTC is already 26 Sep 00:30 in WIB.
  const lateUtc = new Date("2026-09-25T17:30:00.000Z");

  it("prints day, short month, year in Indonesian by default", () => {
    expect(formatDisplayDate(new Date("2026-08-26T05:00:00.000Z"))).toBe("26 Agu 2026");
  });

  it("uses the WIB calendar day, not the machine's", () => {
    expect(formatDisplayDate(lateUtc)).toBe("26 Sep 2026");
    expect(toDisplayDate(lateUtc)).toBe("26 Sep 2026");
  });

  it("keeps the day first in English", () => {
    expect(formatDisplayDate(new Date("2026-08-26T05:00:00.000Z"), "en")).toBe("26 Aug 2026");
  });

  it("accepts ISO strings and shows a dash for empty or invalid input", () => {
    expect(formatDisplayDate("2026-08-19T00:00:00.000+07:00")).toBe("19 Agu 2026");
    expect(formatDisplayDate(null)).toBe("—");
    expect(formatDisplayDate("")).toBe("—");
    expect(formatDisplayDate("not a date")).toBe("—");
  });

  it("adds the WIB time", () => {
    expect(formatDisplayDateTime(lateUtc)).toBe("26 Sep 2026, 00.30");
    expect(formatDisplayDateTime(new Date("2026-08-25T17:30:00.000Z"), "en")).toBe("26 Aug 2026, 00:30");
  });
});
