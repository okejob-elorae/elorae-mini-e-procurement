"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, Loader2 } from "lucide-react";
import { ambilKalenderProduksiAction } from "@/app/actions/jadwal-produksi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { dinamis } from "@/lib/i18n/dinamis";
import type { KeadaanLangkah } from "@/lib/production/jadwal";
import type { ChipKalenderProduksi, KalenderProduksiBulan } from "@/lib/production/jadwal-queries";
import type { TanggalMerah } from "@/lib/production/hari-kerja";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { bacaBulan, hariDalamMinggu, kisiBulan } from "./follow-up";

/** Warna chip per keadaan — sama artinya dengan pil di daftar. */
const WARNA_CHIP: Record<KeadaanLangkah, string> = {
  TELAT: "bg-red-500/12 text-red-700 ring-red-600/25 dark:text-red-300",
  HARI_INI: "bg-amber-500/14 text-amber-800 ring-amber-600/30 dark:text-amber-300",
  MENDATANG: "bg-sky-500/10 text-sky-800 ring-sky-600/20 dark:text-sky-300",
  SELESAI: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300",
};

const URUT_KEADAAN: KeadaanLangkah[] = ["TELAT", "HARI_INI", "MENDATANG", "SELESAI"];

/** Chip yang tampil per kotak hari sebelum "+N lagi". */
const CHIP_PER_HARI = 3;

type Keadaan = { kunci: string; data: KalenderProduksiBulan } | { kunci: string; galat: true };

/**
 * Kalender bulan Follow-up produksi: satu chip per langkah pada hari targetnya
 * (semua status). Data dari `ambilKalenderProduksiAction`, dimuat ulang saat
 * bulan, pemasok, atau `muatUlang` berubah. Hari libur mingguan dan tanggal
 * merah diberi latar redup. Di layar sempit kisinya diganti daftar hari.
 */
