import { describe, expect, it } from "vitest";
import { hexToRgb, labChroma, rgbToLab } from "@elorae/db/color";
import { generatePaletteFromSeed } from "./generate-palette-from-seed";

function kepekatan(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const { a, b: bb } = rgbToLab(r, g, b);
  return labChroma(a, bb);
}

// Pantone 13-0443 — tema limau yang dipakai pemilik.
const LIMAU = "#c0db3a";
// Pantone 18-4148 Victoria Blue — tema "Studio".
const BIRU = "#08589d";

describe("generatePaletteFromSeed — dark surfaces", () => {
  it("keeps a yellow-green seed from turning the dark surfaces olive", () => {
    const gelap = generatePaletteFromSeed(LIMAU).dark;
    for (const permukaan of [gelap.background, gelap.card, gelap.border, gelap.muted]) {
      expect(kepekatan(permukaan)).toBeLessThanOrEqual(5);
    }
    expect(kepekatan(gelap.mutedForeground)).toBeLessThanOrEqual(6);
  });

  it("still lets a blue seed tint its dark surfaces navy", () => {
    expect(kepekatan(generatePaletteFromSeed(BIRU).dark.background)).toBeGreaterThanOrEqual(10);
  });

  it("moves smoothly across hues instead of jumping at a threshold", () => {
    // Dua warna bersebelahan di tepi pita kuning-hijau.
    const a = kepekatan(generatePaletteFromSeed("#d9a441").dark.background);
    const b = kepekatan(generatePaletteFromSeed("#d9a93f").dark.background);
    expect(Math.abs(a - b)).toBeLessThan(2);
  });
});

describe("generatePaletteFromSeed — light mode", () => {
  it("leaves the light palette exactly as it was", () => {
    expect(generatePaletteFromSeed(LIMAU).light).toMatchObject({
      background: "#f9fcde",
      card: "#ffffea",
      border: "#dde0bd",
      mutedForeground: "#63654e",
    });
  });
});
