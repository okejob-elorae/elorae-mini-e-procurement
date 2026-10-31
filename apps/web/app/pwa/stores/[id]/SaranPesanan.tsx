"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { RotateCcw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDisplayDate } from "@/lib/date-only";
import { formatIDR } from "@/lib/sales-orders/format";

/**
 * "Saran pesanan" di halaman toko: kebiasaan toko ini memesan, pesanan
 * terakhirnya yang bisa diulang dengan satu ketukan, dan promo yang berlaku.
 *
 * Kebiasaannya milik TOKO (siapa pun salesman yang mencatat pesanannya). Tombol
 * ulangi hanya aktif saat salesman sedang check-in di toko ini, karena katalog
 * baru menerima pesanan setelah check-in.
 */

export type SaranPesananProps = {
  pola: { hariSejak: number | null; jedaMedian: number | null; waktunya: boolean };
  terakhir: {
    id: string;
    orderNo: string;
    tanggalIso: string;
    baris: { productName: string; variantSku: string; qty: number }[];
  } | null;
  promo: { id: string; name: string; type: "PERCENT" | "FIXED" | "TIERED"; value: number | null }[];
};

const BARIS_TAMPIL = 4;

export function SaranPesanan({
  storeId,
  saran,
  bolehPesan,
}: {
  storeId: string;
  saran: SaranPesananProps;
  bolehPesan: boolean;
}) {
  const t = useTranslations("pwa.saran");
  const locale = useLocale();
  const { pola, terakhir, promo } = saran;
  if (!terakhir && promo.length === 0) return null;

  const nilaiPromo = (p: SaranPesananProps["promo"][number]) =>
    p.type === "PERCENT" && p.value !== null
      ? `${p.value}%`
      : p.type === "FIXED" && p.value !== null
        ? t("promoFixed", { amount: formatIDR(p.value) })
        : t("promoTiered");

  return (
    <section className="beranda-kartu">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="beranda-judul">{t("title")}</h2>
        {pola.waktunya ? (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            {t("timeToOrder")}
          </span>
        ) : null}
      </div>

      {pola.jedaMedian !== null && pola.hariSejak !== null ? (
        <p className="mt-1 text-sm">{t("rhythm", { every: pola.jedaMedian, since: pola.hariSejak })}</p>
      ) : pola.hariSejak !== null ? (
        <p className="mt-1 text-sm">{t("lastOnly", { since: pola.hariSejak })}</p>
      ) : null}

      {terakhir ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            {t("lastOrder", { no: terakhir.orderNo, date: formatDisplayDate(terakhir.tanggalIso, locale) })}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {terakhir.baris.slice(0, BARIS_TAMPIL).map((b, i) => (
              <li key={`${b.productName}-${b.variantSku}-${i}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{b.productName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">× {b.qty}</span>
              </li>
            ))}
          </ul>
          {terakhir.baris.length > BARIS_TAMPIL ? (
            <p className="text-xs text-muted-foreground">{t("more", { count: terakhir.baris.length - BARIS_TAMPIL })}</p>
          ) : null}
          {terakhir.baris.length === 0 ? null : bolehPesan ? (
            <Button asChild className="mt-3 w-full">
              <Link href={`/pwa/stores/${storeId}/catalog?ulang=${terakhir.id}`}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("repeat")}
              </Link>
            </Button>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">{t("repeatNeedsCheckIn")}</p>
          )}
        </div>
      ) : null}

      {promo.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">{t("promoTitle")}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {promo.map((p) => (
              <li
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full border bg-background/60 px-2.5 py-1 text-xs"
              >
                <Tag className="h-3 w-3" aria-hidden />
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">· {nilaiPromo(p)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
