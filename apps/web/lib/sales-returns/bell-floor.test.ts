import { describe, it, expect } from "vitest";
import { BELL_FLOOR_SETTING_KEY, parseBellFloor } from "./bell-floor";

describe("parseBellFloor", () => {
  it("names the setting key", () => {
    expect(BELL_FLOOR_SETTING_KEY).toBe("salesReturns.bellFloor");
  });

  it("parses a UTC ISO timestamp, with or without milliseconds", () => {
    expect(parseBellFloor("2026-10-13T05:00:00.000Z")?.toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(parseBellFloor("2026-10-13T05:00:00Z")?.toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(parseBellFloor("  2026-10-13T05:00:00Z  ")?.toISOString()).toBe("2026-10-13T05:00:00.000Z");
  });

  it("refuses anything that is not a strict UTC ISO timestamp", () => {
    for (const raw of [null, undefined, "", "   ", "garbage", "2026-10-13", "2026-10-13 05:00:00", "2026-10-13T05:00:00+07:00", "2026-13-45T99:00:00Z"]) {
      expect(parseBellFloor(raw)).toBeNull();
    }
  });
});
