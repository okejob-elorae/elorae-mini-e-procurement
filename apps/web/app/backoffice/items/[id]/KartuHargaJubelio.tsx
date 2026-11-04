"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Store } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format/rupiah";
import { ALASAN_KIRIMAN, hargaSama } from "@/lib/jubelio/harga/aturan";
import type { HargaJubelioBarang } from "@/lib/jubelio/harga/queries";

export type HargaJubelioTampil = HargaJubelioBarang & {
  dikonfirmasiPadaTampil: string | null;
  kirimanTerakhirTampil: string | null;
  terbacaPadaTampil: string | null;
  bedaTerbacaPadaTampil: string | null;
};

/** Alasan lewati yang punya kalimatnya sendiri; yang lain tampil sebagai kodenya. */
const ALASAN_TERBACA = new Set<string>([ALASAN_KIRIMAN.DITAHAN, ALASAN_KIRIMAN.SALURAN_OFFLINE]);

/**
 * "Harga di Jubelio" di halaman barang (keputusan pemilik 2026-11-02): harga yang terakhir
 * dikonfirmasi untuk Jubelio, siapa yang mengonfirmasi, apakah ada harga baru yang masih menunggu,
 * di mana barangnya dijual (P3), dan — bila harga yang terbaca di Jubelio berbeda dengan ERP (P2) —
 * peringatannya, termasuk bahwa kiriman lain ke Jubelio ditahan (P75). Hanya dibaca; tautan ke
 * daftar konfirmasi dan daftar beda harga hanya untuk pemegang `jubelio_prices:confirm`.
 * Penjelasan ada di Bantuan, bukan di layar.
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
  const tItems = useTranslations("items");
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
    case "SALURAN_OFFLINE":
      utama = data.terpetakan ? t("saluranOfflineTerpetakan") : t("saluranOffline");
      break;
    default:
      utama = t("belumDiJubelio");
  }

  const menunggu = data.keadaan === "MENUNGGU_UBAH" || data.keadaan === "MENUNGGU_BARU";
  const sudahDiJubelio = data.keadaan === "SAMA" || data.keadaan === "MENUNGGU_UBAH" || data.keadaan === "TANPA_HARGA";
  const gagal = data.kirimanTerakhir && (data.kirimanTerakhir.status === "DEAD" || data.kirimanTerakhir.status === "SKIPPED");
  const alasanLewati = (kode: string | null) =>
    kode && ALASAN_TERBACA.has(kode) ? t(`alasanLewati.${kode}`) : (kode ?? data.kirimanTerakhirTampil ?? "—");
  const beda = data.beda;
  const hargaBeda = beda
    ? beda.tertinggi != null && beda.terendah != null && !hargaSama(beda.tertinggi, beda.terendah)
      ? t("bedaRentang", { rendah: rp(beda.terendah), tinggi: rp(beda.tertinggi) })
      : rp(beda.tertinggi ?? beda.terendah)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="h-4 w-4" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="text-muted-foreground">{t("saluran", { saluran: tItems(`saluran.${data.saluran}`) })}</p>
        <p className={menunggu ? "font-medium" : undefined}>{utama}</p>
        {sudahDiJubelio && data.dikonfirmasiPada ? (
          <p className="text-muted-foreground">
            {data.dikonfirmasiOleh
              ? t("dikonfirmasi", { nama: data.dikonfirmasiOleh, waktu: data.dikonfirmasiPadaTampil ?? "—" })
              : t("hargaAwal")}
          </p>
        ) : null}
        {beda && hargaBeda ? (
          <div className="space-y-1">
            <p className="font-medium text-destructive">
              {t("beda", { jubelio: hargaBeda, erp: rp(data.hargaJubelio), waktu: data.bedaTerbacaPadaTampil ?? "—" })}
            </p>
            {beda.ditahan ? <p className="text-destructive">{t("ditahan")}</p> : null}
            {bolehKonfirmasiHarga ? (
              <p>
                <Link
                  href={`/backoffice/jubelio/harga?jenis=BEDA&cari=${encodeURIComponent(sku)}`}
                  className="text-tautan underline underline-offset-2"
                >
                  {t("bukaBeda")}
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
        {gagal && data.kirimanTerakhir && !(beda && data.kirimanTerakhir.skipReason === ALASAN_KIRIMAN.DITAHAN) ? (
          <p className="text-destructive">
            {t("kirimanGagal", {
              status: data.kirimanTerakhir.status === "DEAD" ? t("statusDEAD") : t("statusSKIPPED"),
              alasan: alasanLewati(data.kirimanTerakhir.skipReason),
            })}
          </p>
        ) : null}
        {data.terbacaPadaTampil && !beda ? (
          <p className="text-xs text-muted-foreground">{t("terbaca", { waktu: data.terbacaPadaTampil })}</p>
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
