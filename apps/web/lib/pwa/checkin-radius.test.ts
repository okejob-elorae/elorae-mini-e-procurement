import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHECKIN_RADIUS_METERS,
  parseRadiusSetting,
  resolveEffectiveRadius,
  evaluateCheckinRadius,
} from "./checkin-radius";

describe("parseRadiusSetting", () => {
  it("parses a numeric string", () => {
    expect(parseRadiusSetting("250")).toBe(250);
  });
  it("falls back to 100 on missing/non-numeric", () => {
    expect(parseRadiusSetting(undefined)).toBe(DEFAULT_CHECKIN_RADIUS_METERS);
    expect(parseRadiusSetting(null)).toBe(DEFAULT_CHECKIN_RADIUS_METERS);
    expect(parseRadiusSetting("abc")).toBe(DEFAULT_CHECKIN_RADIUS_METERS);
  });
});

describe("resolveEffectiveRadius", () => {
  it("uses the override when present, including 0", () => {
    expect(resolveEffectiveRadius(50, 100)).toBe(50);
    expect(resolveEffectiveRadius(0, 100)).toBe(0);
  });
  it("falls through to global when override is null", () => {
    expect(resolveEffectiveRadius(null, 100)).toBe(100);
  });
});

describe("evaluateCheckinRadius", () => {
  const store = { lat: -6.2, lng: 106.8 };
  it("flags a point far outside the radius", () => {
    // ~1.1km east
    const r = evaluateCheckinRadius({ checkin: { lat: -6.2, lng: 106.81 }, store, effectiveRadiusMeters: 100 });
    expect(r.outOfRadius).toBe(true);
    expect(r.distanceMeters).toBeGreaterThan(100);
  });
  it("does not flag a point inside the radius", () => {
    const r = evaluateCheckinRadius({ checkin: { lat: -6.2, lng: 106.8 }, store, effectiveRadiusMeters: 100 });
    expect(r.outOfRadius).toBe(false);
    expect(r.distanceMeters).toBe(0);
  });
  it("returns null distance + not-out when the store has no coords", () => {
    const r = evaluateCheckinRadius({ checkin: { lat: -6.2, lng: 106.8 }, store: { lat: null, lng: null }, effectiveRadiusMeters: 100 });
    expect(r).toEqual({ distanceMeters: null, outOfRadius: false });
  });
  it("treats distance == radius as inside (not out)", () => {
    // build a store/checkin pair, measure, then set the radius exactly to the distance
    const checkin = { lat: -6.2, lng: 106.805 };
    const measured = evaluateCheckinRadius({ checkin, store, effectiveRadiusMeters: 100000 });
    const r = evaluateCheckinRadius({ checkin, store, effectiveRadiusMeters: measured.distanceMeters! });
    expect(r.outOfRadius).toBe(false);
  });
});
