'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getUserThemePreference,
  setCompanyThemeColor,
  setUserThemePreference,
} from '@/app/actions/settings/theme';
import {
  PantoneThemePickerDialog,
  type PantoneThemeSelection,
} from '@/components/settings/PantoneThemePickerDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { AlarmClock, BellRing, Building2, Coins, Loader2, Palette } from 'lucide-react';
import { KELOMPOK_PENGATURAN, kunciIsiKartu, kunciJudulKartu, type KartuPengaturan } from "./kartu-pengaturan";
import { generatePaletteFromSeed } from '@/lib/theme/generate-palette-from-seed';
import { UIThemePicker } from '@/components/settings/UIThemePicker';
import { WarnaGrafikCard } from '@/components/settings/WarnaGrafikCard';
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
import { tentukanWarnaTema, type WarnaEfektif, type WarnaTersimpan } from '@/lib/theme/warna-efektif';
import { pasangWarnaEfektif } from '@/lib/theme/pasang-warna';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';

/** Kartu pengaturan yang ditempel ke kelompoknya di `KELOMPOK_PENGATURAN`. */
const KARTU_TAMBAHAN: Record<string, KartuPengaturan[]> = {
  "hub.groupField": [{ key: "spgCommission", href: "/backoffice/settings/spg-commission", icon: Coins }],
  "hub.groupData": [
    { key: "overdueThresholds", href: "/backoffice/settings/piutang", icon: AlarmClock },
    { key: "paymentReminders", href: "/backoffice/settings/purchasing", icon: BellRing },
  ],
};

