import { generatePaletteFromSeed } from '@/lib/theme/generate-palette-from-seed';

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const PRIMARY_STORAGE_KEY = 'elorae:user-theme-primary';
const PANTONE_STORAGE_KEY = 'elorae:user-theme-pantone';
const PALETTE_STORAGE_KEY = 'elorae:user-theme-palette';

export function getUserThemeStorageKey(userId: string): string {
  return `${PRIMARY_STORAGE_KEY}:${userId}`;
}

export function getUserThemePantoneStorageKey(userId: string): string {
  return `${PANTONE_STORAGE_KEY}:${userId}`;
}

export function getUserThemePaletteStorageKey(userId: string): string {
  return `${PALETTE_STORAGE_KEY}:${userId}`;
}

/** @deprecated Use getUserThemePantoneStorageKey — kept for one release of cache migration */
export function getUserThemeBaseStorageKey(userId: string): string {
  return `elorae:user-theme-base:${userId}`;
}

export function normalizeThemeHexColor(value: string): string {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new Error('Invalid color format. Use 6-digit hex color.');
  }
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return withHash.toLowerCase();
}

function toRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeThemeHexColor(hex).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function getRelativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const channels = [r, g, b].map((value) => {
    const sRgb = value / 255;
    return sRgb <= 0.03928 ? sRgb / 12.92 : ((sRgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getForegroundFor(hex: string): string {
  return getRelativeLuminance(hex) > 0.5 ? '#111827' : '#f9fafb';
}

export function applyThemePrimaryColor(hex: string): string {
  const normalized = normalizeThemeHexColor(hex);
  const foreground = getForegroundFor(normalized);
  const rootStyle = document.documentElement.style;

  rootStyle.setProperty('--primary', normalized);
  rootStyle.setProperty('--ring', normalized);
  rootStyle.setProperty('--accent', normalized);
  rootStyle.setProperty('--sidebar-primary', normalized);
  rootStyle.setProperty('--primary-foreground', foreground);
  rootStyle.setProperty('--accent-foreground', foreground);
  rootStyle.setProperty('--sidebar-primary-foreground', foreground);

  return normalized;
}

export function clearThemePrimaryColor(): void {
  const rootStyle = document.documentElement.style;
  rootStyle.removeProperty('--primary');
  rootStyle.removeProperty('--ring');
  rootStyle.removeProperty('--accent');
  rootStyle.removeProperty('--sidebar-primary');
  rootStyle.removeProperty('--primary-foreground');
  rootStyle.removeProperty('--accent-foreground');
  rootStyle.removeProperty('--sidebar-primary-foreground');
}

export type BaseTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
};

export const BASE_TOKEN_MAP_LIGHT: Record<string, BaseTokens> = {
  slate: {
    background: '#ffffff',
    foreground: '#0f172a',
    card: '#ffffff',
    cardForeground: '#0f172a',
    popover: '#ffffff',
    popoverForeground: '#0f172a',
    secondary: '#f1f5f9',
    secondaryForeground: '#0f172a',
    muted: '#f1f5f9',
    mutedForeground: '#475569',
    accent: '#f1f5f9',
    accentForeground: '#0f172a',
    border: '#e2e8f0',
    input: '#e2e8f0',
  },
};

export const BASE_TOKEN_MAP_DARK: Record<string, BaseTokens> = {
  slate: {
    background: '#0f172a',
    foreground: '#f8fafc',
    card: '#1e293b',
    cardForeground: '#f8fafc',
    popover: '#1e293b',
    popoverForeground: '#f8fafc',
    secondary: '#334155',
    secondaryForeground: '#f8fafc',
    muted: '#334155',
    mutedForeground: '#94a3b8',
    accent: '#334155',
    accentForeground: '#f8fafc',
    border: '#334155',
    input: '#475569',
  },
};

export function applyThemePalette(tokens: BaseTokens): void {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--background', tokens.background);
  rootStyle.setProperty('--foreground', tokens.foreground);
  rootStyle.setProperty('--card', tokens.card);
  rootStyle.setProperty('--card-foreground', tokens.cardForeground);
  rootStyle.setProperty('--popover', tokens.popover);
  rootStyle.setProperty('--popover-foreground', tokens.popoverForeground);
  rootStyle.setProperty('--secondary', tokens.secondary);
  rootStyle.setProperty('--secondary-foreground', tokens.secondaryForeground);
  rootStyle.setProperty('--muted', tokens.muted);
  rootStyle.setProperty('--muted-foreground', tokens.mutedForeground);
  rootStyle.setProperty('--accent', tokens.accent);
  rootStyle.setProperty('--accent-foreground', tokens.accentForeground);
  rootStyle.setProperty('--border', tokens.border);
  rootStyle.setProperty('--input', tokens.input);
}

export function isDocumentDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

export function applyThemeFromPantoneSeed(hex: string, palette?: { light: BaseTokens; dark: BaseTokens }): string {
  const normalized = normalizeThemeHexColor(hex);
  const generated = palette ?? generatePaletteFromSeed(normalized);
  const tokens = isDocumentDarkMode() ? generated.dark : generated.light;
  applyThemePalette(tokens);
  applyThemePrimaryColor(normalized);
  return normalized;
}

export function applyDefaultTheme(): void {
  const tokens = isDocumentDarkMode()
    ? BASE_TOKEN_MAP_DARK.slate
    : BASE_TOKEN_MAP_LIGHT.slate;
  applyThemePalette(tokens);
  applyThemePrimaryColor('#334155');
}

/** @deprecated Preset base colors — use applyDefaultTheme or applyThemeFromPantoneSeed */
export function applyThemeBaseColor(baseColor: string): string {
  const normalized = baseColor.trim().toLowerCase();
  const isDarkMode = isDocumentDarkMode();
  const palette = isDarkMode ? BASE_TOKEN_MAP_DARK : BASE_TOKEN_MAP_LIGHT;
  const fallbackPalette = isDarkMode ? BASE_TOKEN_MAP_DARK.slate : BASE_TOKEN_MAP_LIGHT.slate;
  const tokens = palette[normalized] ?? fallbackPalette;
  applyThemePalette(tokens);
  return normalized;
}
