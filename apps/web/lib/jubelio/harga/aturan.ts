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
 */

export type JenisMenunggu = "BARU" | "UBAH";

export type KeadaanHargaJubelio =
  | "SAMA"
  | "MENUNGGU_UBAH"
  | "MENUNGGU_BARU"
  | "TANPA_HARGA"
  | "BELUM_DI_JUBELIO"
  | "BUKAN_UNTUK_JUBELIO";

export type AlasanTidakBisaDikirim = "HARGA_KOSONG" | "KATEGORI_BELUM_DIPETAKAN";

/** Baris paling banyak per panggilan aksi; klien memotong pilihan yang lebih besar. */
export const MAKS_BARIS_KONFIRMASI = 200;
/** Kiriman langsung ke apps/api per panggilan; sisanya diambil poller dalam ~5 detik. */
export const MAKS_ANTRE_LANGSUNG = 10;
/** Baris yang ditampilkan halaman konfirmasi; lebih dari itu diberi catatan "menampilkan N dari M". */
export const MAKS_DAFTAR_HARGA = 1000;

/** Nama tindakan jejak audit — satu ejaan, dicari persis. */
export const JEJAK_HARGA_JUBELIO = {
  DIKONFIRMASI: "JUBELIO_PRICE_CONFIRMED",
  DIKEMBALIKAN: "JUBELIO_PRICE_REVERTED",
  PENGAJUAN_DIBATALKAN: "JUBELIO_CREATE_REQUEST_CANCELLED",
} as const;

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
  terpetakan: boolean;
  hargaErp: string | null;
  hargaJubelio: string | null;
  diajukanPada: Date | string | null;
}): KeadaanHargaJubelio {
  if (!input.barangJadi) return "BUKAN_UNTUK_JUBELIO";
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
