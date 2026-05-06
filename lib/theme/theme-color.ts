const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const BASE_STORAGE_KEY = 'elorae:user-theme-primary';
const BASE_COLOR_STORAGE_KEY = 'elorae:user-theme-base';

export function getUserThemeStorageKey(userId: string): string {
  return `${BASE_STORAGE_KEY}:${userId}`;
}

export function getUserThemeBaseStorageKey(userId: string): string {
  return `${BASE_COLOR_STORAGE_KEY}:${userId}`;
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

type BaseTokens = {
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

const BASE_TOKEN_MAP_LIGHT: Record<string, BaseTokens> = {
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
  gray: {
    background: '#ffffff',
    foreground: '#111827',
    card: '#ffffff',
    cardForeground: '#111827',
    popover: '#ffffff',
    popoverForeground: '#111827',
    secondary: '#f3f4f6',
    secondaryForeground: '#111827',
    muted: '#f3f4f6',
    mutedForeground: '#4b5563',
    accent: '#f3f4f6',
    accentForeground: '#111827',
    border: '#e5e7eb',
    input: '#e5e7eb',
  },
  zinc: {
    background: '#ffffff',
    foreground: '#18181b',
    card: '#ffffff',
    cardForeground: '#18181b',
    popover: '#ffffff',
    popoverForeground: '#18181b',
    secondary: '#f4f4f5',
    secondaryForeground: '#18181b',
    muted: '#f4f4f5',
    mutedForeground: '#52525b',
    accent: '#f4f4f5',
    accentForeground: '#18181b',
    border: '#e4e4e7',
    input: '#e4e4e7',
  },
  neutral: {
    background: '#ffffff',
    foreground: '#171717',
    card: '#ffffff',
    cardForeground: '#171717',
    popover: '#ffffff',
    popoverForeground: '#171717',
    secondary: '#f5f5f5',
    secondaryForeground: '#171717',
    muted: '#f5f5f5',
    mutedForeground: '#525252',
    accent: '#f5f5f5',
    accentForeground: '#171717',
    border: '#e5e5e5',
    input: '#e5e5e5',
  },
  stone: {
    background: '#ffffff',
    foreground: '#1c1917',
    card: '#ffffff',
    cardForeground: '#1c1917',
    popover: '#ffffff',
    popoverForeground: '#1c1917',
    secondary: '#f5f5f4',
    secondaryForeground: '#1c1917',
    muted: '#f5f5f4',
    mutedForeground: '#57534e',
    accent: '#f5f5f4',
    accentForeground: '#1c1917',
    border: '#e7e5e4',
    input: '#e7e5e4',
  },
};

const BASE_TOKEN_MAP_DARK: Record<string, BaseTokens> = {
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
  gray: {
    background: '#111827',
    foreground: '#f9fafb',
    card: '#1f2937',
    cardForeground: '#f9fafb',
    popover: '#1f2937',
    popoverForeground: '#f9fafb',
    secondary: '#374151',
    secondaryForeground: '#f9fafb',
    muted: '#374151',
    mutedForeground: '#9ca3af',
    accent: '#374151',
    accentForeground: '#f9fafb',
    border: '#374151',
    input: '#4b5563',
  },
  zinc: {
    background: '#18181b',
    foreground: '#fafafa',
    card: '#27272a',
    cardForeground: '#fafafa',
    popover: '#27272a',
    popoverForeground: '#fafafa',
    secondary: '#3f3f46',
    secondaryForeground: '#fafafa',
    muted: '#3f3f46',
    mutedForeground: '#a1a1aa',
    accent: '#3f3f46',
    accentForeground: '#fafafa',
    border: '#3f3f46',
    input: '#52525b',
  },
  neutral: {
    background: '#171717',
    foreground: '#fafafa',
    card: '#262626',
    cardForeground: '#fafafa',
    popover: '#262626',
    popoverForeground: '#fafafa',
    secondary: '#404040',
    secondaryForeground: '#fafafa',
    muted: '#404040',
    mutedForeground: '#a3a3a3',
    accent: '#404040',
    accentForeground: '#fafafa',
    border: '#404040',
    input: '#525252',
  },
  stone: {
    background: '#1c1917',
    foreground: '#fafaf9',
    card: '#292524',
    cardForeground: '#fafaf9',
    popover: '#292524',
    popoverForeground: '#fafaf9',
    secondary: '#44403c',
    secondaryForeground: '#fafaf9',
    muted: '#44403c',
    mutedForeground: '#a8a29e',
    accent: '#44403c',
    accentForeground: '#fafaf9',
    border: '#44403c',
    input: '#57534e',
  },
};

export function applyThemeBaseColor(baseColor: string): string {
  const normalized = baseColor.trim().toLowerCase();
  const isDarkMode = document.documentElement.classList.contains('dark');
  const palette = isDarkMode ? BASE_TOKEN_MAP_DARK : BASE_TOKEN_MAP_LIGHT;
  const fallbackPalette = isDarkMode ? BASE_TOKEN_MAP_DARK.slate : BASE_TOKEN_MAP_LIGHT.slate;
  const tokens = palette[normalized] ?? fallbackPalette;
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

  return normalized;
}
