/*
 * Kg per roll bahan (`Item.kgPerRoll`, Decimal 10,2) — dipakai kolom Roll di
 * formulir dan cetak PO: roll = ceil(qty ÷ kg per roll) untuk bahan bersatuan
 * kg. Murni, aman di klien.
 *
 * Tiga keadaan seperti info produk: `undefined` = isian tidak dikirim (kolom
 * tidak disentuh), `null` = dikosongkan, angka = disimpan.
 */

export const MAKS_KG_PER_ROLL = 99_999_999.99;

/** Isian mentah → kg per roll dua desimal; NaN untuk isian yang tidak sah (ditolak validasi). */
export function bacaKgPerRoll(nilai: unknown): number | null | undefined {
  if (nilai === undefined) return undefined;
  if (nilai === null || (typeof nilai === "string" && nilai.trim() === "")) return null;
  const n = typeof nilai === "number" ? nilai : Number(String(nilai).trim().replace(",", "."));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100) / 100;
}

/** Pesan galat "kgPerRoll: …" atau null. */
export function periksaKgPerRoll(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (!Number.isFinite(n) || n <= 0 || n > MAKS_KG_PER_ROLL) return "kgPerRoll: Isi angka lebih dari 0";
  return null;
}
