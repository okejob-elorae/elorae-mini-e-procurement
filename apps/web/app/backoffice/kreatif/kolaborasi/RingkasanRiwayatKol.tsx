"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { History, Loader2 } from "lucide-react";
import { riwayatKolAction } from "@/app/actions/kreatif-kolaborasi";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { nadaRiwayat } from "@/lib/creative/kolaborasi-tampil";
import type { RiwayatKol } from "@/lib/creative/kolaborasi-queries";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { cn } from "@/lib/utils";

/**
 * Ringkasan riwayat KOL tepat saat memutuskan mengajaknya lagi: berapa kali
 * kerja sama, views, GMV, ROAS, fee terakhir, dan berapa kali ghosting atau
 * menolak (merah). Biru bila ROAS ≥ 1, kuning bila kurang.
 */
export function RingkasanRiwayatKol({ kolId }: { kolId: string }) {
  const t = useTranslations("kreatifRuang.kolaborasi.riwayat");
  const locale = useLocale();
  const [data, setData] = useState<{ kolId: string; riwayat: RiwayatKol | null } | null>(null);

  useEffect(() => {
    let batal = false;
    riwayatKolAction(kolId)
      .then((r) => {
        if (!batal) setData({ kolId, riwayat: r.ok ? r.riwayat : null });
      })
      .catch(() => {
        if (!batal) setData({ kolId, riwayat: null });
      });
    return () => {
      batal = true;
    };
  }, [kolId]);

  if (!data || data.kolId !== kolId) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t("memuat")}
      </p>
    );
  }
  const r = data.riwayat;
  if (!r) return null;
  const tanggal = (s: string) => formatDisplayDate(parseDateOnly(s), locale);
  const rate = r.kol.rateCard ? t("rateCard", { nilai: rupiahTeks(r.kol.rateCard) }) : null;

  if (r.jumlahKolaborasi === 0) {
    return (
      <div className="rounded-md border border-sky-600/25 bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-200">
        <p className="flex items-center gap-1.5">
          <History className="h-4 w-4 shrink-0" aria-hidden />
          {t("baru")}
        </p>
        {rate ? <p className="mt-0.5 text-xs">{rate}</p> : null}
      </div>
    );
  }

  const baik = nadaRiwayat(r.roas) === "baik";
  const buruk = r.ghosting + r.ditolak;
  return (
    <div
      className={cn(
        "space-y-0.5 rounded-md border px-3 py-2 text-sm",
        baik
          ? "border-sky-600/25 bg-sky-500/10 text-sky-900 dark:text-sky-200"
          : "border-amber-600/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
      )}
    >
      <p className="flex flex-wrap items-center gap-x-1.5">
        <History className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          {t("ringkas", {
            n: r.jumlahKolaborasi,
            views: angkaTitik(r.views),
            konten: r.jumlahKonten,
            gmv: rupiahTeks(r.gmv),
          })}
        </span>
        <span className="font-medium">·</span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            r.roas !== null && r.roas >= 1 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
          )}
        >
          {r.roas === null ? t("roasKosong") : t("roas", { roas: r.roas.toLocaleString(locale === "en" ? "en-GB" : "id-ID") })}
        </span>
      </p>
      <p className="text-xs">
        {[
          r.feeTerakhir ? t("feeTerakhir", { fee: rupiahTeks(r.feeTerakhir.fee), tanggal: tanggal(r.feeTerakhir.tanggal) }) : null,
          r.terakhir ? t("terakhir", { tanggal: tanggal(r.terakhir) }) : null,
          rate,
        ]
          .filter(Boolean)
          .join(" · ")}
        {buruk > 0 ? (
          <span className="font-semibold text-red-700 dark:text-red-400">
            {" · "}
            {t("buruk", { n: buruk })}
          </span>
        ) : null}
      </p>
    </div>
  );
}
