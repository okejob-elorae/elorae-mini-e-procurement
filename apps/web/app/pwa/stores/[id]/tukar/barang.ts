import type { BarangTukar } from "@/lib/salesman/tukar-queries";

/** Stok yang bisa diberikan untuk satu barang+varian (aturan yang sama dengan penulis). */
export function tersediaUntuk(barang: BarangTukar | undefined, variantSku: string): number {
  if (!barang) return 0;
  if (barang.varian.length === 0) return barang.tersedia;
  return barang.varian.find((v) => v.variantSku === variantSku)?.tersedia ?? 0;
}

export function labelVarian(barang: BarangTukar | undefined, variantSku: string): string | null {
  if (!barang || !variantSku) return null;
  return barang.varian.find((v) => v.variantSku === variantSku)?.label ?? variantSku;
}

export function namaBaris(barang: BarangTukar | undefined, itemId: string, variantSku: string): string {
  if (!barang) return itemId;
  const label = labelVarian(barang, variantSku);
  return label ? `${barang.nama} — ${label}` : barang.nama;
}
