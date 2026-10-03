// Pengklasifikasi murni nasib satu kiriman antrean "tanpa sinyal" (check-in,
// check-out, terima kiriman, opname, barang kembali dari pembeli). Tanpa impor
// server — pola yang sama dengan `classify.ts` dan `spg-jual-klasifikasi.ts`.

/**
 * - `evict`    : tercatat (atau sudah tercatat sebelumnya — kunci yang sama
 *                mengembalikan hasil yang ada); hapus dari HP.
 * - `terminal` : server menolak ISINYA. Mengirim ulang hanya ditolak lagi, jadi
 *                berhenti dan tunjukkan alasannya.
 * - `retry`    : belum tentu sampai (sinyal putus, server sibuk). Coba lagi nanti.
 */
export type NasibLuring = "evict" | "terminal" | "retry";

/** Jawaban aksi ber-`code`: setiap kode yang dikembalikan menolak isinya; galat tak terduga MELEMPAR. */
export function nasibKode(hasil: { ok: true } | { ok: false; code: string } | { thrown: true }): NasibLuring {
  if ("thrown" in hasil) return "retry";
  return hasil.ok ? "evict" : "terminal";
}

/**
 * Barang kembali dari pembeli: aksinya memakai `kode`, dan `GAGAL` adalah galat
 * server yang tertangkap (layak diulang) — sisanya penolakan isi.
 */
export function nasibReturPembeli(hasil: { ok: true } | { ok: false; kode: string } | { thrown: true }): NasibLuring {
  if ("thrown" in hasil) return "retry";
  if (hasil.ok) return "evict";
  return hasil.kode === "GAGAL" ? "retry" : "terminal";
}

/**
 * Kode lokal (tidak pernah dari server): pekerjaan ini terikat check-in tanpa
 * sinyal yang DITOLAK server. Tidak dikirim — kunjungannya tidak pernah ada.
 */
export const KUNJUNGAN_DITOLAK = "KUNJUNGAN_DITOLAK";

/**
 * Kode lokal tanda dikirim mutasi yang ajuannya juga dicatat tanpa sinyal:
 * ajuan itu DITOLAK server (mutasinya tidak pernah ada), atau sudah dihapus
 * dari HP tanpa pernah sampai. Tidak dikirim — tidak ada mutasi untuk dikirim.
 */
export const AJUAN_MUTASI_DITOLAK = "AJUAN_DITOLAK";
export const AJUAN_MUTASI_HILANG = "AJUAN_TIDAK_ADA";

/** Kode yang punya teks alasan sendiri di layar antrean (`pwaLuring.alasan.<KODE>`). */
export const KODE_ALASAN_LURING = [
  // check-in
  "UNAUTHORIZED",
  "NOT_FOUND",
  "STORE_NOT_ASSIGNED",
  "DI_LUAR_RADIUS",
  "WAKTU_TIDAK_VALID",
  "KUNCI_DIPAKAI",
  "VALIDATION",
  // check-out
  "FORBIDDEN",
  "KUNJUNGAN_TIDAK_SAH",
  "HASIL_WAJIB",
  "HASIL_TIDAK_SAH",
  "CATATAN_WAJIB",
  KUNJUNGAN_DITOLAK,
  // terima kiriman & opname
  "NO_ASSIGNED_STORE",
  "KIRIMAN_TIDAK_DITEMUKAN",
  "SUDAH_DITERIMA",
  "JUMLAH_TIDAK_VALID",
  "LEBIH_DARI_DIKIRIM",
  "SIKLUS_TERKUNCI",
  "MASIH_DITUNGGU_SPG",
  "RUSAK_TIDAK_VALID",
  "KETERANGAN_RUSAK_WAJIB",
  "TANPA_BARIS",
  "BARANG_TIDAK_DITEMUKAN",
  // barang kembali dari pembeli
  "TANPA_AKSES",
  "TANPA_TOKO",
  "ISIAN_TIDAK_VALID",
  "ALASAN_WAJIB",
  "NOTA_TIDAK_DITEMUKAN",
  "BARIS_TIDAK_DITEMUKAN",
  "MELEBIHI_SISA",
  "KUNCI_WAJIB",
] as const;

/**
 * Kunci teks alasan untuk kolom `error` antrean. Foto yang ditolak saat
 * diunggah tersimpan sebagai `FOTO_<kode>` (pola `laporan-sync.ts`) dan
 * memakai satu teks; kode yang tidak dikenal memakai teks umum.
 */
export function kunciAlasanLuring(kode: string | undefined): string {
  if (!kode) return "UMUM";
  if (kode.startsWith("FOTO_")) return "FOTO";
  return (KODE_ALASAN_LURING as readonly string[]).includes(kode) ? kode : "UMUM";
}
