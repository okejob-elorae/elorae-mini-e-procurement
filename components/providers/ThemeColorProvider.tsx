'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { getUserThemePreference } from '@/app/actions/settings/theme';
import {
  applyThemeBaseColor,
  applyThemePrimaryColor,
  clearThemePrimaryColor,
  getUserThemeBaseStorageKey,
  getUserThemeStorageKey,
  normalizeThemeHexColor,
} from '@/lib/theme/theme-color';
import {
  DEFAULT_THEME_BASE_COLOR,
  DEFAULT_THEME_PRIMARY_COLOR,
  isAllowedThemeBaseColorName,
  isAllowedThemePrimaryColor,
} from '@/lib/theme/theme-presets';

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) {
      clearThemePrimaryColor();
      return;
    }

    const storageKey = getUserThemeStorageKey(session.user.id);
    const baseStorageKey = getUserThemeBaseStorageKey(session.user.id);
    const cached = localStorage.getItem(storageKey);
    const cachedBase = localStorage.getItem(baseStorageKey);

    if (cachedBase && isAllowedThemeBaseColorName(cachedBase)) {
      applyThemeBaseColor(cachedBase);
    } else {
      localStorage.removeItem(baseStorageKey);
    }

    if (cached) {
      try {
        const normalized = normalizeThemeHexColor(cached);
        if (!isAllowedThemePrimaryColor(normalized)) {
          throw new Error('Invalid preset color');
        }
        applyThemePrimaryColor(normalized);
      } catch {
        localStorage.removeItem(storageKey);
      }
    }

    void getUserThemePreference()
      .then((preference) => {
        const base = isAllowedThemeBaseColorName(preference.baseColor)
          ? preference.baseColor
          : DEFAULT_THEME_BASE_COLOR;
        const normalized = normalizeThemeHexColor(preference.primaryColor);
        const finalColor = isAllowedThemePrimaryColor(normalized)
          ? normalized
          : DEFAULT_THEME_PRIMARY_COLOR;
        applyThemeBaseColor(base);
        const applied = applyThemePrimaryColor(finalColor);
        localStorage.setItem(baseStorageKey, base);
        localStorage.setItem(storageKey, applied);
      })
      .catch(() => {
        if (!cachedBase) {
          applyThemeBaseColor(DEFAULT_THEME_BASE_COLOR);
        }
        if (!cached) {
          applyThemePrimaryColor(DEFAULT_THEME_PRIMARY_COLOR);
        }
        // Keep cached state when server action fails.
      });
  }, [session?.user?.id, status]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

    const baseStorageKey = getUserThemeBaseStorageKey(session.user.id);
    const observer = new MutationObserver(() => {
      const cachedBase = localStorage.getItem(baseStorageKey);
      const base = cachedBase && isAllowedThemeBaseColorName(cachedBase)
        ? cachedBase
        : DEFAULT_THEME_BASE_COLOR;
      applyThemeBaseColor(base);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, [session?.user?.id, status]);

  return <>{children}</>;
}
