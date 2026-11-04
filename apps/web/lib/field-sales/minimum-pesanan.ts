/**
 * Minimum pesan PUTUS bertingkat — murni, dipakai server (penulis pesanan),
 * katalog HP, dan kartu pengaturan.
 *
 * Dua angka pemilik di `SystemSetting`:
 * - `putus.minOrderQty` — minimum per barang untuk toko yang BELUM pernah punya
 *   pesanan PUTUS yang disetujui (pesanan pertama). Bawaan 6, seperti sebelumnya.
 * - `putus.minOrderQtyReorder` — minimum untuk toko yang sudah pernah (pesan ulang).
 *   Bawaan = minimum pesanan pertama, jadi tidak ada yang berubah sampai pemilik
 *   mengisinya.
 *
 * `Item.minOrderQty` tetap menimpa keduanya: barang yang punya minimum sendiri
 * memakai angkanya di toko mana pun.
 */

export const KUNCI_MIN_PERTAMA = "putus.minOrderQty";
export const KUNCI_MIN_ULANG = "putus.minOrderQtyReorder";
export const MIN_PESANAN_BAWAAN = 6;
/** Batas atas yang masuk akal untuk isian pemilik — angka lebih besar hampir pasti salah ketik. */
export const MIN_PESANAN_MAKS = 1000;

export type JenisMinimum = "PERTAMA" | "ULANG";

export type AturanMinimum = {
  /** Minimum pesanan pertama yang berlaku. */
  pertama: number;
  /** Minimum pesan ulang yang berlaku. */
  ulang: number;
  /** Apakah pemilik mengisi angkanya sendiri (bukan bawaan). */
  pertamaDiatur: boolean;
  ulangDiatur: boolean;
};

/**
 * Nilai tersimpan → bilangan bulat ≥ 0, atau null bila kosong/rusak. Nilai yang
 * rusak jatuh ke bawaan: minimum yang tak terbaca lebih aman diperlakukan
 * "belum diatur" daripada "tanpa minimum".
 */
export function bacaAngkaMinimum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const bersih = raw.trim();
  if (!/^\d+$/.test(bersih)) return null;
  const n = Number(bersih);
  return Number.isSafeInteger(n) ? n : null;
}

export function bacaAturanMinimum(rawPertama: string | null | undefined, rawUlang: string | null | undefined): AturanMinimum {
  const p = bacaAngkaMinimum(rawPertama);
  const u = bacaAngkaMinimum(rawUlang);
  const pertama = p ?? MIN_PESANAN_BAWAAN;
  return { pertama, ulang: u ?? pertama, pertamaDiatur: p !== null, ulangDiatur: u !== null };
}

/** Minimum toko ini: pesan ulang bila toko sudah punya pesanan PUTUS yang disetujui. */
export function minimumToko(aturan: AturanMinimum, sudahPernahPesan: boolean): { min: number; jenis: JenisMinimum } {
  return sudahPernahPesan ? { min: aturan.ulang, jenis: "ULANG" } : { min: aturan.pertama, jenis: "PERTAMA" };
}

/**
 * Minimum satu barang di toko ini. `jenis` null = angka milik barang itu sendiri
 * (`Item.minOrderQty`), bukan tingkat toko — katalog tidak menyebut "pesan ulang" untuknya.
 */
export function minimumBarang(
  minBarang: number | null | undefined,
  toko: { min: number; jenis: JenisMinimum },
): { min: number; jenis: JenisMinimum | null } {
  return minBarang == null ? { min: toko.min, jenis: toko.jenis } : { min: minBarang, jenis: null };
}
