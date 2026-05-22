/**
 * Heuristic filter classification for Pantone TCX colors (prototype-style chips).
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

import { hexToRgb, rgbToLab } from '@/lib/color/lab';

export { hexToRgb, rgbToLab } from '@/lib/color/lab';

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

function hueFamily(h: number, s: number, l: number): string[] {
  if (s < 8 || (l > 92 && s < 15)) return ['Neutrals'];
  if (s < 18 && l < 25) return ['Neutrals'];
  if (h < 15 || h >= 345) return ['Red'];
  if (h < 45) return ['Orange'];
  if (h < 70) return ['Yellow'];
  if (h < 165) return ['Green'];
  if (h < 250) return ['Blue'];
  if (h < 290) return ['Purple'];
  return ['Pink'];
}

function temperatureFromLab(a: number, h: number, s: number): string[] {
  if (s < 10) return ['Neutral'];
  if (a > 8 || (h >= 15 && h < 90)) return ['Warm'];
  if (a < -8 || (h >= 165 && h < 290)) return ['Cool'];
  return ['Neutral'];
}

function tintFromLightness(L: number): string[] {
  if (L >= 82) return ['Tint'];
  if (L <= 28) return ['Shade'];
  return ['Mid'];
}

function toneFromChroma(C: number, L: number): string[] {
  if (C < 12) return L > 70 ? ['Soft'] : ['Muted'];
  if (C < 28) return ['Soft'];
  if (C < 45) return ['Balanced'];
  return ['Bold'];
}

function groupNameFromTcxAndLab(tcx: string, L: number, C: number): string {
  const prefix = parseInt(tcx.split('-')[0] ?? '0', 10);
  if (L >= 88 || prefix <= 12) return 'Whites';
  if (L <= 18 || prefix >= 19) return 'Blacks';
  if (C < 15) return 'Neutrals';
  if (prefix <= 14) return 'Pastels';
  return 'Brights';
}

export function classifyColor(hex: string, tcx: string): ClassifiedColor {
  const { r, g, b } = hexToRgb(hex);
  const { L, a, b: labB } = rgbToLab(r, g, b);
  const C = Math.sqrt(a * a + labB * labB);
  const { h, s } = rgbToHsl(r, g, b);

  const filterTags: FilterTags = {
    tone: toneFromChroma(C, L),
    hue: hueFamily(h, s, L),
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

/** All distinct chip values for filter UI (seed can also derive from data) */
export const FILTER_DIMENSIONS = ['tone', 'hue', 'temperature', 'tint'] as const;

export const DEFAULT_FILTER_OPTIONS: Record<
  (typeof FILTER_DIMENSIONS)[number],
  string[]
> = {
  tone: ['Soft', 'Muted', 'Balanced', 'Bold'],
  hue: ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Neutrals'],
  temperature: ['Warm', 'Cool', 'Neutral'],
  tint: ['Tint', 'Mid', 'Shade'],
};
