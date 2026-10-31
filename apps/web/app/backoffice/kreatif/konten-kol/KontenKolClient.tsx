"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarDays, CheckCircle2, Clapperboard, FileClock, Hourglass, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AmbangKreatif } from "@/lib/creative/ambang";
import { alamatKontenKol, CHIP_KONTEN_KOL, type ButirJadwal, type ChipKontenKol, type ParamKontenKol } from "@/lib/creative/konten-kol";
import type { HasilDaftarKontenKol } from "@/lib/creative/konten-kol-queries";
import type { ChipDaftarKontenKol } from "@/lib/creative/konten-kol";
import { cn } from "@/lib/utils";
import { DaftarDisetujui, DaftarDraf, DaftarMenunggu, DaftarTayang } from "./DaftarKontenKol";
import { JadwalTayang } from "./JadwalTayang";

const IKON: Record<ChipKontenKol, typeof Search> = {
  menunggu: Hourglass,
  draf: FileClock,
  disetujui: CheckCircle2,
  tayang: Clapperboard,
  jadwal: CalendarDays,
};

export function KontenKolClient({
  param,
  hariIni,
  ambang,
  hitungan,
  campaign,
  kolaborasiLabel,
  daftar,
  jadwal,
  bolehMengelola,
}: {
  param: ParamKontenKol;
  hariIni: string;
  ambang: AmbangKreatif;
  hitungan: Record<ChipDaftarKontenKol, number>;
  campaign: { id: string; name: string }[];
  /** Label kolaborasi saringan `?kolaborasi=` (null bila tidak disaring atau tidak ditemukan). */
  kolaborasiLabel: string | null;
  daftar: HasilDaftarKontenKol | null;
  jadwal: ButirJadwal[] | null;
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang");
  const router = useRouter();
  const [memuat, startMuat] = useTransition();
  const [cari, setCari] = useState(param.cari);

  const pergi = (ubah: Partial<ParamKontenKol>) => {
    const baru = { ...param, ...ubah };
    // Ganti chip, cari, atau campaign → kembali ke halaman 1.
    if (ubah.chip !== undefined || ubah.cari !== undefined || ubah.campaign !== undefined || ubah.kolaborasi !== undefined) {
      baru.halaman = ubah.halaman ?? 1;
    }
    startMuat(() => router.replace(alamatKontenKol(baru, hariIni), { scroll: false }));
  };

  // Pencarian ditulis ke alamat sesudah berhenti mengetik.
  const jeda = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (jeda.current) clearTimeout(jeda.current);
  }, []);
  const ketik = (v: string) => {
    setCari(v);
    if (jeda.current) clearTimeout(jeda.current);
    jeda.current = setTimeout(() => {
      if (v.trim() !== param.cari) pergi({ cari: v.trim() });
    }, 400);
  };

  const disaring = Boolean(param.cari || param.campaign || param.kolaborasi);
  const kosong = (chip: ChipDaftarKontenKol) => (
    <EmptyState
      icon={IKON[chip]}
      title={disaring ? t("kontenKol.kosong.saring") : t(`kontenKol.kosong.${chip}.judul`)}
      description={disaring ? undefined : t(`kontenKol.kosong.${chip}.isi`)}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.kontenKol")}
        meta={t("kontenKol.meta", { draf: hitungan.draf, menunggu: hitungan.menunggu, tayang: hitungan.tayang })}
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("halaman.kontenKol")}>
        {CHIP_KONTEN_KOL.map((chip) => {
          const Ikon = IKON[chip];
          const aktif = param.chip === chip;
          return (
            <Button
              key={chip}
              type="button"
              role="tab"
              aria-selected={aktif}
              variant={aktif ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => pergi({ chip })}
            >
              <Ikon className="h-3.5 w-3.5" />
              {t(`kontenKol.chip.${chip}`)}
              {chip !== "jadwal" ? (
                <Badge variant={aktif ? "secondary" : "outline"} className="ml-0.5 h-5 min-w-5 px-1.5 tabular-nums">
                  {hitungan[chip]}
                </Badge>
              ) : null}
            </Button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={cari}
            onChange={(e) => ketik(e.target.value)}
            placeholder={t("kontenKol.cari")}
            aria-label={t("kontenKol.cari")}
            className="pl-9"
          />
        </div>
        <Select value={param.campaign ?? "semua"} onValueChange={(v) => pergi({ campaign: v === "semua" ? null : v })}>
          <SelectTrigger className="w-full sm:w-[240px]" aria-label={t("kontenKol.campaign")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="semua">{t("kontenKol.semuaCampaign")}</SelectItem>
            {campaign.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {param.kolaborasi ? (
          <Badge variant="secondary" className="h-8 max-w-full gap-1.5 pl-3 pr-1 text-sm font-normal">
            <span className="truncate">{t("kontenKol.hanyaKolaborasi", { kolaborasi: kolaborasiLabel ?? param.kolaborasi })}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("kontenKol.hapusSaringan")}
              title={t("kontenKol.hapusSaringan")}
              onClick={() => pergi({ kolaborasi: null })}
            >
              <X />
            </Button>
          </Badge>
        ) : null}
      </div>

      <div className={cn("transition-opacity", memuat && "opacity-60")} aria-busy={memuat}>
        {param.chip === "jadwal" ? (
          <JadwalTayang
            bulan={param.bulan}
            hariIni={hariIni}
            butir={jadwal ?? []}
            onBulan={(bulan) => pergi({ bulan })}
          />
        ) : daftar ? (
          <Card className="py-0">
            <CardContent className={cn("px-0", daftar.baris.length === 0 && "p-0")}>
              {daftar.baris.length === 0 ? (
                kosong(daftar.chip)
              ) : daftar.chip === "menunggu" ? (
                <DaftarMenunggu baris={daftar.baris} ambang={ambang} bolehMengelola={bolehMengelola} />
              ) : daftar.chip === "draf" ? (
                <DaftarDraf baris={daftar.baris} ambang={ambang} bolehMengelola={bolehMengelola} />
              ) : daftar.chip === "disetujui" ? (
                <DaftarDisetujui baris={daftar.baris} bolehMengelola={bolehMengelola} />
              ) : (
                <DaftarTayang baris={daftar.baris} ambang={ambang} bolehMengelola={bolehMengelola} />
              )}
              {daftar.total > daftar.perHalaman ? (
                <div className="border-t px-4 pb-4">
                  <Pagination
                    page={daftar.halaman}
                    totalPages={Math.max(1, Math.ceil(daftar.total / daftar.perHalaman))}
                    onPageChange={(halaman) => pergi({ halaman })}
                    totalCount={daftar.total}
                    pageSize={daftar.perHalaman}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
