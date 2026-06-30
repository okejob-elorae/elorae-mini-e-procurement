import { describe, expect, it } from "vitest";
import { resolveDateRangePreset } from "./date-range-presets";

const now = new Date("2026-05-15T14:30:00");

function d(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

describe("resolveDateRangePreset", () => {
  it("resolves today and yesterday", () => {
    expect(resolveDateRangePreset("today", { now })).toEqual({
      from: d("2026-05-15"),
      to: d("2026-05-15"),
    });
    expect(resolveDateRangePreset("yesterday", { now })).toEqual({
      from: d("2026-05-14"),
      to: d("2026-05-14"),
    });
  });

  it("resolves rolling day windows inclusively", () => {
    expect(resolveDateRangePreset("last7Days", { now })).toEqual({
      from: d("2026-05-09"),
      to: d("2026-05-15"),
    });
    expect(resolveDateRangePreset("last30Days", { now })).toEqual({
      from: d("2026-04-16"),
      to: d("2026-05-15"),
    });
  });

  it("resolves calendar week and month boundaries (Monday week start)", () => {
    expect(resolveDateRangePreset("thisWeek", { now, weekStartsOn: 1 })).toEqual({
      from: d("2026-05-11"),
      to: d("2026-05-15"),
    });
    expect(resolveDateRangePreset("lastWeek", { now, weekStartsOn: 1 })).toEqual({
      from: d("2026-05-04"),
      to: d("2026-05-10"),
    });
    expect(resolveDateRangePreset("thisMonth", { now })).toEqual({
      from: d("2026-05-01"),
      to: d("2026-05-15"),
    });
    expect(resolveDateRangePreset("lastMonth", { now })).toEqual({
      from: d("2026-04-01"),
      to: d("2026-04-30"),
    });
  });

  it("resolves year to date", () => {
    expect(resolveDateRangePreset("ytd", { now })).toEqual({
      from: d("2026-01-01"),
      to: d("2026-05-15"),
    });
  });
});
