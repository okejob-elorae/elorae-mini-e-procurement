/**
 * Pantone TCX matching wrappers (server-only). Delta-E is CIE76 in LAB (same as pantone-tcx).
 */
import {
  getNearestPantone,
  getSimilarColors,
} from 'pantone-tcx';
import { hexToRgb, labToHex, rgbToLab } from '@elorae/db';

export type PantoneMatchResult = {
  name: string;
  tcx: string;
  hex: string;
  deltaE: number;
};

export function normalizeHex(hex: string): string {
  let h = hex.trim();
  if (!h.startsWith('#')) h = `#${h}`;
  if (h.length === 4) {
    const r = h[1];
    const g = h[2];
    const b = h[3];
    h = `#${r}${r}${g}${g}${b}${b}`;
  }
  return h.toUpperCase();
}

export function deltaE76(hex1: string, hex2: string): number {
  const lab1 = rgbToLab(...Object.values(hexToRgb(hex1)) as [number, number, number]);
  const lab2 = rgbToLab(...Object.values(hexToRgb(hex2)) as [number, number, number]);
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function matchHexToPantone(
  inputHex: string,
  limit = 5
): PantoneMatchResult[] {
  const hex = normalizeHex(inputHex);
  const similar = getSimilarColors(hex, 80);
  const withDelta = similar.map((c) => ({
    name: c.name,
    tcx: c.tcx,
    hex: normalizeHex(c.hex),
    deltaE: Math.round(deltaE76(hex, c.hex) * 100) / 100,
  }));
  withDelta.sort((a, b) => a.deltaE - b.deltaE);
  const seen = new Set<string>();
  const out: PantoneMatchResult[] = [];
  for (const row of withDelta) {
    if (seen.has(row.tcx)) continue;
    seen.add(row.tcx);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export function getNearestMatch(inputHex: string): PantoneMatchResult {
  const hex = normalizeHex(inputHex);
  const nearest = getNearestPantone(hex);
  return {
    name: nearest.name,
    tcx: nearest.tcx,
    hex: normalizeHex(nearest.hex),
    deltaE: Math.round(deltaE76(hex, nearest.hex) * 100) / 100,
  };
}

export function enrichSimilarWithDeltaE(
  inputHex: string,
  colors: Array<{ name: string; tcx: string; hex: string }>,
  maxDistance = 24
): PantoneMatchResult[] {
  const hex = normalizeHex(inputHex);
  const similar = getSimilarColors(hex, maxDistance);
  return similar.map((c) => ({
    name: c.name,
    tcx: c.tcx,
    hex: normalizeHex(c.hex),
    deltaE: Math.round(deltaE76(hex, c.hex) * 100) / 100,
  }));
}

export function buildGradient(hex: string, steps = 9): string[] {
  const { r, g, b } = hexToRgb(hex);
  const base = rgbToLab(r, g, b);
  const strip: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < steps; i++) {
    const t = steps > 1 ? i / (steps - 1) : 0;
    let L = base.L + (95 - base.L) * (0.5 - t) * 1.2;
    let a = base.a * (1 - Math.abs(t - 0.5));
    let bVal = base.b * (1 - Math.abs(t - 0.5));
    let out = labToHex(Math.max(0, Math.min(100, L)), a, bVal);

    // LAB→RGB rounding can collapse adjacent steps to the same hex (e.g. dark colors → #010000).
    let nudge = 0;
    while (seen.has(out) && nudge < 12) {
      nudge += 1;
      L = Math.max(0, Math.min(100, L + (i < steps / 2 ? 1.5 : -1.5)));
      out = labToHex(L, a, bVal);
    }
    seen.add(out);
    strip.push(out);
  }
  return strip;
}

export function hexToRgbString(hex: string): string {
  const { r, g, b } = hexToRgb(normalizeHex(hex));
  return `${r}, ${g}, ${b}`;
}
