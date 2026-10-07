/*
 * Penolakan keputusan pemilik atas GRN terima-lebih, sebagai KODE.
 *
 * `approveGRNByOwner` / `declineGRNByOwner` melempar pesan tetap ini (dipakai
 * pemanggil lama dan tesnya); pembungkus `putuskanGRNPemilik` mengubahnya
 * menjadi `{ ok:false, code }`, karena di build produksi Next menyamarkan
 * pesan lemparan aksi server. Pesannya didefinisikan DI SINI dan dipakai
 * pelemparnya, jadi keduanya tidak bisa berjalan sendiri-sendiri.
 */

export const PESAN_PEMILIK_GRN = {
  TIDAK_DITEMUKAN: "GRN not found",
  SUDAH_DITOLAK: "This GRN was already declined",
  SUDAH_DISETUJUI: "This GRN was already approved",
  TIDAK_MENUNGGU: "This GRN is not awaiting owner approval",
  ROL_SUDAH_DIPAKAI:
    "Cannot decline: fabric rolls from this GRN have been consumed. Adjust stock or contact support.",
  STOK_KURANG: "Cannot decline: insufficient on-hand stock (goods may have been issued or consumed).",
  QTY_PO_NEGATIF: "PO received quantity would become negative; data may be inconsistent.",
  TANPA_BARIS: "No valid GRN lines to reverse",
  /** Diikuti id barang. */
  HARGA_TIDAK_SAH: "Invalid unit cost on GRN line for item",
} as const;

export type KodeTolakPemilikGrn =
  | "TANPA_AKSES"
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIPUTUSKAN"
  | "TIDAK_MENUNGGU"
  | "ROL_SUDAH_DIPAKAI"
  | "STOK_KURANG"
  | "DATA_TIDAK_KONSISTEN"
  | "GAGAL";

export function kodeTolakPemilikGrn(e: unknown): KodeTolakPemilikGrn {
  const pesan = e instanceof Error ? e.message : "";
  switch (pesan) {
    case PESAN_PEMILIK_GRN.TIDAK_DITEMUKAN:
      return "TIDAK_DITEMUKAN";
    case PESAN_PEMILIK_GRN.SUDAH_DITOLAK:
    case PESAN_PEMILIK_GRN.SUDAH_DISETUJUI:
      return "SUDAH_DIPUTUSKAN";
    case PESAN_PEMILIK_GRN.TIDAK_MENUNGGU:
      return "TIDAK_MENUNGGU";
    case PESAN_PEMILIK_GRN.ROL_SUDAH_DIPAKAI:
      return "ROL_SUDAH_DIPAKAI";
    case PESAN_PEMILIK_GRN.STOK_KURANG:
      return "STOK_KURANG";
    case PESAN_PEMILIK_GRN.QTY_PO_NEGATIF:
    case PESAN_PEMILIK_GRN.TANPA_BARIS:
      return "DATA_TIDAK_KONSISTEN";
  }
  if (pesan.startsWith(PESAN_PEMILIK_GRN.HARGA_TIDAK_SAH)) return "DATA_TIDAK_KONSISTEN";
  return "GAGAL";
}
