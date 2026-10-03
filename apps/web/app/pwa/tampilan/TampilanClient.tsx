"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Building2, Check, Monitor, Moon, Search, Sun } from "lucide-react";
import { toast } from "sonner";
import {
  getUserThemePreference,
  setUserThemePreference,
  type UserThemePreference,
} from "@/app/actions/settings/theme";
import { PantoneThemePickerDialog } from "@/components/settings/PantoneThemePickerDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DEVELOPER_PALETTES } from "@/lib/theme/developer-palettes";
import { pasangWarnaEfektif } from "@/lib/theme/pasang-warna";
import { DEFAULT_THEME_PRIMARY_COLOR } from "@/lib/theme/theme-presets";
import { UI_THEMES } from "@/lib/theme/ui-themes";
import { tentukanWarnaTema, type WarnaEfektif } from "@/lib/theme/warna-efektif";
import { cn } from "@/lib/utils";

import { TautanKembali } from "@/app/pwa/TautanKembali";
/**
 * Tampilan di aplikasi HP: warna dan mode terang/gelap milik orang ini.
 *
 * Tanpa layar ini salesman dan SPG tidak pernah bisa memilih warna — layar
 * pengaturan tema hanya ada di backoffice. Bawaannya warna perusahaan; memilih
 * warna di sini menimpanya untuk orang ini saja.
 *
 * Satu ketukan = langsung terpasang dan tersimpan, tanpa tombol Simpan: di HP,
 * langkah konfirmasi tambahan hanya jadi satu hal lagi untuk dilupakan.
 */

type Pilihan = { tcx: string; name: string; hex: string } | { name: string; hex: string } | "perusahaan";

// Warna tanpa kode Pantone disimpan hanya sebagai hex; namanya dicari kembali
// dari daftar pilihan cepat supaya layar menyebut "Nord", bukan "#5e81ac".
const PILIHAN_CEPAT = [
  ...UI_THEMES.map((u) => ({ key: u.id, name: u.seed.name, hex: u.seed.hex, tcx: u.seed.tcx as string | null })),
  ...DEVELOPER_PALETTES.map((d) => ({ key: d.id, name: d.name, hex: d.hex, tcx: null as string | null })),
];
const namaDariHex = (hex: string) => PILIHAN_CEPAT.find((w) => w.hex.toLowerCase() === hex.toLowerCase())?.name;

const MODE = [
  { nilai: "light", ikon: Sun, kunci: "modeLight" },
  { nilai: "dark", ikon: Moon, kunci: "modeDark" },
  { nilai: "system", ikon: Monitor, kunci: "modeSystem" },
] as const;

