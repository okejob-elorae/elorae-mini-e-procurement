import type { BarisPilihan } from "../stok/barang-pilihan";

/**
 * Barang di layar opname tanpa angka sistem (hitungan buta): SPG menghitung
 * apa yang ada di rak, bukan mencocokkan dengan angka. Saldo sistem dan
 * selisihnya baru dinilai server saat opname disimpan.
 */
export type BarisPilihanButa = Omit<BarisPilihan, "stok">;

/** Pencarian nama/SKU/varian/barcode, tanpa beda huruf besar-kecil (sama dengan `cocokCari`). */
export function cocokCariButa(b: BarisPilihanButa, kata: string): boolean {
  const q = kata.trim().toLowerCase();
  if (!q) return true;
  return [b.nama, b.kode, b.sku, b.varian ?? "", b.barcode ?? ""].some((s) => s.toLowerCase().includes(q));
}
