/**
 * Penolakan berkode untuk penerimaan barang jadi. `receiveFG` MELEMPARnya;
 * layar terima barang jadi memanggil `terimaBarangJadi`, yang mengembalikannya
 * sebagai `{ ok:false, code }` — di build produksi Next menyamarkan pesan galat
 * yang dilempar aksi server, jadi layar menjelaskan alasannya lewat kode
 * (`productionErrors.<code>` di i18n), bukan lewat pesan di bawah.
 *
 * Membatalkan WO (`cancelWorkOrder`), menerbitkan WO (`terbitkanWorkOrder`)
 * dan mengeluarkan bahan (`keluarkanBahan`) punya kode sendiri di
 * `app/actions/production.ts` dan juga mengembalikan `{ ok:false, code }`.
 * `WO_SUDAH_ADA_PENERIMAAN` dan `WO_SUDAH_DIBATALKAN` di sini tidak lagi
 * dilempar siapa pun (sisa dari pembatalan yang dulu melempar).
 */
export const KODE_TOLAK_PRODUKSI = {
  WO_TIDAK_DITEMUKAN: "Perintah kerja tidak ditemukan.",
  WO_DIBATALKAN: "Perintah kerja ini sudah dibatalkan, jadi barang jadi tidak bisa diterima.",
  WO_BELUM_TERBIT: "Perintah kerja ini masih draf. Terbitkan dulu sebelum menerima barang jadi.",
  WO_SUDAH_ADA_PENERIMAAN: "Perintah kerja yang sudah punya penerimaan barang jadi tidak bisa dibatalkan.",
  WO_SUDAH_DIBATALKAN: "Perintah kerja ini sudah dibatalkan.",
} as const;

export type KodeTolakProduksi = keyof typeof KODE_TOLAK_PRODUKSI;

export class ProduksiDitolakError extends Error {
  readonly code: KodeTolakProduksi;

  constructor(code: KodeTolakProduksi) {
    super(KODE_TOLAK_PRODUKSI[code]);
    this.name = "ProduksiDitolakError";
    this.code = code;
  }
}
