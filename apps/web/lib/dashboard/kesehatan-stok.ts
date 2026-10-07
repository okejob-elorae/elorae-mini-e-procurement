import { summarizeStockHealth } from "@/lib/inventory/stock-status";

export type BarisStokBarang = {
  itemId: string;
  qtyOnHand: unknown;
  reservedQty: unknown;
  reorderPoint: unknown;
};

/**
 * Jumlah barang yang menipis, habis, dan minus — definisi YANG SAMA dengan
 * ringkasan Inventori (`getInventorySnapshot` → `summarizeStockHealth`): baris
 * varian dijumlah per barang, tersedia = Σ di tangan − Σ dipesan, dan satu
 * barang hanya masuk satu kelompok (minus > habis > menipis). Murni.
 */
export function kesehatanStokPerBarang(baris: readonly BarisStokBarang[]): {
  menipis: number;
  habis: number;
  minus: number;
} {
  const perBarang = new Map<string, { available: number; reorderPoint: number | null }>();
  for (const b of baris) {
    const tersedia = (Number(b.qtyOnHand) || 0) - (Number(b.reservedQty) || 0);
    const ada = perBarang.get(b.itemId);
    if (ada) ada.available += tersedia;
    else {
      const rp = b.reorderPoint === null || b.reorderPoint === undefined ? null : Number(b.reorderPoint);
      perBarang.set(b.itemId, { available: tersedia, reorderPoint: rp !== null && Number.isFinite(rp) ? rp : null });
    }
  }
  const h = summarizeStockHealth([...perBarang.values()]);
  return { menipis: h.menipisCount, habis: h.habisCount, minus: h.negatifCount };
}
