/**
 * Bentuk barang pilihan di layar SPG, dan pencariannya — murni, aman diimpor
 * komponen klien (modul `pilihan.ts` menarik Prisma dan hanya untuk server).
 */

export type BarisPilihan = {
  kunci: string;
  itemId: string;
  /** SKU induk barang — dipakai `cocokkanKode` untuk SKU tanpa ukuran. */
  sku: string;
  variantSku: string | null;
  /** Kode yang ditampilkan: SKU varian kalau ada, SKU barang kalau tidak. */
  kode: string;
  nama: string;
  varian: string | null;
  barcode: string | null;
  /** Saldo toko saat halaman dimuat. Boleh negatif. */
  stok: number;
  /** Sudah pernah bergerak di toko ini (ada di daftar stok). */
  dilacak: boolean;
};

/** Pencarian nama/SKU/varian/barcode, tanpa beda huruf besar-kecil. */
export function cocokCari(b: BarisPilihan, kata: string): boolean {
  const q = kata.trim().toLowerCase();
  if (!q) return true;
  return [b.nama, b.kode, b.sku, b.varian ?? "", b.barcode ?? ""].some((s) => s.toLowerCase().includes(q));
}