/** Kartu yang hanya tampil bagi pemegang salah satu izin ini; kartu lain selalu tampil. */
const IZIN_KARTU: Record<string, string[]> = {
  "/backoffice/settings/pack-ratio": [PERMISSIONS.SETTINGS_PACK_RATIO_VIEW, PERMISSIONS.SETTINGS_PACK_RATIO_MANAGE],
  "/backoffice/settings/spg-commission": [PERMISSIONS.SPG_COMMISSION_MANAGE],
};

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
  // Satu dialog Pantone untuk dua keperluan: warna saya, atau warna perusahaan.
  const [modePemilih, setModePemilih] = useState<'pribadi' | 'perusahaan'>('pribadi');
  const [perusahaan, setPerusahaan] = useState<WarnaTersimpan | null>(null);
  const [simpanPerusahaan, setSimpanPerusahaan] = useState(false);
  const [isThemeLoading, setIsThemeLoading] = useState(true);
  const [isThemeSaving, setIsThemeSaving] = useState(false);

  // Pengaturan usaha di atas (dipakai bersama semua orang), tampilan pribadi di bawah.
  const izinSaya = session?.user?.permissions ?? [];
  const kelompok = KELOMPOK_PENGATURAN.map((k) => ({
    ...k,
    items: [...k.items, ...(KARTU_TAMBAHAN[k.judulKey] ?? [])].filter((item) => {
      const izin = IZIN_KARTU[item.href];
      return izin === undefined || izin.some((code) => hasPermission(izinSaya, code));
    }),
  })).filter((k) => k.items.length > 0);
  const [konfirmasiHapusPerusahaan, setKonfirmasiHapusPerusahaan] = useState(false);

  const userId = session?.user?.id ?? null;
  const bolehAturPerusahaan = hasPermission(
    session?.user?.permissions ?? [],
    PERMISSIONS.SETTINGS_SECURITY_MANAGE,
  );

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
    pasangEfektif(tentukanWarnaTema({ hex: next.primaryHex, tcx: next.pantoneTcx }, perusahaan), false);
  };

  /**
   * Pasang warna efektif (pribadi → perusahaan → bawaan) di layar, dan simpan ke
   * perangkat supaya muat berikutnya langsung berwarna benar tanpa berkedip.
   */
  const pasangEfektif = (efektif: WarnaEfektif, simpan = true) =>
    pasangWarnaEfektif(efektif, userId, simpan);

  const aturPerusahaan = async (pilihan: Parameters<typeof setCompanyThemeColor>[0]) => {
    setSimpanPerusahaan(true);
    try {
      const { perusahaan: baru } = await setCompanyThemeColor(pilihan);
      setPerusahaan(baru);
      // Admin yang belum punya warna sendiri langsung melihat warna barunya.
      if (isDefaultSeed(saved.primaryHex)) {
        pasangEfektif(tentukanWarnaTema({ hex: saved.primaryHex }, baru));
      }
      toast.success(tToasts('saved'));
    } catch {
      toast.error(tToasts('failedToSave'));
    } finally {
      setSimpanPerusahaan(false);
    }
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
        setPerusahaan(preference.perusahaan);
        pasangEfektif(preference.efektif);
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

    // Tanpa warna pribadi yang berlaku warna perusahaan, kalau ada.
    pasangEfektif(tentukanWarnaTema({ hex: DEFAULT_THEME_PRIMARY_COLOR }, perusahaan));
    const fallback: ThemeDraft = {
      pantoneTcx: null,
      pantoneName: null,
      primaryHex: DEFAULT_THEME_PRIMARY_COLOR,
    };
    setDraft(fallback);

    try {
      const result = await setUserThemePreference({ reset: true });
      pasangEfektif(result.efektif);
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
      <div className="flex items-center gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <TombolBantuan judul={t('title')} />
      </div>

      {kelompok.map((k) => (
        <section key={k.judulKey} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t(k.judulKey as never)}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {k.items.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <item.icon className="h-5 w-5" />
                      {t(kunciJudulKartu(item) as never)}
                    </CardTitle>
                    <CardDescription>{t(kunciIsiKartu(item) as never)}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <h2 className="border-t pt-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {t('hub.groupMine')}
      </h2>

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
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div
              className="h-24 w-24 shrink-0 rounded-lg border shadow-sm"
              style={{
                backgroundColor: isDefaultSeed(draft.primaryHex)
                  ? perusahaan?.hex ?? DEFAULT_THEME_PRIMARY_COLOR
                  : draft.primaryHex,
              }}
              aria-hidden
            />
            <div className="space-y-1 min-w-0">
              {!isDefaultSeed(draft.primaryHex) ? (
                <>
                  <p className="font-medium">{draft.pantoneName ?? '—'}</p>
                  {draft.pantoneTcx ? (
                    <p className="font-mono text-sm text-muted-foreground">{draft.pantoneTcx}</p>
                  ) : null}
                  <p className="font-mono text-sm text-muted-foreground">{draft.primaryHex}</p>
                </>
              ) : perusahaan ? (
                <p className="text-muted-foreground">{tTheme('followsCompany')}</p>
              ) : (
                <p className="text-muted-foreground">{tTheme('defaultLabel')}</p>
              )}
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
                    title={tTheme(`swatch.${key}`)}
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
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setModePemilih('pribadi');
                  setPickerOpen(true);
                }}
                disabled={isThemeLoading || isThemeSaving}
              >
                {tTheme('choosePantone')}
              </Button>
            </TabsContent>

            <TabsContent value="popular" className="space-y-3 pt-3">
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
              {perusahaan ? tTheme('useCompany') : tTheme('resetDefault')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Warna grafik beranda pilihan orang ini sendiri (pemilik 2026-10-09). */}
      <WarnaGrafikCard />

      {bolehAturPerusahaan ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {tTheme('companyTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div
                className="h-14 w-14 shrink-0 rounded-lg border"
                style={{ backgroundColor: perusahaan?.hex ?? DEFAULT_THEME_PRIMARY_COLOR }}
                aria-hidden
              />
              <div className="min-w-0 space-y-0.5">
                {perusahaan ? (
                  <>
                    <p className="font-medium">{perusahaan.name ?? perusahaan.hex}</p>
                    <p className="font-mono text-sm text-muted-foreground">
                      {[perusahaan.tcx, perusahaan.hex].filter(Boolean).join(' · ')}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">{tTheme('companyNone')}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={simpanPerusahaan || isThemeLoading || isDefaultSeed(saved.primaryHex)}
                onClick={() =>
                  void aturPerusahaan(
                    saved.pantoneTcx
                      ? { tcx: saved.pantoneTcx }
                      : { hex: saved.primaryHex, name: saved.pantoneName },
                  )
                }
              >
                {tTheme('companyUseMine')}
              </Button>
              <Button
                variant="outline"
                disabled={simpanPerusahaan}
                onClick={() => {
                  setModePemilih('perusahaan');
                  setPickerOpen(true);
                }}
              >
                {tTheme('choosePantone')}
              </Button>
              {perusahaan ? (
                <Button variant="ghost" disabled={simpanPerusahaan} onClick={() => setKonfirmasiHapusPerusahaan(true)}>
                  {tTheme('companyClear')}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PantoneThemePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={
          modePemilih === 'perusahaan'
            ? (pilihan) => void aturPerusahaan({ tcx: pilihan.tcx })
            : handlePantoneSelect
        }
      />

      <AlertDialog open={konfirmasiHapusPerusahaan} onOpenChange={setKonfirmasiHapusPerusahaan}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('hub.companyClearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('hub.companyClearBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('hub.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setKonfirmasiHapusPerusahaan(false);
                void aturPerusahaan({ reset: true });
              }}
            >
              {tTheme('companyClear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
