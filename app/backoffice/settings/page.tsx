'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getUserThemePreference, setUserThemePreference } from '@/app/actions/settings/theme';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Check, FileDigit, KeyRound, Loader2, Palette, Percent, Ruler, Shield, Users } from 'lucide-react';
import {
  applyThemeBaseColor,
  applyThemePrimaryColor,
  normalizeThemeHexColor,
} from '@/lib/theme/theme-color';
import { readThemeFromLocalStorage, saveThemeToLocalStorage } from '@/lib/theme/theme-storage';
import {
  DEFAULT_THEME_BASE_COLOR,
  DEFAULT_THEME_PRIMARY_COLOR,
  TAILWIND_BASE_COLOR_OPTIONS,
  TAILWIND_THEME_COLOR_OPTIONS,
  isAllowedThemeBaseColorName,
  isAllowedThemePrimaryColor,
} from '@/lib/theme/theme-presets';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tToasts = useTranslations('toasts');
  const { data: session, status } = useSession();
  const [baseColor, setBaseColor] = useState(DEFAULT_THEME_BASE_COLOR);
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME_PRIMARY_COLOR);
  const [initialColor, setInitialColor] = useState(DEFAULT_THEME_PRIMARY_COLOR);
  const [isThemeLoading, setIsThemeLoading] = useState(true);
  const [isThemeSaving, setIsThemeSaving] = useState(false);

  const items = [
    { titleKey: 'security.title' as const, descriptionKey: 'security.description' as const, href: '/backoffice/settings/security', icon: Shield },
    { titleKey: 'documents.title' as const, descriptionKey: 'documents.description' as const, href: '/backoffice/settings/documents', icon: FileDigit },
    { titleKey: 'tax.title' as const, descriptionKey: 'tax.description' as const, href: '/backoffice/settings/tax', icon: Percent },
    { titleKey: 'uom.title' as const, descriptionKey: 'uom.description' as const, href: '/backoffice/settings/uom', icon: Ruler },
    { titleKey: 'rbac.title' as const, descriptionKey: 'rbac.description' as const, href: '/backoffice/settings/rbac', icon: Users },
    { titleKey: 'jubelio.title' as const, descriptionKey: 'jubelio.description' as const, href: '/backoffice/settings/jubelio', icon: KeyRound },
  ];

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (status !== 'authenticated' || !userId) {
      setIsThemeLoading(false);
      return;
    }

    const cached = readThemeFromLocalStorage(userId);

    if (cached) {
      setBaseColor(cached.base);
      applyThemeBaseColor(cached.base);
      setThemeColor(cached.primary);
    }

    void getUserThemePreference()
      .then((preference) => {
        const finalBase = isAllowedThemeBaseColorName(preference.baseColor)
          ? preference.baseColor
          : DEFAULT_THEME_BASE_COLOR;
        const normalized = normalizeThemeHexColor(preference.primaryColor);
        const finalColor = isAllowedThemePrimaryColor(normalized)
          ? normalized
          : DEFAULT_THEME_PRIMARY_COLOR;
        setBaseColor(finalBase);
        setThemeColor(finalColor);
        setInitialColor(finalColor);
        applyThemeBaseColor(finalBase);
        saveThemeToLocalStorage({ primary: finalColor, base: finalBase }, userId);
      })
      .catch(() => {
        setBaseColor(DEFAULT_THEME_BASE_COLOR);
        setThemeColor(DEFAULT_THEME_PRIMARY_COLOR);
        setInitialColor(DEFAULT_THEME_PRIMARY_COLOR);
        toast.error('Failed to load theme preference');
      })
      .finally(() => setIsThemeLoading(false));
  }, [status, userId]);

  const handlePresetChange = (nextBase: string) => {
    if (!isAllowedThemeBaseColorName(nextBase)) return;
    setBaseColor(nextBase);
    applyThemeBaseColor(nextBase);
  };

  const handleThemeColorChange = (nextColor: string) => {
    const normalized = normalizeThemeHexColor(nextColor);
    if (!isAllowedThemePrimaryColor(normalized)) return;
    setThemeColor(normalized);
    applyThemePrimaryColor(normalized);
  };

  const handleThemeSave = async () => {
    if (!userId) return;
    setIsThemeSaving(true);

    try {
      const normalized = normalizeThemeHexColor(themeColor);
      if (!isAllowedThemePrimaryColor(normalized)) {
        throw new Error('Invalid preset color');
      }
      if (!isAllowedThemeBaseColorName(baseColor)) {
        throw new Error('Invalid base color');
      }
      applyThemeBaseColor(baseColor);
      applyThemePrimaryColor(normalized);
      saveThemeToLocalStorage({ primary: normalized, base: baseColor }, userId);
      const result = await setUserThemePreference({
        baseColor,
        primaryColor: normalized,
      });
      const savedColor = normalizeThemeHexColor(result.primaryColor);
      setBaseColor(result.baseColor);
      setInitialColor(savedColor);
      toast.success(tToasts('saved'));
    } catch {
      toast.error(tToasts('failedToSave'));
    } finally {
      setIsThemeSaving(false);
    }
  };

  const handleThemeReset = async () => {
    if (!userId) return;
    setIsThemeSaving(true);

    const fallbackBase = DEFAULT_THEME_BASE_COLOR;
    const fallback = DEFAULT_THEME_PRIMARY_COLOR;
    applyThemeBaseColor(fallbackBase);
    applyThemePrimaryColor(fallback);
    saveThemeToLocalStorage({ primary: fallback, base: fallbackBase }, userId);

    try {
      const result = await setUserThemePreference({
        baseColor: fallbackBase,
        primaryColor: fallback,
      });
      const savedColor = normalizeThemeHexColor(result.primaryColor);
      setBaseColor(result.baseColor);
      setThemeColor(savedColor);
      setInitialColor(savedColor);
      toast.success(tToasts('saved'));
    } catch {
      toast.error(tToasts('failedToSave'));
    } finally {
      setIsThemeSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Base Color
          </CardTitle>
          <CardDescription>
            Choose from Tailwind preset base colors. This setting is saved to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Base color</Label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TAILWIND_BASE_COLOR_OPTIONS.map((option) => {
                const selected = baseColor === option.name;
                return (
                  <button
                    key={option.name}
                    type="button"
                    onClick={() => handlePresetChange(option.name)}
                    disabled={isThemeLoading || isThemeSaving}
                    className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-4 w-4 rounded-full border"
                        style={{ backgroundColor: option.primary }}
                        aria-hidden="true"
                      />
                      {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Theme color</Label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TAILWIND_THEME_COLOR_OPTIONS.map((option) => {
                const selected = themeColor === option.primary;
                return (
                  <button
                    key={option.name}
                    type="button"
                    onClick={() => handleThemeColorChange(option.primary)}
                    disabled={isThemeLoading || isThemeSaving}
                    className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-4 w-4 rounded-full border"
                        style={{ backgroundColor: option.primary }}
                        aria-hidden="true"
                      />
                      {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleThemeSave} disabled={isThemeLoading || isThemeSaving}>
              {isThemeSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save color'}
            </Button>
            <Button variant="outline" onClick={handleThemeReset} disabled={isThemeLoading || isThemeSaving}>
              Reset default
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Saved color: {initialColor}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <item.icon className="h-5 w-5" />
                  {t(item.titleKey)}
                </CardTitle>
                <CardDescription>{t(item.descriptionKey)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
