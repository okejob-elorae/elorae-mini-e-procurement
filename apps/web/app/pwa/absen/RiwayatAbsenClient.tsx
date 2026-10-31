"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dinamis } from "@/lib/i18n/dinamis";
import type { DataKartuAbsen, RingkasanAbsen } from "@/lib/salesman/absensi";
import type { HariRiwayatAbsen } from "@/lib/salesman/absensi-queries";
import { JENIS_IZIN, type HitungIzin } from "@/lib/salesman/izin";
import type { IzinSaya as DataIzinSaya } from "@/lib/salesman/izin-queries";
import { cn } from "@/lib/utils";
import { KartuAbsen } from "../beranda/KartuAbsen";
import { IzinSaya } from "./IzinSaya";
import { KartuAbsenSpg } from "./KartuAbsenSpg";
import { nadaJenisIzin } from "./tampilan-izin";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

export function RiwayatAbsenClient({
  kartu,
  aktif,
  jamMasukPaling,
  bulan,
  pilihanBulan,
  hari,
  ringkasan,
  ringkasanIzin,
  izin,
  kuotaCutiTahunan,
  tokoSpg = null,
}: {
  kartu: DataKartuAbsen | null;
  aktif: boolean;
  jamMasukPaling: string;
  bulan: string;
  pilihanBulan: { kunci: string; label: string }[];
  hari: HariRiwayatAbsen[];
  ringkasan: RingkasanAbsen;
  ringkasanIzin: HitungIzin;
  izin: DataIzinSaya;
  kuotaCutiTahunan: number;
  /** SPG: absennya mengikuti check-in di toko ini — tanpa tombol absen sendiri. */
  tokoSpg?: { id: string; nama: string } | null;
}) {
  const t = useTranslations("pwa.absen");
  const td = dinamis(t);
  const router = useRouter();
  const durasi = (menit: number) => t("durasi", { jam: Math.floor(menit / 60), menit: menit % 60 });

  const angka = [
    { kunci: "hadir", nilai: ringkasan.hadir, nada: null },
    { kunci: "terlambatHari", nilai: ringkasan.terlambat, nada: ringkasan.terlambat > 0 ? "tunggu" : null },
    { kunci: "menitTerlambat", nilai: ringkasan.menitTerlambat, nada: null },
    { kunci: "tanpaPulang", nilai: ringkasan.tanpaPulang, nada: null },
  ] as const;

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="text-sm text-muted-foreground">{aktif ? t("subjudul", { jam: jamMasukPaling }) : t("nonaktif")}</p>
      </header>

      {tokoSpg ? (
        <KartuAbsenSpg data={kartu} toko={tokoSpg} />
      ) : kartu ? (
        <KartuAbsen data={kartu} tampilkanRiwayat={false} />
      ) : null}

      <IzinSaya data={izin} kuotaCutiTahunan={kuotaCutiTahunan} />

      <section className="beranda-kartu space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="beranda-judul">{t("rekapJudul")}</h2>
          <Select value={bulan} onValueChange={(v) => router.replace(`/pwa/absen?bulan=${v}`)}>
            <SelectTrigger className="w-44" aria-label={t("pilihBulan")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pilihanBulan.map((b) => (
                <SelectItem key={b.kunci} value={b.kunci}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="grid grid-cols-4 gap-2">
          {angka.map((a) => (
            <li key={a.kunci} className="min-w-0">
              <span
                className={cn(
                  "block text-xl font-semibold tabular-nums",
                  a.nada === "tunggu" && "text-amber-700 dark:text-amber-400",
                )}
              >
                {a.nilai}
              </span>
              <span className="block text-[11px] leading-tight text-muted-foreground">{t(`rekap.${a.kunci}`)}</span>
            </li>
          ))}
        </ul>
        {/* Hari KERJA yang izinnya disetujui — Minggu di tengah cuti tidak dihitung. */}
        <ul className="grid grid-cols-4 gap-2 border-t pt-3">
          {JENIS_IZIN.map((j) => (
            <li key={j} className="min-w-0">
              <span className="block text-xl font-semibold tabular-nums">{ringkasanIzin[j]}</span>
              <span className="block text-[11px] leading-tight text-muted-foreground">{td(`rekap.hari${j}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {hari.length === 0 ? (
        <section className="beranda-kartu">
          <p className="text-center text-sm text-muted-foreground">{t("kosong")}</p>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("rekapJudul")}>
          <ul className="divide-y">
            {hari.map((h) => (
              <li key={h.dayKey} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <span className={cn("w-24 shrink-0 text-sm font-medium", !h.hadir && !h.izin && "text-muted-foreground")}>
                  {h.label}
                </span>
                {h.hadir ? (
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-sm tabular-nums">
                      {h.masuk} – {h.pulang ?? t("belumPulang")}
                      {h.lamaKerja !== null ? <span className="text-muted-foreground"> · {durasi(h.lamaKerja)}</span> : null}
                    </span>
                    {h.catatan ? <span className="block truncate text-xs text-muted-foreground">{h.catatan}</span> : null}
                  </span>
                ) : h.izin ? (
                  <span className="min-w-0 flex-1">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaJenisIzin(h.izin))}>
                      {td(`hariIzin.${h.izin}`)}
                    </span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {/* Selama absensi mati, hari tanpa catatan bukan pelanggaran — jangan disebut "tidak absen". */}
                    {aktif ? t("tidakAbsen") : "—"}
                  </span>
                )}
                {h.hadir ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      h.menitTerlambat > 0
                        ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
                    )}
                  >
                    {h.menitTerlambat > 0 ? t("terlambat", { menit: h.menitTerlambat }) : t("tepatWaktu")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
