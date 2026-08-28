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
  Layers,
  Loader2,
  Palette,
  Percent,
  Ruler,
  Shield,
  Users,
  Tags,
} from 'lucide-react';
import { generatePaletteFromSeed } from '@/lib/theme/generate-palette-from-seed';
import { UIThemePicker } from '@/components/settings/UIThemePicker';
import { FontPicker } from '@/components/settings/FontPicker';
import { getUserFont } from '@/app/actions/settings/theme';
import { FONT_BAWAAN } from '@/lib/theme/fonts';
import { DEVELOPER_PALETTES } from '@/lib/theme/developer-palettes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
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
  const tDev = useTranslations('settings.developerThemes');
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
    { titleKey: 'itemCodes.title' as const, descriptionKey: 'itemCodes.description' as const, href: '/backoffice/settings/item-codes', icon: FileDigit },
    { titleKey: 'tax.title' as const, descriptionKey: 'tax.description' as const, href: '/backoffice/settings/tax', icon: Percent },
    { titleKey: 'uom.title' as const, descriptionKey: 'uom.description' as const, href: '/backoffice/settings/uom', icon: Ruler },
    { titleKey: 'rbac.title' as const, descriptionKey: 'rbac.description' as const, href: '/backoffice/settings/rbac', icon: Users },
    { titleKey: 'packRatio.title' as const, descriptionKey: 'packRatio.description' as const, href: '/backoffice/settings/pack-ratio', icon: Layers },
    { titleKey: 'jenisPotongan.title' as const, descriptionKey: 'jenisPotongan.description' as const, href: '/backoffice/settings/jenis-potongan', icon: Tags },
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

  const isDefaultSeed = (hex: string) =>
    hex.toLowerCase() === DEFAULT_THEME_PRIMARY_COLOR.toLowerCase();

  const applyDraftToDocument = (next: ThemeDraft) => {
    /*
     * Keyed on the colour, not on whether it has a Pantone code. Before the
     * popular palettes existed, "no TCX" could only mean "nothing chosen", so
     * branching on it was correct; now it can also mean a real colour with no
     * Pantone identity, and treating that as the default silently threw the
     * choice away.
     */
    if (isDefaultSeed(next.primaryHex)) {
      applyDefaultTheme();
      return;
    }
    const palette = generatePaletteFromSeed(next.primaryHex);
    applyThemeFromPantoneSeed(next.primaryHex, palette);
  };

  const [fontTersimpan, setFontTersimpan] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    void getUserFont()
      .then((f) => {
        if (!batal) setFontTersimpan(f);
      })
      // Gagal membaca huruf tidak boleh mengosongkan seluruh layar pengaturan.
      .catch(() => {
        if (!batal) setFontTersimpan(FONT_BAWAAN);
      });
    return () => {
      batal = true;
    };
  }, []);

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
      if (cached.seedHex && !isDefaultSeed(cached.seedHex)) {
        applyThemeFromPantoneSeed(
          cached.seedHex,
          cached.palette ?? generatePaletteFromSeed(cached.seedHex),
        );
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
        const palette = isDefaultSeed(primaryHex)
          ? undefined
          : generatePaletteFromSeed(primaryHex);
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

  const handlePaletteSelect = (palette: { name: string; hex: string }) => {
    // Same draft shape as the Pantone path, minus the code — a palette with no
    // Pantone identity must record that honestly rather than borrow one.
    const next: ThemeDraft = {
      pantoneTcx: null,
      pantoneName: palette.name,
      primaryHex: normalizeThemeHexColor(palette.hex),
    };
    setDraft(next);
    applyDraftToDocument(next);
  };

  const handleThemeSave = async () => {
    if (!userId) return;
    setIsThemeSaving(true);

    try {
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

      const result =
        draft.pantoneTcx !== null
          ? await setUserThemePreference({ tcx: draft.pantoneTcx })
          : await setUserThemePreference({ hex: draft.primaryHex });
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

      <UIThemePicker
        onPickAccent={(seed) =>
          handlePantoneSelect({ tcx: seed.tcx, name: seed.name, hex: seed.hex } as PantoneThemeSelection)
        }
      />

      {/* Dipasang setelah huruf tersimpannya terbaca. Merendernya lebih dulu
          dengan bawaan lalu menggeser ke pilihan sebenarnya membuat kartunya
          berkedip ganti huruf tiap kali halaman ini dibuka. */}
      {fontTersimpan !== null && <FontPicker terpilihAwal={fontTersimpan} />}

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

          <Tabs defaultValue={draft.pantoneTcx === null ? 'popular' : 'pantone'}>
            <TabsList>
              <TabsTrigger value="pantone">{tDev('tabPantone')}</TabsTrigger>
              <TabsTrigger value="popular">{tDev('tabPopular')}</TabsTrigger>
            </TabsList>

            <TabsContent value="pantone" className="space-y-3 pt-3">
              <p className="text-sm text-muted-foreground">{tDev('pantoneHint')}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                disabled={isThemeLoading || isThemeSaving}
              >
                {tTheme('choosePantone')}
              </Button>
            </TabsContent>

            <TabsContent value="popular" className="space-y-3 pt-3">
              <p className="text-sm text-muted-foreground">{tDev('popularHint')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {DEVELOPER_PALETTES.map((palette) => {
                  const active =
                    draft.pantoneTcx === null &&
                    draft.primaryHex.toLowerCase() === palette.hex.toLowerCase();
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      onClick={() => handlePaletteSelect(palette)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                        active
                          ? 'border-primary ring-1 ring-primary/40'
                          : 'border-border hover:bg-muted/60',
                      )}
                    >
                      <span
                        className="mt-0.5 h-8 w-8 shrink-0 rounded-md border"
                        style={{ backgroundColor: palette.hex }}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{palette.name}</span>
                        <span className="block text-[11px] leading-snug text-muted-foreground">
                          {tDev(palette.noteKey as never)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleThemeSave}
              disabled={
                isThemeLoading || isThemeSaving || !isDirty
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
