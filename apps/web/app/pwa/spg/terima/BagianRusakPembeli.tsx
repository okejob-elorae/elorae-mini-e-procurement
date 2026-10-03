"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PackageX, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { KondisiRusak } from "@/lib/spg/gudang-rusak";

/** Barang rusak dari pembeli di konter yang belum dikirim balik — tanpa harga. */
export type RusakPembeliRingkas = {
  /** Id baris retur pembeli. */
  id: string;
  productName: string;
  variantSku: string;
  kondisi: KondisiRusak;
  sisa: number;
  docNo: string;
  /** Sudah diformat di server (WIB). */
  tanggalLabel: string;
  alasan: string;
  /** Nota retur yang sudah membawa sebagiannya. */
  notaRetur: string[];
};

/**
 * Barang yang dikembalikan pembeli dalam keadaan rusak/kedaluwarsa tidak
 * kembali ke rak; ia dikirim balik ke gudang barang rusak lewat nota retur
 * toko yang barisnya menunjuk retur pembeli (tanpa mengurangi buku toko lagi).
 */
export function BagianRusakPembeli({ rusak }: { rusak: RusakPembeliRingkas[] }) {
  const t = useTranslations("gudangRusak");
  const td = dinamis(t);
  if (rusak.length === 0) return null;
  const alamat = (ids: string[]) => `/pwa/retur/baru?dariReturPembeli=${ids.map((id) => encodeURIComponent(id)).join(",")}`;
  return (
    <section className="space-y-2" aria-labelledby="judul-rusak-pembeli">
      <h2 id="judul-rusak-pembeli" className="beranda-judul px-1">
        {t("hp.judul", { count: rusak.length })}
      </h2>
      <div className="beranda-kartu beranda-kartu-daftar">
        <ul className="divide-y">
          {rusak.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <PackageX className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium leading-tight">{r.productName}</p>
                  {r.variantSku ? <p className="truncate text-xs text-muted-foreground">{r.variantSku}</p> : null}
                  <p className="text-xs text-muted-foreground">{t("hp.dariNota", { doc: r.docNo, tanggal: r.tanggalLabel })}</p>
                  <p className="text-sm font-semibold">{t("hp.potong", { n: r.sisa, kondisi: td(`kondisi.${r.kondisi}`) })}</p>
                  <p className="text-xs text-muted-foreground">{t("hp.alasan", { alasan: r.alasan })}</p>
                  {r.notaRetur.length > 0 ? <p className="text-xs text-muted-foreground">{t("hp.sebagian", { nota: r.notaRetur.join(", ") })}</p> : null}
                </div>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link href={alamat([r.id])}>
                  <Undo2 className="h-4 w-4" aria-hidden />
                  {t("hp.kirimBalik", { n: r.sisa })}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
      {rusak.length > 1 ? (
        <Button asChild className="w-full">
          <Link href={alamat(rusak.map((r) => r.id))}>
            <Undo2 className="h-4 w-4" aria-hidden />
            {t("hp.kirimBalikSemua", { count: rusak.length })}
          </Link>
        </Button>
      ) : null}
      <p className="px-1 text-xs text-muted-foreground">{t("hp.petunjuk")}</p>
    </section>
  );
}