export function TampilanClient() {
  const t = useTranslations("pwa.tampilan");
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const { theme, setTheme } = useTheme();
  const [pref, setPref] = useState<UserThemePreference | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [pantoneBuka, setPantoneBuka] = useState(false);
  // `theme` dari next-themes baru terbaca di peramban; saat render server jangan
  // menandai mode mana pun supaya tidak berkedip dari "sistem" ke pilihan asli.
  const siap = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    void getUserThemePreference()
      .then(setPref)
      .catch(() => toast.error(t("loadFailed")));
  }, [t]);

  const efektif: WarnaEfektif | null = pref?.efektif ?? null;

  async function pilih(p: Pilihan) {
    if (!pref || menyimpan) return;
    const sebelum = pref.efektif;
    // Pasang dulu, simpan kemudian — warnanya berganti di bawah jari.
    const dugaan =
      p === "perusahaan"
        ? tentukanWarnaTema({ hex: DEFAULT_THEME_PRIMARY_COLOR }, pref.perusahaan)
        : ({ sumber: "pribadi", hex: p.hex.toLowerCase(), tcx: "tcx" in p ? p.tcx : null, name: p.name } as const);
    pasangWarnaEfektif(dugaan, userId, false);
    setMenyimpan(true);
    try {
      const hasil = await setUserThemePreference(
        p === "perusahaan" ? { reset: true } : "tcx" in p ? { tcx: p.tcx } : { hex: p.hex },
      );
      setPref(hasil);
      pasangWarnaEfektif(hasil.efektif, userId);
      toast.success(t("saved"));
    } catch {
      pasangWarnaEfektif(sebelum, userId);
      toast.error(t("saveFailed"));
    } finally {
      setMenyimpan(false);
    }
  }

  const aktif = (hex: string, sumber?: WarnaEfektif["sumber"]) =>
    !!efektif && efektif.hex === hex.toLowerCase() && (sumber ? efektif.sumber === sumber : efektif.sumber === "pribadi");

  const labelSumber = efektif
    ? efektif.sumber === "pribadi"
      ? t("sourceOwn")
      : efektif.sumber === "perusahaan"
        ? t("sourceCompany")
        : t("sourceDefault")
    : "";

  return (
    <div className="space-y-5 p-4 pb-10">
      <TautanKembali cadangan="/pwa" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" />
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      {/* Warna yang sedang dipakai, dan dari mana asalnya. */}
      <Card className="py-0">
        <CardContent className="flex items-center gap-4 p-4">
          <span
            aria-hidden
            className="h-14 w-14 shrink-0 rounded-2xl border shadow-sm"
            style={{ background: efektif?.hex ?? "var(--muted)" }}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold">{efektif ? (efektif.name ?? namaDariHex(efektif.hex) ?? efektif.hex) : "…"}</p>
            <p className="text-sm text-muted-foreground">{labelSumber}</p>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("modeTitle")}</h2>
        <div role="radiogroup" aria-label={t("modeTitle")} className="grid grid-cols-3 gap-2">
          {MODE.map(({ nilai, ikon: Ikon, kunci }) => {
            const dipilih = siap && theme === nilai;
            return (
              <button
                key={nilai}
                type="button"
                role="radio"
                aria-checked={dipilih}
                onClick={() => setTheme(nilai)}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-medium transition-colors",
                  dipilih ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                )}
              >
                <Ikon className="h-5 w-5" aria-hidden />
                {t(kunci)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("colourTitle")}</h2>

        {pref?.perusahaan ? (
          <button
            type="button"
            onClick={() => void pilih("perusahaan")}
            disabled={menyimpan}
            aria-pressed={aktif(pref.perusahaan.hex, "perusahaan")}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted",
              aktif(pref.perusahaan.hex, "perusahaan") && "border-primary ring-2 ring-primary/30",
            )}
          >
            <span aria-hidden className="h-10 w-10 shrink-0 rounded-full border" style={{ background: pref.perusahaan.hex }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Building2 className="h-4 w-4" aria-hidden />
                {t("companyOption")}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {pref.perusahaan.name ?? pref.perusahaan.hex}
              </span>
            </span>
            {aktif(pref.perusahaan.hex, "perusahaan") ? <Check className="h-5 w-5 text-foreground" aria-hidden /> : null}
          </button>
        ) : null}

        {/* Pilihan cepat: warna tema bawaan Elorae dan palet populer. */}
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 pt-1">
          {PILIHAN_CEPAT.map((w) => {
            const dipilih = aktif(w.hex);
            return (
              <button
                key={w.key}
                type="button"
                disabled={menyimpan}
                aria-pressed={dipilih}
                onClick={() => void pilih(w.tcx ? { tcx: w.tcx, name: w.name, hex: w.hex } : { name: w.name, hex: w.hex })}
                className="flex flex-col items-center gap-1.5 rounded-lg p-1 text-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid h-12 w-12 place-items-center rounded-full border shadow-sm transition-transform active:scale-95",
                    dipilih && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                  style={{ background: w.hex }}
                >
                  {dipilih ? <Check className="h-5 w-5 text-white drop-shadow" /> : null}
                </span>
                <span className="w-full truncate text-[11px] leading-tight text-muted-foreground">{w.name}</span>
              </button>
            );
          })}
        </div>

        <Button variant="outline" className="w-full" onClick={() => setPantoneBuka(true)} disabled={menyimpan}>
          <Search className="h-4 w-4" aria-hidden />
          {t("morePantone")}
        </Button>
      </section>

      <PantoneThemePickerDialog
        open={pantoneBuka}
        onOpenChange={setPantoneBuka}
        onSelect={(p) => void pilih({ tcx: p.tcx, name: p.name, hex: p.hex })}
      />
    </div>
  );
}
