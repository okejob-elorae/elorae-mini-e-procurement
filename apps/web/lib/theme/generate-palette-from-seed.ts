import { hexToRgb, labChroma, labHueRadians, labToHex, rgbToLab } from '@elorae/db';
import type { BaseTokens } from '@/lib/theme/theme-color';
import { normalizeThemeHexColor } from '@/lib/theme/theme-color';

function surfaceFromLab(
  L: number,
  hue: number,
  seedChroma: number,
  chromaFactor: number
): string {
  const c = Math.min(seedChroma * chromaFactor, 18);
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  return labToHex(Math.max(0, Math.min(100, L)), a, b);
}

function foregroundFromLab(L: number, hue: number, seedChroma: number, lightMode: boolean): string {
  const targetL = lightMode ? 18 : 96;
  const c = Math.min(seedChroma * 0.12, 10);
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  return labToHex(targetL, a, b);
}

function mutedForegroundFromLab(L: number, hue: number, seedChroma: number, lightMode: boolean): string {
  const targetL = lightMode ? 42 : 72;
  const c = Math.min(seedChroma * 0.2, 14);
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  return labToHex(targetL, a, b);
}

function buildModeTokens(seedHex: string, lightMode: boolean): BaseTokens {
  const normalized = normalizeThemeHexColor(seedHex);
  const { r, g, b } = hexToRgb(normalized);
  const { L: seedL, a: seedA, b: seedB } = rgbToLab(r, g, b);
  const seedChroma = labChroma(seedA, seedB);
  const hue = seedChroma < 2 ? 0 : labHueRadians(seedA, seedB);

  if (lightMode) {
    const background = surfaceFromLab(98, hue, seedChroma, 0.2);
    const card = surfaceFromLab(100, hue, seedChroma, 0.15);
    const secondary = surfaceFromLab(96, hue, seedChroma, 0.25);
    const muted = surfaceFromLab(94, hue, seedChroma, 0.22);
    const border = surfaceFromLab(88, hue, seedChroma, 0.3);
    const input = surfaceFromLab(90, hue, seedChroma, 0.28);
    const foreground = foregroundFromLab(seedL, hue, seedChroma, true);
    const mutedFg = mutedForegroundFromLab(seedL, hue, seedChroma, true);
    const accentSurface = surfaceFromLab(94, hue, seedChroma, 0.35);

    return {
      background,
      foreground,
      card,
      cardForeground: foreground,
      popover: card,
      popoverForeground: foreground,
      secondary,
      secondaryForeground: foreground,
      muted,
      mutedForeground: mutedFg,
      accent: accentSurface,
      accentForeground: foreground,
      border,
      input,
    };
  }

  const background = surfaceFromLab(10, hue, seedChroma, 0.25);
  const card = surfaceFromLab(16, hue, seedChroma, 0.22);
  const secondary = surfaceFromLab(22, hue, seedChroma, 0.3);
  const muted = surfaceFromLab(26, hue, seedChroma, 0.28);
  const border = surfaceFromLab(32, hue, seedChroma, 0.35);
  const input = surfaceFromLab(36, hue, seedChroma, 0.32);
  const foreground = foregroundFromLab(seedL, hue, seedChroma, false);
  const mutedFg = mutedForegroundFromLab(seedL, hue, seedChroma, false);
  const accentSurface = surfaceFromLab(28, hue, seedChroma, 0.4);

  return {
    background,
    foreground,
    card,
    cardForeground: foreground,
    popover: card,
    popoverForeground: foreground,
    secondary,
    secondaryForeground: foreground,
    muted,
    mutedForeground: mutedFg,
    accent: accentSurface,
    accentForeground: foreground,
    border,
    input,
  };
}

export type GeneratedThemePalette = {
  light: BaseTokens;
  dark: BaseTokens;
};

export function generatePaletteFromSeed(seedHex: string): GeneratedThemePalette {
  return {
    light: buildModeTokens(seedHex, true),
    dark: buildModeTokens(seedHex, false),
  };
}
