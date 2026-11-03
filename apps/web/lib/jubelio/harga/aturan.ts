/**
 * Konfirmasi harga Jubelio (keputusan pemilik 2026-11-02) — aturan murni, tanpa impor, aman
 * dipakai komponen klien.
 *
 * ERP adalah sumber harga. Harga jual dibuat dan diubah di ERP dan langsung berlaku di ERP; ke
 * Jubelio harga itu baru sampai setelah dikonfirmasi (Jubelio → Konfirmasi harga, izin
 * `jubelio_prices:confirm`). Setiap kiriman produk ke Jubelio membawa harga TERKONFIRMASI
 * (`Item.jubelioConfirmedPrice`), tidak pernah harga jual mentah.
 *
 * Yang menunggu konfirmasi TIDAK DISIMPAN, tetapi DITURUNKAN dari kolom barang:
 * - barang jadi yang sudah di Jubelio (punya JubelioProductMapping) dengan harga ERP berbeda dari
 *   harga Jubelio terkonfirmasi → "Perubahan harga" (UBAH);
 * - barang jadi buatan ERP yang belum di Jubelio dan sedang diajukan → "Produk baru" (BARU).
 * Jadi setiap penulis harga jual — formulir, impor barang, penulis mana pun nanti — otomatis
 * masuk daftar; harga yang diubah dua kali tetap satu baris; dan harga yang dikembalikan ke harga
 * terkonfirmasi keluar dari daftar dengan sendirinya. Harga 0 atau kurang dianggap TIDAK ADA
 * harga di kedua sisi.
 *
 * Kembaran SQL aturan ini ada di `queries.ts` (satu fragmen untuk daftar dan hitungan Beranda);
 * `queries.test.ts` memastikan keduanya sepakat.
 *
 * Jawaban pemilik 2026-11-02 (malam):
 * - P3a: barang "Toko offline saja" tidak pernah dikirim ke Jubelio — keadaannya SALURAN_OFFLINE,
 *   tidak pernah BARU/UBAH. P72: yang sudah di Jubelio dinonaktifkan di sana (tidak dihapus).
 * - P1/P2: harga varian TERTINGGI di Jubelio adalah harga Jubelio; kalau harga yang TERBACA di
 *   Jubelio (tertinggi atau terendah) berbeda dengan harga terkonfirmasi, muncul peringatan
 *   "Harga di Jubelio berbeda dengan ERP" (BEDA) — DITURUNKAN, tidak disimpan (`bedaDiJubelio`).
 * - P74: satu-satunya jalan keluarnya "Kirim ulang harga ERP".
 * - P75: selama BEDA terbuka tanpa keputusan admin sesudah bacaan itu berubah, tidak ada kiriman
 *   yang boleh mengubah harga Jubelio; apps/api MENAHAN kirimannya (`price_differs_held`), dan
 *   sapuan web melepasnya begitu bedanya hilang. Keputusan harga (konfirmasi, kembalikan, kirim
 *   ulang) dicap `Item.jubelioPriceDecidedAt`.
 */

import type { SaluranJual } from "@/lib/items/saluran-jual";

export type JenisMenunggu = "BARU" | "UBAH";

/** Tampilan halaman Konfirmasi harga: yang menunggu, atau yang harganya berbeda di Jubelio. */
export type JenisTampilHarga = JenisMenunggu | "BEDA";

export type KeadaanHargaJubelio =
  | "SAMA"
  | "MENUNGGU_UBAH"
  | "MENUNGGU_BARU"
  | "TANPA_HARGA"
  | "BELUM_DI_JUBELIO"
  | "BUKAN_UNTUK_JUBELIO"
  | "SALURAN_OFFLINE";

export type AlasanTidakBisaDikirim = "HARGA_KOSONG" | "KATEGORI_BELUM_DIPETAKAN";

/** Baris paling banyak per panggilan aksi; klien memotong pilihan yang lebih besar. */
export const MAKS_BARIS_KONFIRMASI = 200;
/** Kiriman langsung ke apps/api per panggilan; sisanya diambil poller dalam ~5 detik. */
export const MAKS_ANTRE_LANGSUNG = 10;
/** Baris yang ditampilkan halaman konfirmasi; lebih dari itu diberi catatan "menampilkan N dari M". */
export const MAKS_DAFTAR_HARGA = 1000;
/** Pemberitahuan lonceng "harga di Jubelio berbeda" paling banyak per putaran sapuan. */
export const MAKS_PENGUMUMAN_BEDA = 20;
/** Kiriman yang ditahan paling banyak dilepas per putaran sapuan. */
export const MAKS_LEPAS_TAHANAN = 50;

