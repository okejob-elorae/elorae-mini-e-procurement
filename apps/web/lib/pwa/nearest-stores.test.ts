import { describe, it, expect } from "vitest";
import { rankStoresByDistance, formatDistance, type StoreWithCoords } from "./nearest-stores";

const jakartaOrigin = { lat: -6.2088, lng: 106.8456 };

const withCoords: StoreWithCoords[] = [
  { id: "far",  name: "Far",  lat: -6.9175, lng: 107.6191 },   // Bandung
  { id: "near", name: "Near", lat: -6.2100, lng: 106.8460 },   // ~130m from origin
  { id: "mid",  name: "Mid",  lat: -6.3000, lng: 106.9000 },   // ~11km from origin
];

const missing: StoreWithCoords[] = [
  { id: "a", name: "A", lat: null, lng: null },
  { id: "b", name: "B", lat: 1, lng: null },
];

describe("rankStoresByDistance", () => {
  it("returns input order with null distances when origin is null", () => {
    const result = rankStoresByDistance(withCoords, null);
    expect(result.map(r => r.store.id)).toEqual(["far", "near", "mid"]);
    expect(result.every(r => r.distanceMeters === null)).toBe(true);
  });

  it("sorts ascending by distance when origin is set", () => {
    const result = rankStoresByDistance(withCoords, jakartaOrigin);
    expect(result.map(r => r.store.id)).toEqual(["near", "mid", "far"]);
    expect(result[0].distanceMeters).toBeLessThan(result[1].distanceMeters!);
    expect(result[1].distanceMeters).toBeLessThan(result[2].distanceMeters!);
  });

  it("appends stores without coords after ranked stores", () => {
    const mixed = [...withCoords, ...missing];
    const result = rankStoresByDistance(mixed, jakartaOrigin);
    expect(result.slice(0, 3).map(r => r.store.id)).toEqual(["near", "mid", "far"]);
    expect(result.slice(3).map(r => r.store.id)).toEqual(["a", "b"]);
    expect(result.slice(3).every(r => r.distanceMeters === null)).toBe(true);
  });
});

describe("formatDistance", () => {
  it("uses meters below 1000", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(230)).toBe("230 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("uses km with one decimal at 1000 and above", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(1250)).toBe("1.3 km");
    expect(formatDistance(12_345)).toBe("12.3 km");
  });
});
