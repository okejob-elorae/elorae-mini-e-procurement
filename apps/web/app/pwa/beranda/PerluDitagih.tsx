"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CircleCheck, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";
import { nomorTelepon, tautanWhatsApp } from "@/lib/salesman/dasbor";
import type { TokoTagih } from "@/lib/salesman/queries";

const TAMPIL = 3;

/**
 * Toko yang sudah lewat janji bayar, dengan pengingat WhatsApp.
 *
 * Tombol WhatsApp hanya MEMBUKA obrolan dengan pesan yang sudah terisi —
 * salesman sendiri yang membaca, mengubah, dan menekan kirim. Aplikasi tidak
 * pernah mengirim apa pun atas nama salesman. Toko yang nomornya telepon rumah
 * mendapat tombol Telepon: WhatsApp ke nomor rumah tidak pernah terbaca.
 */
export function PerluDitagih({ toko, namaSales }: { toko: TokoTagih[]; namaSales: string }) {
  const t = useTranslations("pwa.beranda");

  if (toko.length === 0) {
    return (
      <section className="beranda-kartu">
        <h2 className="beranda-judul">{t("collectTitle")}</h2>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t("collectEmpty")}
        </p>
      </section>
    );
  }

  return (
    <section className="beranda-kartu">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="beranda-judul">{t("collectTitle")}</h2>
        <span className="text-xs font-medium tabular-nums">{formatIDR(toko.reduce((n, x) => n + x.sisa, 0))}</span>
      </div>
      <ul className="mt-1 divide-y">
        {toko.slice(0, TAMPIL).map((x) => {
          const wa = tautanWhatsApp(
            x.telepon,
            t("collectMessage", {
              contact: x.kontak || t("collectContactFallback"),
              name: namaSales,
              store: x.nama,
              amount: formatIDR(x.sisa),
            }),
          );
          const tel = wa ? null : nomorTelepon(x.telepon);
          return (
            <li key={x.storeId} className="flex items-center gap-2 py-2.5">
              <Link href={`/pwa/piutang/${x.storeId}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{x.nama}</span>
                <span className="block text-xs font-medium tabular-nums text-destructive">{formatIDR(x.sisa)}</span>
              </Link>
              {wa ? (
                <Button asChild className="shrink-0">
                  <a href={wa} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    {t("collectWhatsApp")}
                  </a>
                </Button>
              ) : tel ? (
                <Button asChild variant="outline" className="shrink-0">
                  <a href={`tel:${tel}`}>
                    <Phone className="h-4 w-4" aria-hidden />
                    {t("collectCall")}
                  </a>
                </Button>
              ) : (
                <span className="max-w-[9rem] shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
                  {t("collectNoPhone")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {toko.length > TAMPIL ? (
        <Link
          href="/pwa/piutang"
          className="mt-1 inline-flex min-h-11 items-center text-sm font-medium underline decoration-primary decoration-2 underline-offset-4"
        >
          {t("collectDetail")} ({toko.length})
        </Link>
      ) : null}
    </section>
  );
}