/** Nama tindakan jejak audit — satu ejaan, dicari persis. */
export const JEJAK_HARGA_JUBELIO = {
  DIKONFIRMASI: "JUBELIO_PRICE_CONFIRMED",
  DIKEMBALIKAN: "JUBELIO_PRICE_REVERTED",
  PENGAJUAN_DIBATALKAN: "JUBELIO_CREATE_REQUEST_CANCELLED",
  DIKIRIM_ULANG: "JUBELIO_PRICE_RESENT",
} as const;

/** Kategori AdminNotification "Harga di Jubelio berbeda dengan ERP" — ejaan dari daftar izin. */
export const JUBELIO_PRICE_DIFFERS = "JUBELIO_PRICE_DIFFERS";

/** Alasan lewati kiriman produk dari apps/api (`OUTBOX_SKIP_REASONS`) yang dibaca web. */
export const ALASAN_KIRIMAN = {
  DITAHAN: "price_differs_held",
  SALURAN_OFFLINE: "sales_channel_offline",
} as const;

export function bacaJenisTampil(v: unknown): JenisTampilHarga | null {
  return v === "BARU" || v === "UBAH" || v === "BEDA" ? v : null;
}

const POLA_ANGKA = /^-?\d+(\.\d+)?$/;
const POLA_HARGA_DIHARAPKAN = /^\d{1,12}(\.\d{1,2})?$/;

/** Harga dalam sen bulat; null untuk kosong atau tidak terbaca. */
function keSen(teks: string | null): number | null {
  if (teks == null) return null;
  const t = teks.trim();
  if (!POLA_ANGKA.test(t)) return null;
  const n = Math.round(Number(t) * 100);
  return Number.isFinite(n) ? n : null;
}

/** Decimal/angka → "150000.00", bentuk token compare-and-swap yang dikirim halaman. */
export function hargaKeTeks(nilai: { toFixed(d: number): string } | number | null | undefined): string | null {
  if (nilai == null) return null;
  if (typeof nilai === "number") return Number.isFinite(nilai) ? nilai.toFixed(2) : null;
  return nilai.toFixed(2);
}

/** Harga yang berlaku: di atas 0. Harga 0 atau kurang (atau tidak terbaca) = tidak ada harga. */
export function hargaBerlaku(teks: string | null): string | null {
  const sen = keSen(teks);
  return sen != null && sen > 0 ? teks : null;
}

/** Sama dalam sen bulat; null hanya sama dengan null. */
export function hargaSama(a: string | null, b: string | null): boolean {
  const x = keSen(a);
  const y = keSen(b);
  if (x == null || y == null) return x == null && y == null;
  return x === y;
}

export function keadaanHargaJubelio(input: {
  barangJadi: boolean;
  sumber: "ERP" | "JUBELIO_INGEST";
  saluran: SaluranJual;
  terpetakan: boolean;
  hargaErp: string | null;
  hargaJubelio: string | null;
  diajukanPada: Date | string | null;
}): KeadaanHargaJubelio {
  if (!input.barangJadi) return "BUKAN_UNTUK_JUBELIO";
  if (input.saluran === "OFFLINE") return "SALURAN_OFFLINE";
  if (input.terpetakan) {
    const erp = hargaBerlaku(input.hargaErp);
    const jubelio = hargaBerlaku(input.hargaJubelio);
    if (erp == null && jubelio == null) return "TANPA_HARGA";
    return hargaSama(erp, jubelio) ? "SAMA" : "MENUNGGU_UBAH";
  }
  if (input.sumber !== "ERP") return "BUKAN_UNTUK_JUBELIO";
  return input.diajukanPada != null ? "MENUNGGU_BARU" : "BELUM_DI_JUBELIO";
}

export function jenisMenunggu(k: KeadaanHargaJubelio): JenisMenunggu | null {
  if (k === "MENUNGGU_UBAH") return "UBAH";
  if (k === "MENUNGGU_BARU") return "BARU";
  return null;
}

/**
 * Selisih harga baru terhadap harga lama, dalam rupiah dan persen. Tanpa harga baru → null;
 * tanpa harga lama (atau 0) → persennya null.
 */
