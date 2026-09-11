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

  it("parses space-separated lat lng", () => {
    expect(parseCoordsPaste("-6.2088 106.8456")).toEqual({ lat: -6.2088, lng: 106.8456 });
  });

  it("parses Google Maps @lat,lng zoom fragment", () => {
    expect(
      parseCoordsPaste("https://www.google.com/maps/@-6.2088,106.8456,17z"),
    ).toEqual({ lat: -6.2088, lng: 106.8456 });
  });

  it("parses Google Maps place URL with @lat,lng", () => {
    expect(
      parseCoordsPaste(
        "https://www.google.com/maps/place/Foo/@-6.9175,107.6191,15z/data=!3m1!4b1",
      ),
    ).toEqual({ lat: -6.9175, lng: 107.6191 });
  });

  it("parses Google Maps ?q=lat,lng", () => {
    expect(
      parseCoordsPaste("https://www.google.com/maps?q=-6.2088,106.8456"),
    ).toEqual({ lat: -6.2088, lng: 106.8456 });
  });

  it("parses maps.app.goo.gl-style q= coords", () => {
    expect(parseCoordsPaste("https://maps.google.com/?q=40.7128,-74.0060")).toEqual({
      lat: 40.7128,
      lng: -74.006,
    });
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

  it("returns null for place-name-only Maps URL without coords", () => {
    expect(parseCoordsPaste("https://www.google.com/maps/place/Jakarta")).toBeNull();
  });
});
