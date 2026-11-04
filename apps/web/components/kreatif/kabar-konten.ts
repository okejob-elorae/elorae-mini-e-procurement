"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { dinamis } from "@/lib/i18n/dinamis";
import type { MajuTahap } from "@/lib/creative/konten-kol-writer";

/*
 * Toast Konten KOL & penjualan. Perpindahan tahap yang terjadi sendiri dari
 * faktanya disebut di pesan yang sama ("Konten tercatat · tahap → Tayang"),
 * supaya orang tidak perlu membuka kolaborasinya untuk tahu apa yang berubah.
 */

/** Kode galat yang punya terjemahan di `kreatifRuang.kontenKol.err.*`. */
const KODE_DIKENAL = new Set([
  "TIDAK_DITEMUKAN",
  "KOLABORASI_TIDAK_DITEMUKAN",
  "LINK_TIDAK_SAH",
  "PLATFORM_TIDAK_SAH",
  "FORMAT_TIDAK_SAH",
  "TANGGAL_TIDAK_SAH",
  "TANGGAL_WAJIB",
  "TANPA_DRAF",
  "SUDAH_TAYANG",
  "BELUM_TAYANG",
  "CATATAN_WAJIB",
  "CATATAN_TERLALU_PANJANG",
  "ANGKA_TIDAK_SAH",
  "ANGKA_KOSONG",
  "PENJUALAN_KOSONG",
  "SUMBER_TIDAK_SAH",
  "TANPA_AKSES",
  "GAGAL",
]);

export function useKabarKonten() {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  return {
    /** `kunci` relatif terhadap `kreatifRuang` (mis. "kontenKol.ok.tayang"). */
    sukses(kunci: string, maju?: MajuTahap) {
      const pesan = td(kunci);
      toast.success(maju ? t("kontenKol.okMaju", { pesan, tahap: td(`tahap.${maju.ke}`) }) : pesan);
    },
    gagal(kode: string) {
      toast.error(td(`kontenKol.err.${KODE_DIKENAL.has(kode) ? kode : "GAGAL"}`));
    },
  };
}
