"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format/rupiah";
import type { HargaJubelioBarang } from "@/lib/jubelio/harga/queries";

export type HargaJubelioTampil = HargaJubelioBarang & {
  dikonfirmasiPadaTampil: string | null;
  kirimanTerakhirTampil: string | null;
};

/**
 * "Harga di Jubelio" di halaman barang (keputusan pemilik 2026-11-02): harga yang terakhir
 * dikonfirmasi untuk Jubelio, siapa yang mengonfirmasi, dan apakah ada harga baru yang masih
 * menunggu. Hanya dibaca; tautan ke daftar konfirmasi hanya untuk pemegang izinnya. Penjelasan
 * ada di Bantuan, bukan di layar.
 */
export function KartuHargaJubelio({
  data,
  sku,
  bolehKonfirmasiHarga,
}: {
  data: HargaJubelioTampil;
  sku: string;
  bolehKonfirmasiHarga: boolean;
}) {
  const t = useTranslations("itemDetail.hargaJubelio");
  const rp = (nilai: string | null) => (nilai == null ? "—" : formatRupiah(nilai));

  let utama: string;
  switch (data.keadaan) {
    case "SAMA":
      utama = t("sama", { harga: rp(data.hargaJubelio) });
      break;
    case "MENUNGGU_UBAH":
      utama = t("menungguUbah", { baru: rp(data.hargaErp), lama: rp(data.hargaJubelio) });
      break;
    case "MENUNGGU_BARU":
      utama = t("menungguBaru");
      break;
    case "TANPA_HARGA":
      utama = t("tanpaHarga");
      break;
    default:
      utama = t("belumDiJubelio");
  }

  const menunggu = data.keadaan === "MENUNGGU_UBAH" || data.keadaan === "MENUNGGU_BARU";
  const sudahDiJubelio = data.keadaan === "SAMA" || data.keadaan === "MENUNGGU_UBAH" || data.keadaan === "TANPA_HARGA";
  const gagal = data.kirimanTerakhir && (data.kirimanTerakhir.status === "DEAD" || data.kirimanTerakhir.status === "SKIPPED");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="h-4 w-4" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className={menunggu ? "font-medium" : undefined}>{utama}</p>
        {sudahDiJubelio && data.dikonfirmasiPada ? (
          <p className="text-muted-foreground">
            {data.dikonfirmasiOleh
              ? t("dikonfirmasi", { nama: data.dikonfirmasiOleh, waktu: data.dikonfirmasiPadaTampil ?? "—" })
              : t("hargaAwal")}
          </p>
        ) : null}
        {gagal && data.kirimanTerakhir ? (
          <p className="text-destructive">
            {t("kirimanGagal", {
              status: data.kirimanTerakhir.status === "DEAD" ? t("statusDEAD") : t("statusSKIPPED"),
              alasan: data.kirimanTerakhir.skipReason ?? data.kirimanTerakhirTampil ?? "—",
            })}
          </p>
        ) : null}
        {menunggu && bolehKonfirmasiHarga ? (
          <p>
            <Link
              href={`/backoffice/jubelio/harga?cari=${encodeURIComponent(sku)}`}
              className="text-tautan underline underline-offset-2"
            >
              {t("bukaDaftar")}
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
