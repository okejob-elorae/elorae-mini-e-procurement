"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";

type Props =
  /** Laporan berperiode: `dari` null = sejak awal. */
  | { jenis: "rentang"; dari: string | null; sampai: string }
  /** Neraca: posisi per satu tanggal. */
  | { jenis: "per"; tanggal: string };

/**
 * Periode yang benar-benar dipakai laporan, selalu tertulis — juga saat isian
 * tanggalnya kosong (sejak awal / sampai hari ini), sama dengan versi cetak.
 */
export function LabelPeriode(props: Props) {
  const t = useTranslations("financeReports.periode");
  const locale = useLocale();
  const tgl = (v: string) => formatDisplayDate(parseDateOnly(v), locale);

  const teks =
    props.jenis === "per"
      ? t("asOf", { tanggal: tgl(props.tanggal) })
      : props.dari
        ? t("range", { dari: tgl(props.dari), sampai: tgl(props.sampai) })
        : t("sinceStart", { sampai: tgl(props.sampai) });

  return <p className="text-sm text-muted-foreground">{teks}</p>;
}
