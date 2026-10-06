/*
 * Angka utang untuk register pembayaran pemasok. `listPOs` sudah menghitung
 * `utang` per baris (total PO − sisa yang tidak akan datang karena "Tutup PO"
 * − kredit retur pemasok, lihat `lib/purchase-orders/utang.ts`); register
 * memakai angka itu, bukan total PO penuh. Baris tanpa `utang` jatuh ke total PO.
 * Tampilan saja — jurnal pembayaran pemasok tetap membaca GL.
 */

type Angka = number | string | { toString(): string } | null | undefined;

function angka(v: Angka): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

export function utangBaris(po: { grandTotal: Angka; utang?: { utang: Angka } | null }): number {
  return po.utang ? angka(po.utang.utang) : angka(po.grandTotal);
}

/** Σ utang PO yang belum dibayar, dijumlah dalam sen supaya tidak tersisa pecahan floating-point. */
export function totalUtangBelumDibayar(rows: ReadonlyArray<{ paidAt: Date | null; utang: number }>): number {
  const sen = rows.filter((r) => !r.paidAt).reduce((s, r) => s + Math.round(r.utang * 100), 0);
  return sen / 100;
}
