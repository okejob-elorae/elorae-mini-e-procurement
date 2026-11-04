/**
 * Barang PUTUS hanya bisa dijual bila kantor sudah menetapkan harganya.
 *
 * Harga putus dihitung server (`computeStorePrice`); barang yang `sellingPrice`-nya
 * kosong atau 0 dulu lolos sebagai baris Rp 0 — pesanan yang nilainya hilang
 * tanpa ada yang menolak. Satu aturan untuk keranjang HP (`susunIsiUlang`) dan
 * penulis pesanan (`createFieldSalesOrder`). Bebas Prisma: diimpor komponen klien.
 * Konsinyasi tidak memakai aturan ini — salesman konsi tidak pernah membawa harga.
 */

export const KODE_TANPA_HARGA = "BARANG_TANPA_HARGA" as const;

/** Harga sah = angka terhingga di atas 0. null, 0, negatif, NaN = belum ada harga. */
export function hargaSah(harga: number | null | undefined): harga is number {
  return typeof harga === "number" && Number.isFinite(harga) && harga > 0;
}

/**
 * Barang (sekali per barang, urut keranjang) yang harganya tidak sah. Barang
 * yang tidak ada di peta harga (tidak dikenal) ikut dihitung tanpa harga.
 */
export function barangTanpaHarga(itemIds: readonly string[], hargaPerBarang: ReadonlyMap<string, number | null>): string[] {
  const hasil: string[] = [];
  for (const id of itemIds) {
    if (hasil.includes(id)) continue;
    if (!hargaSah(hargaPerBarang.get(id))) hasil.push(id);
  }
  return hasil;
}

/** Pesanan PUTUS memuat barang tanpa harga — tidak ada yang tercatat. */
export class BarangTanpaHargaError extends Error {
  constructor(readonly itemIds: string[]) {
    super(KODE_TANPA_HARGA);
    this.name = "BarangTanpaHargaError";
  }
}
