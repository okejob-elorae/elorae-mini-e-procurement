import { describe, it, expect } from "vitest";
import { parseCoordsPaste } from "./coords";

describe("parseCoordsPaste", () => {
  it("parses standard comma-space format", () => {
    expect(parseCoordsPaste("-6.2088, 106.8456")).toEqual({ lat: -6.2088, lng: 106.8456 });
  });

  it("parses without space after comma", () => {
    expect(parseCoordsPaste("-6.2088,106.8456")).toEqual({ lat: -6.2088, lng: 106.8456 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseCoordsPaste("  -6.2088 , 106.8456 ")).toEqual({ lat: -6.2088, lng: 106.8456 });
  });

  it("parses positive coords", () => {
    expect(parseCoordsPaste("40.7128, -74.0060")).toEqual({ lat: 40.7128, lng: -74.006 });
  });

  it("returns null for missing comma", () => {
    expect(parseCoordsPaste("-6.2088 106.8456")).toBeNull();
  });

  it("returns null for non-numeric parts", () => {
    expect(parseCoordsPaste("abc, def")).toBeNull();
  });

  it("returns null for lat out of range", () => {
    expect(parseCoordsPaste("91.0, 0.0")).toBeNull();
    expect(parseCoordsPaste("-91.0, 0.0")).toBeNull();
  });

  it("returns null for lng out of range", () => {
    expect(parseCoordsPaste("0.0, 181.0")).toBeNull();
    expect(parseCoordsPaste("0.0, -181.0")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseCoordsPaste("")).toBeNull();
    expect(parseCoordsPaste("   ")).toBeNull();
  });
});