export function selisihHarga(lama: string | null, baru: string | null): { rupiah: number; persen: number | null } | null {
  const senBaru = keSen(baru);
  if (senBaru == null) return null;
  const senLama = keSen(lama);
  const rupiah = (senBaru - (senLama ?? 0)) / 100;
  const persen = senLama != null && senLama > 0 ? Math.round(((senBaru - senLama) / senLama) * 1000) / 10 : null;
  return { rupiah, persen };
}

/** Kenapa baris yang menunggu tidak bisa dikirim ke Jubelio; null = bisa. */
export function alasanTidakBisaDikirim(input: { hargaErp: string | null; kategoriTerpetakan: boolean }): AlasanTidakBisaDikirim | null {
  if (hargaBerlaku(input.hargaErp) == null) return "HARGA_KOSONG";
  if (!input.kategoriTerpetakan) return "KATEGORI_BELUM_DIPETAKAN";
  return null;
}

/** Harga ERP yang dibawa halaman sebagai token: null, atau "150000"/"150000.5"/"150000.00". */
export function bacaHargaDiharapkan(nilai: unknown): { ok: true; harga: string | null } | { ok: false } {
  if (nilai === null) return { ok: true, harga: null };
  if (typeof nilai === "string" && POLA_HARGA_DIHARAPKAN.test(nilai)) return { ok: true, harga: nilai };
  return { ok: false };
}

