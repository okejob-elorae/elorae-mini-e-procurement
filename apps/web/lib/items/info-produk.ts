/**
 * Tiga isian "info produk untuk pembeli" di formulir barang — bahan, cara
 * rawat, tabel ukuran — dirapikan sebelum disimpan. Murni, aman di klien.
 *
 * Bedakan tiga keadaan, karena `updateItem` meneruskan isian apa adanya ke
 * Prisma: `undefined` = isian tidak dikirim, kolomnya TIDAK disentuh
 * (pemanggil lain yang tidak tahu kolom ini tidak menghapusnya); `null` =
 * dikosongkan; teks = disimpan. Untuk tabel ukuran, `null` berarti "ikut
 * bawaan kategori".
 */

export const BATAS_INFO_PRODUK = { material: 200, careInstructions: 2000 } as const;

export type InfoProdukBarang = {
  material?: string | null;
  careInstructions?: string | null;
  sizeChartId?: string | null;
};

function teks(v: unknown, multiBaris: boolean): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = multiBaris ? String(v).replace(/\r\n/g, "\n").trim() : String(v).trim().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

/** Ambil dan rapikan tiga isian dari muatan mentah formulir. */
export function bacaInfoProduk(raw: Record<string, unknown>): InfoProdukBarang {
  return {
    material: teks(raw.material, false),
    careInstructions: teks(raw.careInstructions, true),
    sizeChartId: teks(raw.sizeChartId, false),
  };
}

/** Pesan galat berformat "kolom: pesan" seperti validasi barang lainnya, atau null. */
export function periksaInfoProduk(p: InfoProdukBarang): string | null {
  if (p.material && p.material.length > BATAS_INFO_PRODUK.material) {
    return `material: Maksimal ${BATAS_INFO_PRODUK.material} karakter`;
  }
  if (p.careInstructions && p.careInstructions.length > BATAS_INFO_PRODUK.careInstructions) {
    return `careInstructions: Maksimal ${BATAS_INFO_PRODUK.careInstructions} karakter`;
  }
  return null;
}
