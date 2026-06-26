/**
 * Heuristic filter classification for Pantone TCX colors.
 */

export type FilterTags = {
  tone: string[];
  hue: string[];
  temperature: string[];
  tint: string[];
};

export type ClassifiedColor = {
  groupName: string;
  filterTags: FilterTags;
  labL: number;
  labA: number;
  labB: number;
  rgbR: number;
  rgbG: number;
  rgbB: number;
};

import { hexToRgb, rgbToLab } from "../color/lab";

export { hexToRgb, rgbToLab } from "../color/lab";

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hueFamily(h: number, s: number, l: number, c: number): string[] {
  if (l >= 90 && s < 15) return ["White"];
  if (l <= 12 && s < 20) return ["Black"];
  if (s < 12 && l > 12 && l < 90) return ["Gray"];
  if (h >= 35 && h < 58 && s >= 20 && l >= 38) return ["Gold"];
  if (s < 28 && h >= 12 && h < 55 && l >= 18 && l <= 58) return ["Brown"];
  if (h >= 345 || h < 25) return ["Red"];
  if (h < 45) return ["Orange"];
  if (h < 68) return ["Yellow"];
  if (h < 145) return ["Green"];
  if (h < 195) return ["Teal/Cyan"];
  if (h < 250) return ["Blue"];
  if (h < 290) return ["Purple"];
  return ["Pink"];
}

function temperatureFromLab(a: number, h: number, s: number): string[] {
  if (s < 10) return ["Neutral"];
  if (a > 8 || (h >= 15 && h < 90)) return ["Warm"];
  if (a < -8 || (h >= 165 && h < 290)) return ["Cool"];
  return ["Neutral"];
}

function tintFromLightness(l: number): string[] {
  if (l >= 78) return ["Tint"];
  if (l <= 32) return ["Shade"];
  return ["Pure"];
}

function toneMood(c: number, l: number, h: number, s: number): string[] {
  if (c < 8) return ["Monochrome"];

  const goldMetallic = h >= 38 && h < 58 && s >= 15 && s < 55 && l >= 42 && l <= 72;
  const silverMetallic = c < 15 && l >= 50 && l <= 85 && s < 20;
  if (goldMetallic || silverMetallic) return ["Metallic"];

  if (l >= 75 && c < 32 && s < 55) return ["Pastel"];
  if (c < 14) return ["Neutral"];
  if (h >= 18 && h < 85 && s < 42 && l >= 22 && l <= 62 && c < 38) return ["Earth Tone"];
  if (c > 38 && l >= 22 && l <= 52 && s > 38) return ["Jewel Tone"];
  if (c > 48 && s > 58 && l >= 38 && l <= 78) return ["Vivid/Neon"];
  if (s < 35 || c < 25) return ["Muted/Dusty"];
  return ["Neutral"];
}

function groupNameFromTcxAndLab(tcx: string, l: number, c: number): string {
  const prefix = parseInt(tcx.split("-")[0] ?? "0", 10);
  if (l >= 88 || prefix <= 12) return "Whites";
  if (l <= 18 || prefix >= 19) return "Blacks";
  if (c < 15) return "Neutrals";
  if (prefix <= 14) return "Pastels";
  return "Brights";
}

export function classifyColor(hex: string, tcx: string): ClassifiedColor {
  const { r, g, b } = hexToRgb(hex);
  const { L, a, b: labB } = rgbToLab(r, g, b);
  const C = Math.sqrt(a * a + labB * labB);
  const { h, s } = rgbToHsl(r, g, b);

  const filterTags: FilterTags = {
    tone: toneMood(C, L, h, s),
    hue: hueFamily(h, s, L, C),
    temperature: temperatureFromLab(a, h, s),
    tint: tintFromLightness(L),
  };

  return {
    groupName: groupNameFromTcxAndLab(tcx, L, C),
    filterTags,
    labL: L,
    labA: a,
    labB,
    rgbR: r,
    rgbG: g,
    rgbB: b,
  };
}

export const FILTER_DIMENSIONS = ["tone", "hue", "temperature", "tint"] as const;

export const DEFAULT_FILTER_OPTIONS: Record<
  (typeof FILTER_DIMENSIONS)[number],
  string[]
> = {
  tone: [
    "Pastel",
    "Earth Tone",
    "Jewel Tone",
    "Neutral",
    "Vivid/Neon",
    "Muted/Dusty",
    "Monochrome",
    "Metallic",
  ],
  hue: [
    "Red",
    "Pink",
    "Orange",
    "Yellow",
    "Green",
    "Teal/Cyan",
    "Blue",
    "Purple",
    "Brown",
    "White",
    "Black",
    "Gray",
    "Gold",
  ],
  temperature: ["Warm", "Cool", "Neutral"],
  tint: ["Tint", "Shade", "Pure"],
};
