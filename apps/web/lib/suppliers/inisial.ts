/** Bentuk badan usaha di depan nama — tidak dipakai sebagai inisial. */
const AWALAN = /^(pt|cv|ud|pd|fa|toko|tk|koperasi)\.?\s+/i;

/**
 * Dua huruf untuk lingkaran nama pemasok: "PT Kain Indah" → "KI",
 * "Penjahit Pak Budi" → "PP", "JOHAN" → "JO", "UD KHARISMA" → "KH".
 */
export function inisialPemasok(nama: string | null | undefined): string {
  const bersih = (nama ?? "").trim().replace(AWALAN, "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const kata = bersih.split(/\s+/).filter(Boolean);
  if (kata.length === 0) return "?";
  if (kata.length === 1) return kata[0].slice(0, 2).toUpperCase();
  return (kata[0][0] + kata[1][0]).toUpperCase();
}
