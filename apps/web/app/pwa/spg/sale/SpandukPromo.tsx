"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Tag } from "lucide-react";
import { ringkasPromoKonter, type PromoKonter } from "@/lib/spg/promo-konter";

/** Promo yang ditampilkan langsung; sisanya dihitung dan dibuka lewat "Lihat semua promo". */
const TAMPIL = 3;

/**
 * Promo konter yang SEDANG berlaku di toko ini, di atas layar jual — supaya SPG
 * bisa menawarkannya ke pembeli sebelum keranjang terisi. Daftarnya dari mesin
 * promo yang sama dengan hitungan nota (`berlaku`), teksnya dari
 * `ringkasPromoKonter` (selalu bahasa Indonesia, sama dengan nota dan kantor).
 */
export function SpandukPromo({ berlaku, promos }: { berlaku: { id: string; name: string }[]; promos: PromoKonter[] }) {
  const t = useTranslations("pwa.spgJual.promo");
  if (berlaku.length === 0) return null;
  const perId = new Map(promos.map((p) => [p.id, p]));
  const tampil = berlaku.slice(0, TAMPIL);
  const sisa = berlaku.length - tampil.length;
  return (
    <section className="beranda-kartu space-y-2" aria-labelledby="spg-jual-promo">
      <h2 id="spg-jual-promo" className="flex items-center gap-2 text-sm font-semibold">
        <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t("bannerTitle", { count: berlaku.length })}
      </h2>
      <ul className="space-y-1.5">
        {tampil.map((b) => {
          const p = perId.get(b.id);
          return (
            <li key={b.id} className="text-sm leading-snug">
              <span className="font-medium">{b.name}</span>
              {p ? <span className="text-muted-foreground"> · {ringkasPromoKonter(p)}</span> : null}
            </li>
          );
        })}
      </ul>
      {sisa > 0 ? <p className="text-xs text-muted-foreground">{t("bannerMore", { count: sisa })}</p> : null}
      {/* Warna teks biasa + garis bawah, bukan `text-primary`: limau di atas krem nyaris tak terbaca di tema terang. */}
      <Link href="/pwa/spg/promo" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4">
        {t("seeAll")}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}
