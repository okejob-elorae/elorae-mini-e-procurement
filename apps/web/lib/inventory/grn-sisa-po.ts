/**
 * Angka PO per baris di formulir GRN: dipesan, sudah diterima GRN lain, sisa.
 *
 * Gudang dulu harus membuka rincian PO di tab lain untuk tahu berapa yang
 * seharusnya datang. Qty TIDAK diisi otomatis saat formulir dibuka — gudang
 * menghitung barang yang benar-benar datang; "Isi sisa" mengisinya dengan satu
 * ketukan bila memang datang lengkap. Murni, dites tanpa basis data.
 */

export type BarisAngkaPo = {
  itemType?: string;
  qty: number;
  poOrderedQty?: number | null;
  poAlreadyReceivedQty?: number | null;
};

/** Sisa yang belum diterima, atau null bila baris tidak berasal dari PO. */
export function sisaPo(b: Pick<BarisAngkaPo, "poOrderedQty" | "poAlreadyReceivedQty">): number | null {
  if (b.poOrderedQty == null || !Number.isFinite(b.poOrderedQty)) return null;
  const sudah = b.poAlreadyReceivedQty != null && Number.isFinite(b.poAlreadyReceivedQty) ? b.poAlreadyReceivedQty : 0;
  return Math.max(0, Math.round((b.poOrderedQty - sudah) * 100) / 100);
}

/** Qty yang diketik melebihi sisa PO (penerimaan lebih butuh persetujuan pemilik). */
export function lebihDariSisa(b: BarisAngkaPo): boolean {
  const sisa = sisaPo(b);
  return sisa != null && b.qty > sisa + 1e-9;
}

/** Kain dihitung dari panjang roll, jadi tidak bisa diisi dengan satu angka sisa. */
export function bisaDiisiSisa(b: BarisAngkaPo): boolean {
  const sisa = sisaPo(b);
  return b.itemType !== "FABRIC" && sisa != null && sisa > 0;
}

/**
 * "Isi semua dengan sisa": hanya baris bukan kain yang qty-nya masih kosong —
 * angka yang sudah diketik gudang tidak pernah ditimpa.
 */
export function isiKosongDenganSisa<T extends BarisAngkaPo>(baris: T[]): T[] {
  return baris.map((b) => (bisaDiisiSisa(b) && !(b.qty > 0) ? { ...b, qty: sisaPo(b) as number } : b));
}

/** Ada baris yang bisa diisi oleh "Isi semua dengan sisa"? */
export function adaYangBisaDiisi(baris: BarisAngkaPo[]): boolean {
  return baris.some((b) => bisaDiisiSisa(b) && !(b.qty > 0));
}
