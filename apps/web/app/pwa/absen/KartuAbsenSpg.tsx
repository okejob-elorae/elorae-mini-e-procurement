"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogIn, LogOut, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { DataKartuAbsen } from "@/lib/salesman/absensi";
import { cn } from "@/lib/utils";
import { IkonJenisIzin, nadaJenisIzin } from "./tampilan-izin";

/**
 * Kartu absen hari ini untuk SPG. SPG tidak menekan "Absen masuk": check-in
 * GPS di toko tetapnya ADALAH absen masuknya, dan check-out absen pulangnya
 * (`lib/salesman/absensi-writer.ts`). Kartu ini hanya menunjukkan hasilnya dan
 * mengarahkan ke halaman toko untuk check-in — tidak ada tombol kedua yang
 * bisa membuat absen ganda.
 */
export function KartuAbsenSpg({ data, toko }: { data: DataKartuAbsen | null; toko: { id: string; nama: string } }) {
  const t = useTranslations("pwa.absen");
  const td = dinamis(t);
  const durasi = (menit: number) => t("durasi", { jam: Math.floor(menit / 60), menit: menit % 60 });

  if (!data) return null;

  return (
    <section className="beranda-kartu space-y-3">
      <h2 className="beranda-judul">{t("kartuJudul")}</h2>

      {data.izinHariIni && !data.masuk ? (
        <p className="flex items-center gap-2 text-sm">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", nadaJenisIzin(data.izinHariIni))}>
            <IkonJenisIzin jenis={data.izinHariIni} className="h-3.5 w-3.5" />
            {td(`hariIzin.${data.izinHariIni}`)}
          </span>
        </p>
      ) : null}

      {data.masuk ? (
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <LogIn className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 tabular-nums">{t("masukJam", { jam: data.masuk.jam })}</span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                data.masuk.menitTerlambat > 0
                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                  : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
              )}
            >
              {data.masuk.menitTerlambat > 0 ? t("terlambat", { menit: data.masuk.menitTerlambat }) : t("tepatWaktu")}
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <LogOut className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 tabular-nums">
              {data.pulang ? t("pulangJam", { jam: data.pulang.jam }) : t("spg.belumCheckout")}
            </span>
            {data.lamaKerja !== null ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t("lamaKerja", { durasi: durasi(data.lamaKerja) })}</span>
            ) : null}
          </li>
        </ul>
      ) : data.aktif && !data.izinHariIni ? (
        <p className="text-sm">{t("spg.belumCheckin", { jam: data.jamMasukPaling })}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {data.aktif ? t("spg.penjelasan", { toko: toko.nama }) : t("spg.penjelasanMati")}
      </p>

      {data.aktif ? (
        <Button asChild variant="outline" className="w-full">
          <Link href={`/pwa/stores/${toko.id}`}>
            <Store className="h-4 w-4" aria-hidden />
            {t("spg.bukaToko")}
          </Link>
        </Button>
      ) : null}
    </section>
  );
}
