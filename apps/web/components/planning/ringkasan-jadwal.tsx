"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import type { KeadaanLangkah, RingkasanJadwal } from "@/lib/production/jadwal";
import { cn } from "@/lib/utils";

/*
 * Ringkasan jadwal proses satu tahap — dipakai baris tahap (Isi Grid / Rincian
 * Plan) dan tab Kalender. Tanggal datang sebagai "YYYY-MM-DD" (hari WIB).
 */

export function tanggalJadwal(teks: string | null | undefined, locale: string): string {
  return teks ? formatDisplayDate(parseDateOnly(teks), locale) : "—";
}

const WARNA_KEADAAN: Record<KeadaanLangkah, string> = {
  SELESAI: "text-muted-foreground",
  TELAT: "text-red-700 dark:text-red-400",
  HARI_INI: "text-amber-700 dark:text-amber-400",
  MENDATANG: "text-muted-foreground",
};

/** Lencana ringkas: "3/7 selesai" (+ "1 telat"), atau "Belum dijadwalkan". */
export function LencanaJadwal({ ringkasan, className }: { ringkasan: RingkasanJadwal; className?: string }) {
  const t = useTranslations("jadwalProduksi.plan.jadwal");
  if (ringkasan.jumlah === 0) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        {t("belum")}
      </Badge>
    );
  }
  const semuaSelesai = ringkasan.selesai === ringkasan.jumlah;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <Badge variant={semuaSelesai ? "default" : "secondary"}>
        {semuaSelesai
          ? t("semuaSelesai")
          : t("selesaiDari", { selesai: ringkasan.selesai, jumlah: ringkasan.jumlah })}
      </Badge>
      {ringkasan.telat > 0 && <Badge variant="destructive">{t("terlambat", { n: ringkasan.telat })}</Badge>}
    </span>
  );
}

/** Ringkasan lengkap untuk tabel: lencana + langkah berikutnya + perkiraan selesai. */
export function RincianJadwal({ ringkasan }: { ringkasan: RingkasanJadwal }) {
  const t = useTranslations("jadwalProduksi.plan.jadwal");
  const locale = useLocale();
  return (
    <div className="space-y-1">
      <LencanaJadwal ringkasan={ringkasan} />
      {ringkasan.berikutnya && (
        <p className={cn("text-xs", WARNA_KEADAAN[ringkasan.berikutnya.keadaan])}>
          {t("berikutnya", {
            nama: ringkasan.berikutnya.name,
            tanggal: tanggalJadwal(ringkasan.berikutnya.targetDate, locale),
          })}
        </p>
      )}
      {ringkasan.selesaiPada && ringkasan.selesai < ringkasan.jumlah && (
        <p className="text-xs text-muted-foreground">
          {t("perkiraanSelesai", { tanggal: tanggalJadwal(ringkasan.selesaiPada, locale) })}
        </p>
      )}
    </div>
  );
}
