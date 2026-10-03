"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, TrendingUp } from "lucide-react";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatPersen, type DasarKomisi } from "@/lib/salesman/komisi";

export type DataInsentifBeranda = {
  komisi: number;
  dasar: DasarKomisi;
  dasarNilai: number;
  tarifDipakai: number;
  tingkatBerikut: { tarifPersen: number; kurangNilai: number } | null;
};

/**
 * Kartu kecil di beranda salesman: perkiraan komisi bulan ini dan jarak ke
 * tarif berikutnya. Satu ketukan membuka rinciannya di `/pwa/insentif`.
 * Tidak dirender sama sekali saat kantor mematikan komisi (data `null`).
 */
export function KartuInsentifBeranda({ data }: { data: DataInsentifBeranda }) {
  const t = useTranslations("pwa.insentif");
  const tDinamis = dinamis(t);
  const locale = useLocale();

  return (
    <Link href="/pwa/insentif" className="beranda-kartu block transition-colors hover:bg-muted/40">
      <div className="flex items-center justify-between gap-2">
        <h2 className="beranda-judul">{t("homeTitle")}</h2>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{formatIDR(data.komisi)}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {tDinamis(`homeFormula${data.dasar}`, { rate: formatPersen(data.tarifDipakai, locale), amount: formatIDR(data.dasarNilai) })}
      </p>
      {data.tingkatBerikut ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium tabular-nums">
          <TrendingUp className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {t("nudge", {
            amount: formatIDR(data.tingkatBerikut.kurangNilai),
            rate: formatPersen(data.tingkatBerikut.tarifPersen, locale),
          })}
        </p>
      ) : null}
    </Link>
  );
}
