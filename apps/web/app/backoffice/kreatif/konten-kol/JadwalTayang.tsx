"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  BUTIR_PER_HARI,
  geserBulanKonten,
  hariPadat,
  kelompokJadwal,
  kisiBulanKonten,
  type ButirJadwal,
} from "@/lib/creative/konten-kol";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";

/** Warna butir: hijau = sudah tayang, aksen = rencana. */
const WARNA: Record<ButirJadwal["jenis"], string> = {
  TAYANG: "bg-emerald-500/12 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300",
  RENCANA: "bg-primary/12 text-tautan ring-primary/30",
};
const PADAT = "bg-amber-500/10";

/**
 * Jadwal tayang — kalender bulan, Senin di depan, hari WIB. Sel dengan lima
 * konten atau lebih diberi latar kuning (hari padat). Klik butir membuka
 * kolaborasinya. Di layar sempit kisinya diganti daftar hari.
 */
export function JadwalTayang({
  bulan,
  hariIni,
  butir,
  onBulan,
}: {
  bulan: string;
  hariIni: string;
  butir: ButirJadwal[];
  onBulan: (bulan: string) => void;
}) {
  const t = useTranslations("kreatifRuang.kontenKol.jadwal");
  const locale = useLocale();
  const [terbuka, setTerbuka] = useState<ReadonlySet<string>>(new Set());
  const kisi = useMemo(() => kisiBulanKonten(bulan), [bulan]);
  const perHari = useMemo(() => kelompokJadwal(butir), [butir]);
  const lokal = locale.startsWith("en") ? "en-GB" : "id-ID";
  const namaBulan = useMemo(() => {
    const [th, bl] = bulan.split("-").map(Number);
    return new Intl.DateTimeFormat(lokal, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(th, bl - 1, 15)));
  }, [bulan, lokal]);
  const namaHari = useMemo(() => {
    const f = new Intl.DateTimeFormat(lokal, { weekday: "short", timeZone: "UTC" });
    // 28 Sep 2026 = Senin.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 8, 28 + i))));
  }, [lokal]);
  const jumlah = { TAYANG: butir.filter((b) => b.jenis === "TAYANG").length, RENCANA: butir.filter((b) => b.jenis === "RENCANA").length };

  const butirEl = (b: ButirJadwal) => (
    <Link
      key={`${b.jenis}-${b.id}`}
      href={`/backoffice/kreatif/kolaborasi/${b.kolaborasiId}`}
      title={`${b.label} — ${t(b.jenis === "TAYANG" ? "tayang" : "rencana")}`}
      className={cn("block truncate rounded px-1.5 py-0.5 text-xs ring-1 ring-inset hover:opacity-80", WARNA[b.jenis])}
    >
      {b.label}
    </Link>
  );

  return (
    <Card className="gap-4">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={() => onBulan(geserBulanKonten(bulan, -1))} aria-label={t("sebelum")} title={t("sebelum")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-40 text-center text-sm font-semibold capitalize">{namaBulan}</p>
            <Button variant="outline" size="icon-sm" onClick={() => onBulan(geserBulanKonten(bulan, 1))} aria-label={t("berikut")} title={t("berikut")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {bulan !== hariIni.slice(0, 7) ? (
              <Button variant="ghost" size="sm" onClick={() => onBulan(hariIni.slice(0, 7))}>
                {t("bulanIni")}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm ring-1 ring-inset", WARNA.TAYANG)} aria-hidden />
              {t("legendaTayang", { n: jumlah.TAYANG })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm ring-1 ring-inset", WARNA.RENCANA)} aria-hidden />
              {t("legendaRencana", { n: jumlah.RENCANA })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-amber-600/30", PADAT)} aria-hidden />
              {t("legendaPadat")}
            </span>
          </div>
        </div>

        {/* Layar lebar: kisi bulan. */}
        <div className="hidden md:block">
          <div className="grid grid-cols-7 border-l border-t text-xs">
            {namaHari.map((h) => (
              <div key={h} className="border-b border-r bg-muted/40 px-2 py-1.5 font-medium text-muted-foreground">
                {h}
              </div>
            ))}
            {kisi.flat().map((h) => {
              const isi = perHari.get(h.tanggal) ?? [];
              const buka = terbuka.has(h.tanggal);
              const tampil = buka ? isi : isi.slice(0, BUTIR_PER_HARI);
              const padat = hariPadat(isi.length);
              return (
                <div key={h.tanggal} className={cn("min-h-28 space-y-1 border-b border-r p-1.5", padat && PADAT, !h.diBulan && "opacity-50")}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums",
                        h.tanggal === hariIni && "bg-primary text-primary-foreground",
                      )}
                      aria-label={labelTanggal(h.tanggal, locale)}
                    >
                      {Number(h.tanggal.slice(8))}
                    </span>
                    {padat ? <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{t("kali", { n: isi.length })}</span> : null}
                  </div>
                  {tampil.map(butirEl)}
                  {isi.length > BUTIR_PER_HARI ? (
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
                      {buka ? t("ringkas") : t("lagi", { n: isi.length - BUTIR_PER_HARI })}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Layar sempit: daftar hari yang berisi. */}
        <div className="space-y-3 md:hidden">
          {kisi
            .flat()
            .filter((h) => h.diBulan && (perHari.get(h.tanggal)?.length ?? 0) > 0)
            .map((h) => {
              const isi = perHari.get(h.tanggal) ?? [];
              return (
                <div key={h.tanggal} className={cn("space-y-1.5 rounded-md p-2", hariPadat(isi.length) && PADAT)}>
                  <p className={cn("text-sm font-medium", h.tanggal === hariIni && "text-tautan")}>
                    {labelTanggal(h.tanggal, locale)}
                    {hariPadat(isi.length) ? <span className="ml-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{t("kali", { n: isi.length })}</span> : null}
                  </p>
                  <div className="space-y-1">{isi.map(butirEl)}</div>
                </div>
              );
            })}
        </div>

        {butir.length === 0 ? <EmptyState icon={CalendarDays} title={t("kosong")} className="py-6" /> : null}
      </CardContent>
    </Card>
  );
}
