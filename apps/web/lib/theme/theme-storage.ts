import {
  applyDefaultTheme,
  applyThemeFromPantoneSeed,
  getUserThemePaletteStorageKey,
  getUserThemePantoneStorageKey,
  getUserThemeStorageKey,
  normalizeThemeHexColor,
  type BaseTokens,
} from '@/lib/theme/theme-color';
import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';
import type { GeneratedThemePalette } from '@/lib/theme/generate-palette-from-seed';

/** Device-wide cache (survives logout; used on login and public pages). */
export const DEVICE_THEME_PRIMARY_KEY = 'elorae:theme-primary';
export const DEVICE_THEME_PANTONE_KEY = 'elorae:theme-pantone-tcx';
export const DEVICE_THEME_PALETTE_KEY = 'elorae:theme-palette';

/** @deprecated Legacy preset base key */
export const DEVICE_THEME_BASE_KEY = 'elorae:theme-base';

export type CachedThemePreference = {
  primary: string;
  pantoneTcx: string | null;
  seedHex: string;
  palette?: GeneratedThemePalette;
};

function parsePaletteJson(raw: string | null): GeneratedThemePalette | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as GeneratedThemePalette;
    if (parsed?.light && parsed?.dark) return parsed;
  } catch {
    // ignore invalid cache
  }
  return undefined;
}

export function readThemeFromLocalStorage(userId?: string | null): CachedThemePreference | null {
  if (typeof window === 'undefined') return null;

  let primaryRaw = localStorage.getItem(DEVICE_THEME_PRIMARY_KEY);
  let pantoneRaw = localStorage.getItem(DEVICE_THEME_PANTONE_KEY);
  let paletteRaw = localStorage.getItem(DEVICE_THEME_PALETTE_KEY);

  if (userId) {
    const userPrimary = localStorage.getItem(getUserThemeStorageKey(userId));
    const userPantone = localStorage.getItem(getUserThemePantoneStorageKey(userId));
    const userPalette = localStorage.getItem(getUserThemePaletteStorageKey(userId));
    if (userPrimary) primaryRaw = userPrimary;
    if (userPantone !== null) pantoneRaw = userPantone;
    if (userPalette) paletteRaw = userPalette;
  }

  if (!primaryRaw && pantoneRaw === null && !paletteRaw) return null;

  let primary = DEFAULT_THEME_PRIMARY_COLOR;
  let pantoneTcx: string | null = null;
  let palette: GeneratedThemePalette | undefined;

  if (pantoneRaw === '' || pantoneRaw === 'null') {
    pantoneTcx = null;
  } else if (pantoneRaw) {
    pantoneTcx = pantoneRaw;
  }

  palette = parsePaletteJson(paletteRaw);

  if (primaryRaw) {
    try {
      primary = normalizeThemeHexColor(primaryRaw);
    } catch {
      // ignore invalid cache
    }
  }

  const seedHex = primary;

  return { primary, pantoneTcx, seedHex, palette };
}

export function saveThemeToLocalStorage(
  preference: CachedThemePreference,
  userId?: string | null
): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(DEVICE_THEME_PRIMARY_KEY, preference.primary);
  localStorage.setItem(
    DEVICE_THEME_PANTONE_KEY,
    preference.pantoneTcx ?? ''
  );

  if (preference.palette) {
    const json = JSON.stringify(preference.palette);
    localStorage.setItem(DEVICE_THEME_PALETTE_KEY, json);
    if (userId) {
      localStorage.setItem(getUserThemePaletteStorageKey(userId), json);
    }
  } else {
    localStorage.removeItem(DEVICE_THEME_PALETTE_KEY);
    if (userId) {
      localStorage.removeItem(getUserThemePaletteStorageKey(userId));
    }
  }

  if (userId) {
    localStorage.setItem(getUserThemeStorageKey(userId), preference.primary);
    localStorage.setItem(
      getUserThemePantoneStorageKey(userId),
      preference.pantoneTcx ?? ''
    );
  }
}

/** Apply cached theme to the document (client-only). Returns true when cache existed. */
export function applyCachedThemeFromLocalStorage(userId?: string | null): boolean {
  const cached = readThemeFromLocalStorage(userId);
  if (!cached) return false;

  const isDefaultSeed =
    cached.seedHex === DEFAULT_THEME_PRIMARY_COLOR && cached.primary === DEFAULT_THEME_PRIMARY_COLOR;

  if (cached.pantoneTcx === null && isDefaultSeed && !cached.palette) {
    applyDefaultTheme();
    return true;
  }

  applyThemeFromPantoneSeed(cached.seedHex, cached.palette);
  return true;
}

export type SerializedPaletteCache = {
  light: BaseTokens;
  dark: BaseTokens;
};

export function buildDefaultThemeCache(): CachedThemePreference {
  return {
    primary: DEFAULT_THEME_PRIMARY_COLOR,
    pantoneTcx: null,
    seedHex: DEFAULT_THEME_PRIMARY_COLOR,
  };
}
