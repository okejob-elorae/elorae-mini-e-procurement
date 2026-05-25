'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getUserThemePreference, setUserThemePreference } from '@/app/actions/settings/theme';
import {
  PantoneThemePickerDialog,
  type PantoneThemeSelection,
} from '@/components/settings/PantoneThemePickerDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  FileDigit,
  KeyRound,
  Loader2,
  Palette,
  Percent,
  Ruler,
  Shield,
  Users,
} from 'lucide-react';
import { generatePaletteFromSeed } from '@/lib/theme/generate-palette-from-seed';
import {
  applyDefaultTheme,
  applyThemeFromPantoneSeed,
  isDocumentDarkMode,
  normalizeThemeHexColor,
} from '@/lib/theme/theme-color';
import { readThemeFromLocalStorage, saveThemeToLocalStorage } from '@/lib/theme/theme-storage';
import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';

type ThemeDraft = {
  pantoneTcx: string | null;
  pantoneName: string | null;
  primaryHex: string;
};

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tTheme = useTranslations('settings.theme');
  const tToasts = useTranslations('toasts');
  const { data: session, status } = useSession();
  const [saved, setSaved] = useState<ThemeDraft>({
    pantoneTcx: null,
    pantoneName: null,
    primaryHex: DEFAULT_THEME_PRIMARY_COLOR,
  });
  const [draft, setDraft] = useState<ThemeDraft>(saved);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const previewPalette = useMemo(() => {
    if (draft.pantoneTcx === null) return null;
    try {
      return generatePaletteFromSeed(draft.primaryHex);
    } catch {
      return null;
    }
  }, [draft.pantoneTcx, draft.primaryHex]);

  const previewTokens = previewPalette
    ? isDocumentDarkMode()
      ? previewPalette.dark
      : previewPalette.light
    : null;

  const applyDraftToDocument = (next: ThemeDraft) => {
    if (next.pantoneTcx === null) {
      applyDefaultTheme();
      return;
    }
    const palette = generatePaletteFromSeed(next.primaryHex);
    applyThemeFromPantoneSeed(next.primaryHex, palette);
  };

  useEffect(() => {
    if (status !== 'authenticated' || !userId) {
      setIsThemeLoading(false);
      return;
    }

    const cached = readThemeFromLocalStorage(userId);
    if (cached) {
      const cachedDraft: ThemeDraft = {
        pantoneTcx: cached.pantoneTcx,
        pantoneName: null,
        primaryHex: cached.seedHex,
      };
      setDraft(cachedDraft);
      if (cached.pantoneTcx) {
        applyThemeFromPantoneSeed(cached.seedHex, cached.palette);
      } else {
        applyDefaultTheme();
      }
    }

    void getUserThemePreference()
      .then((preference) => {
        const primaryHex = normalizeThemeHexColor(preference.primaryHex);
        const next: ThemeDraft = {
          pantoneTcx: preference.pantoneTcx,
          pantoneName: preference.pantoneName ?? null,
          primaryHex,
        };
        setSaved(next);
        setDraft(next);
        applyDraftToDocument(next);
        const palette =
          next.pantoneTcx !== null ? generatePaletteFromSeed(primaryHex) : undefined;
        saveThemeToLocalStorage(
          {
            primary: primaryHex,
            pantoneTcx: next.pantoneTcx,
            seedHex: primaryHex,
            palette,
          },
          userId
        );
      })
      .catch(() => {
        toast.error(tTheme('loadError'));
      })
      .finally(() => setIsThemeLoading(false));
  }, [status, userId, tTheme]);

  const handlePantoneSelect = (selection: PantoneThemeSelection) => {
    const primaryHex = normalizeThemeHexColor(selection.hex);
    const next: ThemeDraft = {
      pantoneTcx: selection.tcx,
      pantoneName: selection.name,
      primaryHex,
    };
    setDraft(next);
    applyDraftToDocument(next);
  };

  const handleThemeSave = async () => {
    if (!userId) return;
    setIsThemeSaving(true);

    try {
      if (draft.pantoneTcx === null) {
        throw new Error('Select a Pantone color first');
      }

      const palette = generatePaletteFromSeed(draft.primaryHex);
      applyThemeFromPantoneSeed(draft.primaryHex, palette);
      saveThemeToLocalStorage(
        {
          primary: draft.primaryHex,
          pantoneTcx: draft.pantoneTcx,
          seedHex: draft.primaryHex,
          palette,
        },
        userId
      );

      const result = await setUserThemePreference({ tcx: draft.pantoneTcx });
      const savedState: ThemeDraft = {
        pantoneTcx: result.pantoneTcx,
        pantoneName: result.pantoneName ?? draft.pantoneName,
        primaryHex: normalizeThemeHexColor(result.primaryHex),
      };
      setSaved(savedState);
      setDraft(savedState);
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

    applyDefaultTheme();
    const fallback: ThemeDraft = {
      pantoneTcx: null,
      pantoneName: null,
      primaryHex: DEFAULT_THEME_PRIMARY_COLOR,
    };
    setDraft(fallback);
    saveThemeToLocalStorage(
      {
        primary: DEFAULT_THEME_PRIMARY_COLOR,
        pantoneTcx: null,
        seedHex: DEFAULT_THEME_PRIMARY_COLOR,
      },
      userId
    );

    try {
      const result = await setUserThemePreference({ reset: true });
      const savedState: ThemeDraft = {
        pantoneTcx: result.pantoneTcx,
        pantoneName: null,
        primaryHex: normalizeThemeHexColor(result.primaryHex),
      };
      setSaved(savedState);
      setDraft(savedState);
      toast.success(tToasts('saved'));
    } catch {
      toast.error(tToasts('failedToSave'));
    } finally {
      setIsThemeSaving(false);
    }
  };

  const isDirty =
    draft.pantoneTcx !== saved.pantoneTcx ||
    draft.primaryHex !== saved.primaryHex;

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
            {tTheme('title')}
          </CardTitle>
          <CardDescription>{tTheme('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div
              className="h-24 w-24 shrink-0 rounded-lg border shadow-sm"
              style={{
                backgroundColor:
                  draft.pantoneTcx !== null ? draft.primaryHex : DEFAULT_THEME_PRIMARY_COLOR,
              }}
              aria-hidden
            />
            <div className="space-y-1 min-w-0">
              {draft.pantoneTcx ? (
                <>
                  <p className="font-medium">{draft.pantoneName ?? '—'}</p>
                  <p className="font-mono text-sm text-muted-foreground">{draft.pantoneTcx}</p>
                  <p className="font-mono text-sm text-muted-foreground">{draft.primaryHex}</p>
                </>
              ) : (
                <p className="text-muted-foreground">{tTheme('defaultLabel')}</p>
              )}
              <p className="text-sm text-muted-foreground pt-1">{tTheme('hint')}</p>
            </div>
          </div>

          {previewTokens && (
            <div className="space-y-2">
              <Label>{tTheme('previewLabel')}</Label>
              <div className="flex flex-wrap gap-2">
                <span
                  className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-primary-foreground"
                  style={{ backgroundColor: draft.primaryHex }}
                >
                  {tTheme('previewPrimary')}
                </span>
                {(
                  [
                    ['background', previewTokens.background],
                    ['card', previewTokens.card],
                    ['muted', previewTokens.muted],
                    ['border', previewTokens.border],
                  ] as const
                ).map(([key, color]) => (
                  <span
                    key={key}
                    className="h-9 w-14 rounded-md border"
                    style={{ backgroundColor: color }}
                    title={key}
                  />
                ))}
              </div>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => setPickerOpen(true)}
            disabled={isThemeLoading || isThemeSaving}
          >
            {tTheme('choosePantone')}
          </Button>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleThemeSave}
              disabled={
                isThemeLoading || isThemeSaving || !isDirty || draft.pantoneTcx === null
              }
            >
              {isThemeSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : tTheme('save')}
            </Button>
            <Button
              variant="outline"
              onClick={handleThemeReset}
              disabled={isThemeLoading || isThemeSaving}
            >
              {tTheme('resetDefault')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <PantoneThemePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePantoneSelect}
      />

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
