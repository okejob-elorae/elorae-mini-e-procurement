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
  "SPG_BERHENTI",
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
  "CATATAN_STOK_TIDAK_COCOK",
  // terima kiriman: pengirimannya tidak jadi dikirim, atau belum berangkat dari gudang
  "KIRIMAN_DIBATALKAN",
  "BELUM_BERANGKAT",
  // barang kembali dari pembeli
  "TANPA_AKSES",
  "TANPA_TOKO",
  "ISIAN_TIDAK_VALID",
  "ALASAN_WAJIB",
  "NOTA_TIDAK_DITEMUKAN",
  "BARIS_TIDAK_DITEMUKAN",
  "MELEBIHI_SISA",
  "KUNCI_WAJIB",
  "FOTO_BARANG_WAJIB",
  "FOTO_STRUK_WAJIB",
  "JAWABAN_UANG_WAJIB",
  // barang kembali dari pembeli yang mengganti laporan lama
  "GANTI_BUKAN_MILIK",
  "GANTI_TIDAK_BISA",
  "ALASAN_GANTI_WAJIB",
  // uang retur pembeli dikembalikan — empat nama umum, lihat KODE_ALASAN_LINTAS_PEKERJAAN; yang
  // terakhir khusus langkah ini (potong laporan yang ditolak/ditarik sudah dilaporkan lagi)
  "TIDAK_DITEMUKAN",
  "BUKAN_MILIK",
  "TIDAK_DISETUJUI",
  "SUDAH_DICATAT",
  "POTONG_SUDAH_DILAPORKAN_ULANG",
  // foto retur pembeli ditolak rute unggahnya karena keadaan laporannya (409 KEADAAN, tersimpan
  // `FOTO_KEADAAN` — pola `FOTO_<kode>` di luring-sinkron.ts)
  "FOTO_KEADAAN",
] as const;

/**
 * Kode dengan nama UMUM: daftar di atas satu untuk SEMUA pekerjaan antrean, dan pekerjaan lain bisa
 * mengembalikan nama yang sama (`kirimMutasi` mengembalikan `TIDAK_DITEMUKAN`). Teksnya karena itu
 * tidak boleh menyebut satu jenis pekerjaan — tesnya menjaga teks ini tidak menyebut retur.
 */
export const KODE_ALASAN_LINTAS_PEKERJAAN = ["TIDAK_DITEMUKAN", "BUKAN_MILIK", "TIDAK_DISETUJUI", "SUDAH_DICATAT"] as const;

/**
 * Kunci teks alasan untuk kolom `error` antrean. Kode yang dikenal memakai teksnya sendiri —
 * termasuk penolakan server yang namanya kebetulan berawalan `FOTO_` (`FOTO_BARANG_WAJIB`,
 * `FOTO_STRUK_WAJIB`). Foto yang ditolak saat diunggah tersimpan sebagai `FOTO_<kode>` (pola
 * `laporan-sync.ts`) dan memakai satu teks; kode yang tidak dikenal memakai teks umum.
 */
export function kunciAlasanLuring(kode: string | undefined): string {
  if (!kode) return "UMUM";
  if ((KODE_ALASAN_LURING as readonly string[]).includes(kode)) return kode;
  if (kode.startsWith("FOTO_")) return "FOTO";
  return "UMUM";
}