/** Waktu ISO/Date → milidetik; null untuk kosong atau tidak terbaca. */
function waktu(v: string | Date | null | undefined): number | null {
  if (v == null) return null;
  const t = typeof v === "string" ? Date.parse(v) : v.getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Harga yang terbaca di Jubelio berbeda dengan harga terkonfirmasi: tertinggi ATAU terendahnya
 * (≤ 0 = tanpa harga, di kedua sisi). Kembaran `hargaJubelioBerbeda` di @elorae/db.
 */
export function hargaTerbacaBerbeda(i: {
  jubelioTertinggi: string | null;
  jubelioTerendah: string | null;
  hargaTerkonfirmasi: string | null;
}): boolean {
  const k = hargaBerlaku(i.hargaTerkonfirmasi);
  return !hargaSama(hargaBerlaku(i.jubelioTertinggi), k) || !hargaSama(hargaBerlaku(i.jubelioTerendah), k);
}

/**
 * Keputusan harga admin masih berlaku: diambil pada atau sesudah bacaan Jubelio terakhir BERUBAH.
 * Kembaran `keputusanHargaBerlaku` di @elorae/db.
 */
export function keputusanMasihBerlaku(i: { diputuskanPada: string | Date | null; berubahPada: string | Date | null }): boolean {
  const putus = waktu(i.diputuskanPada);
  if (putus == null) return false;
  const ubah = waktu(i.berubahPada);
  return ubah == null || ubah <= putus;
}

/**
 * "Harga di Jubelio berbeda dengan ERP" (BEDA, P2) — barang jadi yang sudah di Jubelio, pernah
 * terbaca, harga terbacanya berbeda dengan harga terkonfirmasi, dan TIDAK sedang dalam keadaan
 * "keputusan berlaku + kiriman sedang berjalan" (kiriman keputusan itu sendiri sedang membereskannya).
 *
 * Berlaku untuk SETIAP barang jadi yang sudah di Jubelio, apa pun salurannya — juga "Toko offline
 * saja" yang sudah dinonaktifkan di Jubelio (P72: produknya tetap ada di sana). Penahanan kiriman di
 * apps/api (`tahanKarenaHargaBeda`) juga tidak memandang saluran, jadi peringatan di sini dan kiriman
 * yang ditahan di sana selalu sepakat. Apakah produk yang sudah dinonaktifkan perlu diawasi masih
 * ditanyakan ke pemilik; sampai dijawab, aturan rancangan (R22) berlaku apa adanya.
 *
 * Kembaran SQL-nya `sumberBeda` di queries.ts; `queries.test.ts` memastikan keduanya sepakat.
 */
export function bedaDiJubelio(i: {
  barangJadi: boolean;
  terpetakan: boolean;
  terbacaPada: string | Date | null;
  jubelioTertinggi: string | null;
  jubelioTerendah: string | null;
  hargaTerkonfirmasi: string | null;
  diputuskanPada: string | Date | null;
  berubahPada: string | Date | null;
  sedangDikirim: boolean;
}): boolean {
  if (!i.barangJadi || !i.terpetakan || waktu(i.terbacaPada) == null) return false;
  if (!hargaTerbacaBerbeda(i)) return false;
  return !(keputusanMasihBerlaku(i) && i.sedangDikirim);
}

export type AlasanTidakBisaDikirimUlang = "TANPA_HARGA_TERKONFIRMASI" | "KATEGORI_BELUM_DIPETAKAN" | "ADA_HARGA_BARU";

/**
 * Kenapa "Kirim ulang harga ERP" tidak bisa untuk baris BEDA; null = bisa. ADA_HARGA_BARU: harga
 * ERP baru sedang menunggu konfirmasi DAN Jubelio sudah menampilkannya — yang benar menyetujuinya
 * di "Perubahan harga", bukan mengirim ulang harga lama.
 */
export function alasanTidakBisaDikirimUlang(i: {
  hargaTerkonfirmasi: string | null;
  kategoriTerpetakan: boolean;
  menungguKonfirmasi: boolean;
  hargaErp: string | null;
  jubelioTertinggi: string | null;
  jubelioTerendah: string | null;
}): AlasanTidakBisaDikirimUlang | null {
  if (hargaBerlaku(i.hargaTerkonfirmasi) == null) return "TANPA_HARGA_TERKONFIRMASI";
  if (!i.kategoriTerpetakan) return "KATEGORI_BELUM_DIPETAKAN";
  const erp = hargaBerlaku(i.hargaErp);
  if (
    i.menungguKonfirmasi &&
    erp != null &&
    hargaSama(hargaBerlaku(i.jubelioTertinggi), erp) &&
    hargaSama(hargaBerlaku(i.jubelioTerendah), erp)
  ) {
    return "ADA_HARGA_BARU";
  }
  return null;
}

export type AlasanTidakBisaDinonaktifkan = "TANPA_HARGA_TERKONFIRMASI" | "KATEGORI_BELUM_DIPETAKAN" | "BAWAAN_BELUM_ADA";

/**
 * Barang yang sudah di Jubelio dijadikan "Toko offline saja" dinonaktifkan di Jubelio dengan satu
 * kiriman produk (P72). Kiriman itu membawa harga terkonfirmasi, kategori Jubelio dan nilai bawaan
 * kiriman; tanpa salah satunya kirimannya pasti dilewati, jadi perubahannya ditolak dengan sebabnya
 * daripada diam-diam tidak pernah menonaktifkan. null = bisa.
 */
export function alasanTidakBisaDinonaktifkan(i: {
  hargaTerkonfirmasi: string | null;
  kategoriTerpetakan: boolean;
  bawaanAda: boolean;
}): AlasanTidakBisaDinonaktifkan | null {
  if (hargaBerlaku(i.hargaTerkonfirmasi) == null) return "TANPA_HARGA_TERKONFIRMASI";
  if (!i.kategoriTerpetakan) return "KATEGORI_BELUM_DIPETAKAN";
  if (!i.bawaanAda) return "BAWAAN_BELUM_ADA";
  return null;
}

export type AlasanTidakBisaDiaktifkan = "KATEGORI_BELUM_DIPETAKAN" | "BAWAAN_BELUM_ADA";

/**
 * Kebalikannya: barang yang sudah di Jubelio dari "Toko offline saja" kembali ke Marketplace /
 * Keduanya diaktifkan lagi dengan satu kiriman produk. Tanpa kategori Jubelio atau nilai bawaan
 * kiriman, kiriman itu dilewati dan produknya tetap nonaktif di Jubelio, jadi ditolak dengan
 * sebabnya. Harga terkonfirmasi TIDAK disyaratkan: tanpa harga terkonfirmasi barangnya menjadi baris
 * "Perubahan harga", dan konfirmasinya sendiri yang mengirim is_active = true. null = bisa.
 */
export function alasanTidakBisaDiaktifkan(i: { kategoriTerpetakan: boolean; bawaanAda: boolean }): AlasanTidakBisaDiaktifkan | null {
  if (!i.kategoriTerpetakan) return "KATEGORI_BELUM_DIPETAKAN";
  if (!i.bawaanAda) return "BAWAAN_BELUM_ADA";
  return null;
}
