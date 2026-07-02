import { describe, it, expect } from "vitest";
import { haversineMeters } from "./haversine";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });

  it("Jakarta to Bandung is approximately 122 km", () => {
    const jakarta = { lat: -6.2088, lng: 106.8456 };
    const bandung = { lat: -6.9175, lng: 107.6191 };
    const d = haversineMeters(jakarta, bandung);
    expect(d).toBeGreaterThan(115_000);
    expect(d).toBeLessThan(130_000);
  });

  it("is symmetric (a→b equals b→a)", () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: 15, lng: 25 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 3);
  });

  it("handles cross-hemisphere distance", () => {
    const north = { lat: 45, lng: 0 };
    const south = { lat: -45, lng: 0 };
    const d = haversineMeters(north, south);
    // 90 degrees latitude ~= 10,007 km on a 6371-km-radius sphere.
    expect(d).toBeGreaterThan(9_900_000);
    expect(d).toBeLessThan(10_050_000);
  });
});
