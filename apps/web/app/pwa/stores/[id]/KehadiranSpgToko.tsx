"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { KeadaanHadir, KehadiranSpgTampil } from "@/lib/spg/kehadiran-toko";

const TITIK: Record<KeadaanHadir, string> = {
  DI_TOKO: "bg-emerald-500",
  PULANG: "bg-muted-foreground/40",
  IZIN: "bg-sky-500",
  LIBUR: "bg-muted-foreground/40",
  BUKAN_HARI_KERJA: "bg-muted-foreground/40",
  BELUM: "bg-amber-500",
};

/**
 * SPG toko ini hari ini (WIB), untuk salesman: sudah datang pukul berapa,
 * sudah pulang, izin, libur menurut jadwal, bukan hari kerja SPG, atau belum datang. Jam sudah
 * diformat di server. Tanpa rupiah. Toko tanpa SPG → tidak tampil.
 */
export function KehadiranSpgToko({ baris }: { baris: KehadiranSpgTampil[] }) {
  const t = useTranslations("pwa.kehadiranSpg");
  if (baris.length === 0) return null;

  const keterangan = (b: KehadiranSpgTampil): string => {
    switch (b.keadaan) {
      case "DI_TOKO":
        return t("diToko", { jam: b.masuk ?? "" });
      case "PULANG":
        return t("pulang", { pulang: b.pulang ?? "", masuk: b.masuk ?? "" });
      case "IZIN":
        return t(`izin.${b.jenisIzin ?? "IZIN"}`);
      case "LIBUR":
        return t("libur");
      case "BUKAN_HARI_KERJA":
        return t("bukanHariKerja");
      default:
        return b.jadwalMulai ? t("belumJadwal", { jam: b.jadwalMulai }) : t("belum");
    }
  };

  return (
    <section className="beranda-kartu space-y-2" aria-labelledby="kehadiran-spg-judul">
      <h2 id="kehadiran-spg-judul" className="beranda-judul">
        {t("judul")}
      </h2>
      <ul className="divide-y">
        {baris.map((b) => (
          <li key={b.userId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", TITIK[b.keadaan])} aria-hidden />
            <div className="min-w-0">
              <p className="break-words font-medium leading-tight">{b.nama}</p>
              <p className="text-sm text-muted-foreground">{keterangan(b)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
