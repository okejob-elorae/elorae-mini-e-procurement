"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BadgeCheck, ChevronRight, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ringkasPromoKonter, type KomponenPaket, type PromoKonter } from "@/lib/spg/promo-konter";

/** Promo yang ditampilkan langsung; sisanya dihitung dan dibuka lewat "Lihat semua promo". */
const TAMPIL = 3;

/**
 * Promo konter yang SEDANG berlaku di toko ini, di atas layar jual — supaya SPG
 * bisa menawarkannya ke pembeli sebelum keranjang terisi. Daftarnya dari mesin
 * promo yang sama dengan hitungan nota (`berlaku`), teksnya dari
 * `ringkasPromoKonter` (selalu bahasa Indonesia, sama dengan nota dan kantor).
 *
 * Promo khusus member ikut tampil (bertanda): mesin hanya memakainya bila nota
 * punya member, tapi SPG perlu tahu supaya bisa menawarkan pendaftaran member.
 * Isi paket disebut per komponen; nama barang diambil dari `katalog` layar jual
 * dan nama kategori dari `namaKategori` bila dikirim — tanpa itu komponen
 * disebut umum ("barang tertentu", "barang kategori"), dan rinciannya ada di
 * halaman "Lihat semua promo".
 */
export function SpandukPromo({
  berlaku,
  promos,
  katalog,
  namaKategori,
}: {
  berlaku: { id: string; name: string; memberOnly?: boolean }[];
  promos: PromoKonter[];
  katalog?: readonly { itemId: string; productName: string }[];
  namaKategori?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations("pwa.spgJual.promo");
  if (berlaku.length === 0) return null;
  const perId = new Map(promos.map((p) => [p.id, p]));
  const namaBarang = new Map((katalog ?? []).map((k) => [k.itemId, k.productName]));
  const tampil = berlaku.slice(0, TAMPIL);
  const sisa = berlaku.length - tampil.length;

  const isiPaket = (komponen: readonly KomponenPaket[]) =>
    [...komponen]
      .sort((a, b) => (a.jenis === b.jenis ? 0 : a.jenis === "ITEM" ? -1 : 1))
      .map((k) => {
        if (k.jenis === "ITEM") {
          const nama = namaBarang.get(k.refId);
          return nama ? t("isiBarang", { qty: k.qty, nama }) : t("isiBarangUmum", { qty: k.qty });
        }
        const nama = namaKategori?.[k.refId];
        return nama ? t("isiKategori", { qty: k.qty, nama }) : t("isiKategoriUmum", { qty: k.qty });
      })
      .join(" + ");

  return (
    <section className="beranda-kartu space-y-2" aria-labelledby="spg-jual-promo">
      <h2 id="spg-jual-promo" className="flex items-center gap-2 text-sm font-semibold">
        <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t("bannerTitle", { count: berlaku.length })}
      </h2>
      <ul className="space-y-1.5">
        {tampil.map((b) => {
          const p = perId.get(b.id);
          const khususMember = b.memberOnly === true || p?.memberOnly === true;
          const komponen = p?.type === "PAKET" ? (p.komponen ?? []) : [];
          return (
            <li key={b.id} className="space-y-0.5 text-sm leading-snug">
              <p>
                <span className="font-medium">{b.name}</span>
                {p ? <span className="text-muted-foreground"> · {ringkasPromoKonter(p)}</span> : null}
              </p>
              {komponen.length > 0 ? <p className="text-xs text-muted-foreground">{t("isiPaket", { isi: isiPaket(komponen) })}</p> : null}
              {khususMember ? (
                <Badge variant="outline" className="whitespace-normal">
                  <BadgeCheck aria-hidden />
                  {t("khususMember")}
                </Badge>
              ) : null}
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
