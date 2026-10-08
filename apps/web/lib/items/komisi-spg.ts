/*
 * Komisi SPG per pcs (`Item.commissionPerPcs`, Decimal 15,2, wajib, bawaan 0)
 * dari formulir barang. Dipakai komisi SPG konsinyasi dan toko putus
 * (`lib/spg/komisi*`, `lib/konsinyasi`). Murni, aman di klien.
 *
 * Tiga keadaan seperti kg per roll: `undefined` = isian tidak dikirim (kolom
 * tidak disentuh), kosong/`null` = 0 (kolomnya tidak boleh kosong), angka =
 * disimpan, dibulatkan ke sen.
 */

export const MAKS_KOMISI_PER_PCS = 9_999_999_999_999.99;

/** Isian mentah → rupiah dua desimal; NaN untuk isian yang bukan angka (ditolak validasi). */
export function bacaKomisiPerPcs(nilai: unknown): number | undefined {
  if (nilai === undefined) return undefined;
  if (nilai === null || (typeof nilai === "string" && nilai.trim() === "")) return 0;
  const n = typeof nilai === "number" ? nilai : Number(String(nilai).trim().replace(",", "."));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100) / 100;
}

/**
 * Pesan galat "commissionPerPcs: …" atau null. Hanya barang jadi yang dijual
 * SPG, jadi bahan dan aksesori hanya menerima 0.
 */
export function periksaKomisiPerPcs(n: number | undefined, tipe: string): string | null {
  if (n === undefined) return null;
  if (!Number.isFinite(n) || n < 0 || n > MAKS_KOMISI_PER_PCS) return "commissionPerPcs: Isi angka 0 atau lebih";
  if (tipe !== "FINISHED_GOOD" && n > 0) return "commissionPerPcs: Komisi SPG hanya untuk barang jadi";
  return null;
}
