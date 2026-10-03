"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CloudOff, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";

export type RingkasanNotaLuring = {
  baris: { kunci: string; nama: string; qty: number }[];
  total: number;
  potongan: number;
  namaPembeli: string | null;
};

/**
 * Layar sesudah nota disimpan di HP karena tidak ada sinyal. Jujur soal apa
 * yang sudah dan belum terjadi: barangnya tercatat DI HP INI, nomor nota belum
 * ada, dan totalnya perkiraan — harga dan promo dihitung ulang server saat
 * notanya terkirim sendiri begitu ada sinyal.
 */
export function NotaTersimpanLuring({
  ringkasan,
  jumlahTertahan,
  onJualLagi,
}: {
  ringkasan: RingkasanNotaLuring;
  /** Semua nota toko ini yang masih menunggu sinyal, termasuk yang ini. */
  jumlahTertahan: number;
  onJualLagi: () => void;
}) {
  const t = useTranslations("pwa.spgJual.luring");
  const jumlahBarang = ringkasan.baris.reduce((n, b) => n + b.qty, 0);
  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <section className="beranda-kartu space-y-3 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
          <CloudOff className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-xl font-bold">{t("savedTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("savedBody")}</p>
      </section>

      <section className="beranda-kartu space-y-3">
        <h2 className="beranda-judul">{t("itemsTitle", { count: jumlahBarang })}</h2>
        <ul className="space-y-1.5">
          {ringkasan.baris.map((b) => (
            <li key={b.kunci} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 break-words">{b.nama}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">× {b.qty}</span>
            </li>
          ))}
        </ul>
        {ringkasan.namaPembeli ? <p className="text-sm text-muted-foreground">{t("buyer", { name: ringkasan.namaPembeli })}</p> : null}
        <div className="space-y-1 border-t pt-3">
          {ringkasan.potongan > 0 ? (
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t("discount")}</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">−{formatIDR(ringkasan.potongan)}</span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">{t("estimatedTotal")}</span>
            <span className="shrink-0 whitespace-nowrap text-lg font-bold tabular-nums">{formatIDR(ringkasan.total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t("estimateNote")}</p>
        </div>
      </section>

      <div className="mt-auto space-y-2">
        <Button type="button" size="lg" className="w-full" onClick={onJualLagi}>
          <ShoppingCart className="h-4 w-4" aria-hidden />
          {t("sellAgain")}
        </Button>
        <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2">
          <Link href="/pwa/spg/antrean">{t("seeQueue", { count: jumlahTertahan })}</Link>
        </Button>
      </div>
    </div>
  );
}
