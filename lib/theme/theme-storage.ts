import {
  applyThemeBaseColor,
  applyThemePrimaryColor,
  getUserThemeBaseStorageKey,
  getUserThemeStorageKey,
  normalizeThemeHexColor,
} from '@/lib/theme/theme-color';
import {
  DEFAULT_THEME_BASE_COLOR,
  DEFAULT_THEME_PRIMARY_COLOR,
  ThemeBaseColorName,
  isAllowedThemeBaseColorName,
  isAllowedThemePrimaryColor,
} from '@/lib/theme/theme-presets';

/** Device-wide cache (survives logout; used on login and public pages). */
export const DEVICE_THEME_PRIMARY_KEY = 'elorae:theme-primary';
export const DEVICE_THEME_BASE_KEY = 'elorae:theme-base';

export type CachedThemePreference = {
  primary: string;
  base: ThemeBaseColorName;
};

export function readThemeFromLocalStorage(userId?: string | null): CachedThemePreference | null {
  if (typeof window === 'undefined') return null;

  let primaryRaw = localStorage.getItem(DEVICE_THEME_PRIMARY_KEY);
  let baseRaw = localStorage.getItem(DEVICE_THEME_BASE_KEY);

  if (userId) {
    const userPrimary = localStorage.getItem(getUserThemeStorageKey(userId));
    const userBase = localStorage.getItem(getUserThemeBaseStorageKey(userId));
    if (userPrimary) primaryRaw = userPrimary;
    if (userBase) baseRaw = userBase;
  }

  if (!primaryRaw && !baseRaw) return null;

  let primary = DEFAULT_THEME_PRIMARY_COLOR;
  let base: ThemeBaseColorName = DEFAULT_THEME_BASE_COLOR;

  if (baseRaw && isAllowedThemeBaseColorName(baseRaw)) {
    base = baseRaw;
  }

  if (primaryRaw) {
    try {
      const normalized = normalizeThemeHexColor(primaryRaw);
      if (isAllowedThemePrimaryColor(normalized)) {
        primary = normalized;
      }
    } catch {
      // ignore invalid cache
    }
  }

  return { primary, base };
}

export function saveThemeToLocalStorage(
  preference: CachedThemePreference,
  userId?: string | null
): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(DEVICE_THEME_PRIMARY_KEY, preference.primary);
  localStorage.setItem(DEVICE_THEME_BASE_KEY, preference.base);

  if (userId) {
    localStorage.setItem(getUserThemeStorageKey(userId), preference.primary);
    localStorage.setItem(getUserThemeBaseStorageKey(userId), preference.base);
  }
}

/** Apply cached theme to the document (client-only). Returns true when cache existed. */
export function applyCachedThemeFromLocalStorage(userId?: string | null): boolean {
  const cached = readThemeFromLocalStorage(userId);
  if (!cached) return false;

  applyThemeBaseColor(cached.base);
  applyThemePrimaryColor(cached.primary);
  return true;
}