export function KalenderFollowUp({
  bulan,
  pemasokId,
  hariIni,
  hariKerja,
  tanggalMerah,
  muatUlang,
  onPilih,
}: {
  bulan: string;
  pemasokId: string | null;
  hariIni: string;
  hariKerja: number[];
  tanggalMerah: TanggalMerah[];
  muatUlang: number;
  onPilih: (chip: ChipKalenderProduksi, tanggal: string) => void;
}) {
  const t = useTranslations("jadwalProduksi");
  const td = dinamis(t);
  const locale = useLocale();
  const kunci = `${bulan}|${pemasokId ?? ""}|${muatUlang}`;
  const [keadaan, setKeadaan] = useState<Keadaan | null>(null);
  const [terbuka, setTerbuka] = useState<ReadonlySet<string>>(new Set());
  const [coba, setCoba] = useState(0);

  useEffect(() => {
    const b = bacaBulan(bulan);
    if (!b) return;
    let batal = false;
    ambilKalenderProduksiAction(b.tahun, b.bulan, { supplierId: pemasokId })
      .then((hasil) => {
        if (batal) return;
        setKeadaan(hasil.ok ? { kunci, data: hasil.data } : { kunci, galat: true });
      })
      .catch(() => {
        if (!batal) setKeadaan({ kunci, galat: true });
      });
    return () => {
      batal = true;
    };
  }, [bulan, pemasokId, kunci, coba]);

  const memuat = keadaan === null || keadaan.kunci !== kunci;
  // Data lama tetap tampil (redup) selama yang baru dimuat — tidak berkedip kosong.
  const data = keadaan && "data" in keadaan ? keadaan.data : null;
  const galat = !memuat && keadaan !== null && "galat" in keadaan;

  const kisi = useMemo(() => kisiBulan(bulan), [bulan]);
  const libur = useMemo(() => new Map(tanggalMerah.map((l) => [l.tanggal, l.nama])), [tanggalMerah]);
  const kerja = useMemo(() => new Set(hariKerja), [hariKerja]);
  const namaHari = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { weekday: "short", timeZone: "UTC" });
    // 28 Sep 2026 = Senin.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 8, 28 + i))));
  }, [locale]);

  const hariTidakKerja = (tanggal: string) => !kerja.has(hariDalamMinggu(tanggal)) || libur.has(tanggal);
  const chipHari = (tanggal: string): ChipKalenderProduksi[] => data?.[tanggal] ?? [];
  const jumlahPerKeadaan = useMemo(() => {
    const n: Record<KeadaanLangkah, number> = { TELAT: 0, HARI_INI: 0, MENDATANG: 0, SELESAI: 0 };
    for (const daftar of Object.values(data ?? {})) for (const c of daftar) n[c.keadaan] += 1;
    return n;
  }, [data]);
  const adaChip = Object.values(jumlahPerKeadaan).some((n) => n > 0);

  const chipEl = (c: ChipKalenderProduksi, tanggal: string) => (
    <Button
      key={c.stepId}
      type="button"
      variant="ghost"
      onClick={() => onPilih(c, tanggal)}
      title={`${c.tahapName} — ${c.name}`}
      className={cn(
        "h-auto w-full justify-start gap-1 rounded px-1.5 py-0.5 text-left text-xs font-normal ring-1 ring-inset hover:opacity-80",
        WARNA_CHIP[c.keadaan],
        c.keadaan === "SELESAI" && "line-through decoration-1",
      )}
    >
      <span className="shrink-0 font-semibold">{c.kodeKategori}</span>
      <span className="min-w-0 truncate">{c.name}</span>
    </Button>
  );

  if (galat) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={CalendarDays}
            title={t("followUp.kalender.gagal")}
            action={
              <Button variant="outline" onClick={() => setCoba((n) => n + 1)}>
                {t("followUp.kalender.coba")}
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-4">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          {memuat ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("followUp.kalender.memuat")}
            </span>
          ) : (
            URUT_KEADAAN.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-sm ring-1 ring-inset", WARNA_CHIP[k])} aria-hidden />
                {t("followUp.kalender.legenda", { label: td(`followUp.kalender.keadaan.${k}`), n: jumlahPerKeadaan[k] })}
              </span>
            ))
          )}
        </div>

        {/* Layar lebar: kisi bulan, minggu dimulai Senin. */}
        <div className={cn("hidden md:block", memuat && "opacity-60")}>
          <div className="grid grid-cols-7 border-l border-t text-xs">
            {namaHari.map((h) => (
              <div key={h} className="border-b border-r bg-muted/40 px-2 py-1.5 font-medium text-muted-foreground">
                {h}
              </div>
            ))}
            {kisi.flat().map((h) => {
              const chip = chipHari(h.tanggal);
              const buka = terbuka.has(h.tanggal);
              const tampil = buka ? chip : chip.slice(0, CHIP_PER_HARI);
              const adaLibur = libur.has(h.tanggal);
              const namaLibur = libur.get(h.tanggal) || t("followUp.kalender.libur");
              return (
                <div
                  key={h.tanggal}
                  className={cn(
                    "min-h-28 space-y-1 border-b border-r p-1.5",
                    hariTidakKerja(h.tanggal) && "bg-muted/40",
                    !h.diBulan && "opacity-50",
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums",
                        h.tanggal === hariIni && "bg-primary text-primary-foreground",
                        h.tanggal !== hariIni && adaLibur && "text-red-600 dark:text-red-400",
                      )}
                      aria-label={labelTanggal(h.tanggal, locale)}
                    >
                      {Number(h.tanggal.slice(8))}
                    </span>
                    {adaLibur ? (
                      <span className="min-w-0 truncate text-[11px] text-red-600 dark:text-red-400" title={namaLibur}>
                        {namaLibur}
                      </span>
                    ) : null}
                  </div>
                  {tampil.map((c) => chipEl(c, h.tanggal))}
                  {chip.length > CHIP_PER_HARI ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="h-auto px-1.5 py-0.5 text-muted-foreground"
                      onClick={() =>
                        setTerbuka((lama) => {
                          const baru = new Set(lama);
                          if (buka) baru.delete(h.tanggal);
                          else baru.add(h.tanggal);
                          return baru;
                        })
                      }
                    >
                      {buka ? t("followUp.kalender.ringkas") : t("followUp.kalender.lagi", { n: chip.length - CHIP_PER_HARI })}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Layar sempit: daftar hari yang punya langkah. */}
        <div className={cn("space-y-3 md:hidden", memuat && "opacity-60")}>
          {kisi
            .flat()
            .filter((h) => h.diBulan && chipHari(h.tanggal).length > 0)
            .map((h) => (
              <div key={h.tanggal} className="space-y-1.5">
                <p className={cn("text-sm font-medium", h.tanggal === hariIni && "text-tautan")}>
                  {labelTanggal(h.tanggal, locale)}
                  {libur.has(h.tanggal) ? (
                    <span className="ml-2 text-xs font-normal text-red-600 dark:text-red-400">
                      {libur.get(h.tanggal) || t("followUp.kalender.libur")}
                    </span>
                  ) : null}
                </p>
                <div className="space-y-1">
                  {chipHari(h.tanggal).map((c) => chipEl(c, h.tanggal))}
                </div>
              </div>
            ))}
        </div>

        {!memuat && !adaChip ? (
          <EmptyState icon={CalendarDays} title={t("followUp.kalender.kosong")} className="py-6" />
        ) : null}
      </CardContent>
    </Card>
  );
}
