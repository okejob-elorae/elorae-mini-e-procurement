import { describe, it, expect } from "vitest";
import { formatMovedAtInput, isMovedAtInFuture, parseMovedAtInput } from "./moved-at";

describe("parseMovedAtInput", () => {
  it("reads a datetime-local value as WIB, whatever the process timezone", () => {
    expect(parseMovedAtInput("2026-09-24T09:30")?.toISOString()).toBe("2026-09-24T02:30:00.000Z");
    expect(parseMovedAtInput("2026-09-25T00:05")?.toISOString()).toBe("2026-09-24T17:05:00.000Z");
  });

  it("refuses a date or time the calendar does not have, which the Date parser rolls over", () => {
    expect(parseMovedAtInput("2026-02-30T10:00")).toBeNull();
    expect(parseMovedAtInput("2026-09-24T24:00")).toBeNull();
  });

  it("refuses anything that is not exactly YYYY-MM-DDTHH:mm", () => {
    for (const value of ["2026-09-24", "2026-09-24T9:30", "2026-09-24T09:30:00", "2026-09-24 09:30", "", null, undefined, 20260924]) {
      expect(parseMovedAtInput(value)).toBeNull();
    }
  });
});

describe("formatMovedAtInput", () => {
  it("formats an instant in WIB, crossing WIB midnight where UTC has not", () => {
    expect(formatMovedAtInput(new Date("2026-09-24T17:05:00.000Z"))).toBe("2026-09-25T00:05");
  });

  it("round-trips through parseMovedAtInput", () => {
    const value = formatMovedAtInput(new Date("2026-09-24T02:30:00.000Z"));
    expect(value).toBe("2026-09-24T09:30");
    expect(parseMovedAtInput(value)?.toISOString()).toBe("2026-09-24T02:30:00.000Z");
  });
});

describe("isMovedAtInFuture", () => {
  const now = new Date("2026-09-24T02:30:00.000Z");

  it("compares instants: one millisecond after now is future", () => {
    expect(isMovedAtInFuture(new Date(now.getTime() + 1), now)).toBe(true);
  });

  it("is false for now itself and for anything earlier", () => {
    expect(isMovedAtInFuture(now, now)).toBe(false);
    expect(isMovedAtInFuture(new Date(now.getTime() - 3_600_000), now)).toBe(false);
  });
});
