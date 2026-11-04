import type { TerjemahDinamis } from "@/lib/i18n/dinamis";
import type { StatusRekomendasi } from "@/lib/salesman/rekomendasi-aturan";

/**
 * Warna pil status rekomendasi — dipakai layar salesman dan layar SPG, supaya
 * "Diterima" terlihat sama di kedua HP.
 */
export const NADA_STATUS_REKOMENDASI: Record<StatusRekomendasi, string> = {
  TERKIRIM: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DITERIMA: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  DITOLAK: "bg-destructive/10 text-destructive",
  SELESAI: "bg-primary/15 text-foreground",
  DIBATALKAN: "bg-muted text-muted-foreground",
};

const DIKENAL = [
  "TANPA_AKSES",
  "TANPA_TOKO",
  "GAGAL",
  "KUNCI_WAJIB",
  "KUNCI_DIPAKAI",
  "TOKO_TIDAK_DITEMUKAN",
  "BUKAN_PEMEGANG",
  "BARANG_TIDAK_DIKENAL",
  "BARANG_TIDAK_AKTIF",
  "VARIAN_TIDAK_DIKENAL",
  "TEKS_TERLALU_PANJANG",
  "TANPA_BARIS",
  "TERLALU_BANYAK_BARIS",
  "JUMLAH_TIDAK_VALID",
  "BARIS_GANDA",
  "ISIAN_TIDAK_VALID",
  "TIDAK_DITEMUKAN",
  "BUKAN_TOKO_ANDA",
  "BUKAN_PEMBUAT",
  "TOKO_PUNYA_SPG",
  "SUMBER_TIDAK_VALID",
  "ALASAN_WAJIB",
];

/**
 * Kode galat aksi rekomendasi → kalimat (namespace `pwaRekomendasi`).
 * SUDAH_BERUBAH menyebut keadaan barunya bila diketahui ("sudah dibatalkan").
 */
export function pesanGagalRekomendasi(r: { kode: string; status?: StatusRekomendasi }, td: TerjemahDinamis): string {
  if (r.kode === "SUDAH_BERUBAH") {
    return r.status ? td("err.SUDAH_BERUBAH_STATUS", { status: td(`status.${r.status}`) }) : td("err.SUDAH_BERUBAH");
  }
  return td(DIKENAL.includes(r.kode) ? `err.${r.kode}` : "err.GAGAL");
}
