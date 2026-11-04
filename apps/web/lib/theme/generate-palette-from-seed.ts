import { hexToRgb, labChroma, labHueRadians, labToHex, rgbToLab } from "@elorae/db/color";
import type { BaseTokens } from '@/lib/theme/theme-color';
import { normalizeThemeHexColor } from '@/lib/theme/theme-color';

function surfaceFromLab(
  L: number,
  hue: number,
  seedChroma: number,
  chromaFactor: number,
  maxChroma = 18
): string {
  const c = Math.min(seedChroma * chromaFactor, maxChroma);
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  return labToHex(Math.max(0, Math.min(100, L)), a, b);
}

function foregroundFromLab(L: number, hue: number, seedChroma: number, lightMode: boolean, maxChroma = 10): string {
  const targetL = lightMode ? 18 : 96;
  const c = Math.min(seedChroma * 0.12, maxChroma);
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  return labToHex(targetL, a, b);
}

function mutedForegroundFromLab(L: number, hue: number, seedChroma: number, lightMode: boolean, maxChroma = 14): string {
  const targetL = lightMode ? 42 : 72;
  const c = Math.min(seedChroma * 0.2, maxChroma);
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  return labToHex(targetL, a, b);
}

/** Pusat dan setengah lebar pita rona yang menjadi lumpur di dalam gelap, dalam derajat Lab. */
const PUSAT_KERUH = 105;
const LEBAR_KERUH = 65;

/**
 * Seberapa keruh sebuah rona bila dijadikan permukaan GELAP — 0 sampai 1.
 *
 * Biru, ungu dan merah muda tetap cantik saat digelapkan: hampir-hitam kebiruan
 * terbaca "navy". Kuning, limau dan hijau tidak — pada terang 10 mereka menjadi
 * zaitun, dan seluruh aplikasi terlihat kotor (tema limau 13-0443 memberi latar
 * `#1b1d00`). Nilainya turun mulus menjauhi kuning-hijau, bukan dipotong di satu
 * sudut, supaya dua Pantone yang bersebelahan tidak memberi mode gelap yang jauh
 * berbeda.
 */
function keruhDiGelap(hue: number): number {
  const derajat = ((hue * 180) / Math.PI + 360) % 360;
  const jarak = Math.abs(derajat - PUSAT_KERUH);
  if (jarak >= LEBAR_KERUH) return 0;
  return Math.cos((jarak / LEBAR_KERUH) * (Math.PI / 2));
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

  // Di pita keruh, rona tema tinggal bisikan: warna merek hidup di tombol dan
  // penanda aktif, bukan di seluruh permukaan.
  const keruh = keruhDiGelap(hue);
  const batas = (penuh: number, redam: number) => penuh - (penuh - redam) * keruh;
  const kp = batas(18, 4);

  const background = surfaceFromLab(10, hue, seedChroma, 0.25, kp);
  const card = surfaceFromLab(16, hue, seedChroma, 0.22, kp);
  const secondary = surfaceFromLab(22, hue, seedChroma, 0.3, kp);
  const muted = surfaceFromLab(26, hue, seedChroma, 0.28, kp);
  const border = surfaceFromLab(32, hue, seedChroma, 0.35, kp);
  const input = surfaceFromLab(36, hue, seedChroma, 0.32, kp);
  const foreground = foregroundFromLab(seedL, hue, seedChroma, false, batas(10, 3));
  const mutedFg = mutedForegroundFromLab(seedL, hue, seedChroma, false, batas(14, 5));
  const accentSurface = surfaceFromLab(28, hue, seedChroma, 0.4, kp);

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
