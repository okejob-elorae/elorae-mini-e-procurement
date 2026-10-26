import { describe, it, expect } from "vitest";
import { formatDateTimeJakarta, parseDateOnly, parseDateOnlyEnd, toDisplayDate } from "./date-only";

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

describe("toDisplayDate (WIB-pinned)", () => {
  it("pins a UTC-evening instant to the next WIB day", () => {
    expect(toDisplayDate(new Date("2026-06-30T20:00:00.000Z"))).toBe("1 Jul 2026");
  });
  it("renders a WIB-midnight instant as that WIB day", () => {
    expect(toDisplayDate(parseDateOnly("2026-06-30")!)).toBe("30 Jun 2026");
  });
});
