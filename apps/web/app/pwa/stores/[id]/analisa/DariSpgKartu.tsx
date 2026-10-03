"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Inbox, Lightbulb, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DariSpg } from "@/lib/salesman/penyerapan-queries";

/**
 * "Dari SPG": yang dilaporkan SPG toko ini — barang yang dicari pembeli tapi
 * tidak ada (teratas dalam periode analisa) dan permintaan barangnya yang
 * masih terbuka. Penjualan SPG sendiri sudah masuk ke penyerapan di atas,
 * langsung dari buku stok tokonya.
 */
export function DariSpgKartu({ data, storeId, periode }: { data: DariSpg; storeId: string; periode: number }) {
  const t = useTranslations("pwaPenyerapan.dariSpg");
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 0 });

  if (!data.adaSpg && data.dicari.length === 0 && data.permintaanTerbuka === 0) {
    return (
      <section className="beranda-kartu space-y-1" aria-labelledby="dari-spg-judul">
        <h2 id="dari-spg-judul" className="beranda-judul">
          {t("judul")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("tanpaSpg")}</p>
      </section>
    );
  }

  return (
    <section className="beranda-kartu space-y-3" aria-labelledby="dari-spg-judul">
      <h2 id="dari-spg-judul" className="beranda-judul">
        {t("judul")}
      </h2>

      <div className="space-y-1.5">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Search className="h-3.5 w-3.5" aria-hidden />
          {t("dicariJudul", { n: periode })}
        </h3>
        {data.dicari.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dicariKosong")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.dicari.map((x) => (
              <li key={x.kunci} className="py-2">
                <p className="font-medium leading-tight">
                  {x.nama}
                  {x.varian ? <span className="font-normal text-muted-foreground"> · {x.varian}</span> : null}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {t("dicariBaris", { pcs: angka.format(x.qty), kali: x.kali, tanggal: x.terakhir })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="flex items-center gap-1.5 text-sm">
          <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden />
          {data.permintaanTerbuka > 0 ? t("permintaanAda", { n: data.permintaanTerbuka }) : t("permintaanKosong")}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href={`/pwa/permintaan?toko=${encodeURIComponent(storeId)}`}>
            {t("lihatPermintaan")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}

/** Ajakan membuat rekomendasi dari analisa toko — atau penjelasan kenapa tidak bisa. */
export function RekomendasiKartu({ storeId, periode, boleh }: { storeId: string; periode: number; boleh: boolean }) {
  const t = useTranslations("pwaPenyerapan.rekomendasi");
  return (
    <section className="beranda-kartu space-y-2" aria-labelledby="rekomendasi-judul">
      <h2 id="rekomendasi-judul" className="beranda-judul flex items-center gap-1.5">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        {t("judul")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("isi")}</p>
      {boleh ? (
        <Button asChild className="w-full">
          <Link href={`/pwa/stores/${storeId}/analisa/rekomendasi?periode=${periode}`}>{t("buat")}</Link>
        </Button>
      ) : (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t("bukanPemegang")}</p>
      )}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/pwa/rekomendasi">
          {t("saya")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
    </section>
  );
}
