'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useSession } from 'next-auth/react';
import { getUserThemePreference } from '@/app/actions/settings/theme';
import {
  applyThemeBaseColor,
  applyThemePrimaryColor,
  normalizeThemeHexColor,
} from '@/lib/theme/theme-color';
import {
  DEFAULT_THEME_BASE_COLOR,
  DEFAULT_THEME_PRIMARY_COLOR,
  isAllowedThemeBaseColorName,
  isAllowedThemePrimaryColor,
} from '@/lib/theme/theme-presets';
import {
  applyCachedThemeFromLocalStorage,
  readThemeFromLocalStorage,
  saveThemeToLocalStorage,
} from '@/lib/theme/theme-storage';

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const userId = session?.user?.id ?? null;

  // Re-apply cached theme before paint (backup to the blocking <head> script).
  useLayoutEffect(() => {
    applyCachedThemeFromLocalStorage(userId);
  }, [userId]);

  useEffect(() => {
    applyCachedThemeFromLocalStorage(userId);

    const cached = readThemeFromLocalStorage(userId);
    if (cached) {
      saveThemeToLocalStorage(cached, userId);
    }

    if (status !== 'authenticated' || !userId) {
      return;
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
        applyThemePrimaryColor(finalColor);
        saveThemeToLocalStorage({ primary: finalColor, base }, userId);
      })
      .catch(() => {
        // Keep device / local cache when the server action fails.
      });
  }, [userId, status]);

  useEffect(() => {
    const cached = readThemeFromLocalStorage(userId);
    const base = cached?.base ?? DEFAULT_THEME_BASE_COLOR;

    const observer = new MutationObserver(() => {
      applyThemeBaseColor(base);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, [userId]);

  return <>{children}</>;
}
