'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useSession } from 'next-auth/react';
import { getUserThemePreference } from '@/app/actions/settings/theme';
import { applyDefaultTheme, applyThemeFromPantoneSeed } from '@/lib/theme/theme-color';
import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';
import { pasangWarnaEfektif } from '@/lib/theme/pasang-warna';
import {
  applyCachedThemeFromLocalStorage,
  readThemeFromLocalStorage,
  saveThemeToLocalStorage,
} from '@/lib/theme/theme-storage';

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const userId = session?.user?.id ?? null;

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
        /*
         * Yang dipasang warna EFEKTIF (pribadi → perusahaan → bawaan), bukan
         * warna pribadi. Dulu cabangnya `pantoneTcx === null` = bawaan, yang
         * membuang warna palet populer (tanpa kode Pantone) setiap muat ulang.
         */
        pasangWarnaEfektif(preference.efektif, userId);
      })
      .catch(() => {
        // Keep device / local cache when the server action fails.
      });
  }, [userId, status]);

  useEffect(() => {
    const cached = readThemeFromLocalStorage(userId);
    const seedHex = cached?.seedHex ?? DEFAULT_THEME_PRIMARY_COLOR;
    const palette = cached?.palette;

    const observer = new MutationObserver(() => {
      if (cached?.pantoneTcx === null && !palette) {
        applyDefaultTheme();
      } else {
        applyThemeFromPantoneSeed(seedHex, palette);
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, [userId]);

  return <>{children}</>;
}
