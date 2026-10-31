// Bukan aksi server: penolong murni, dipakai aksi retur pemasok dan rekonsiliasi WO.

/** Satu baris retur pemasok seperti yang disimpan di `VendorReturn.lines`. */
export type VendorReturnLineRow = {
  type: string;
  itemId: string;
  variantSku?: string | null;
  rollId?: string;
  qty: number | string;
  costValue: number | string;
};

/**
 * `VendorReturn.lines` disimpan sebagai TEKS JSON (`JSON.stringify` di penulis),
 * jadi kolom Json-nya terbaca sebagai string, bukan array. Baris lama yang
 * kebetulan tersimpan sebagai array tetap diterima; selain itu → [].
 */
export function parseVendorReturnLines(raw: unknown): VendorReturnLineRow[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as VendorReturnLineRow[]) : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as VendorReturnLineRow[];
  return [];
}

/** Retur yang stoknya sudah keluar: PROCESSED (diproses) dan COMPLETED (dikirim, bukti ada). */
export const STATUS_RETUR_STOK_KELUAR = ["PROCESSED", "COMPLETED"] as const;

/** Baris yang mengembalikan bahan (kain/aksesori), bukan barang jadi tolakan. */
export function barisBahan(baris: VendorReturnLineRow): boolean {
  return baris.type === "FABRIC" || baris.type === "ACCESSORIES";
}
