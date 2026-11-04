/**
 * "Sudah ada PO" di Dasbor Plan Kerja (2026-10-07): qty tahap yang punya ≥ 1 PO
 * tidak batal, dijumlah per jenis (kategori plan) — induk menjumlah semua
 * turunannya. Murni: kueri menyerahkan pohon kategori dan tahap ber-PO saja.
 *
 * Satu definisi "punya PO" dengan tab Kalender (`tahapBulan`/`ikhtisarJadwalTahun`):
 * PO yang `status` ≠ CANCELLED dan `planStageId` = tahap itu.
 */

export type SimpulKategori = { id: string; children: readonly SimpulKategori[] };

/** Σ targetQty tahap ber-PO per kategori, termasuk semua turunannya. Kategori tanpa tahap ber-PO = 0. */
export function qtySudahAdaPoPerKategori(
  pohon: readonly SimpulKategori[],
  tahapBerPo: readonly { planCategoryId: string; targetQty: number }[],
): Map<string, number> {
  const langsung = new Map<string, number>();
  for (const t of tahapBerPo) {
    langsung.set(t.planCategoryId, (langsung.get(t.planCategoryId) ?? 0) + t.targetQty);
  }
  const hasil = new Map<string, number>();
  const jumlah = (simpul: SimpulKategori): number => {
    const total = simpul.children.reduce((s, anak) => s + jumlah(anak), langsung.get(simpul.id) ?? 0);
    hasil.set(simpul.id, total);
    return total;
  };
  for (const akar of pohon) jumlah(akar);
  return hasil;
}

/** Total plan: Σ akar (tahap di kategori yang tidak ada di pohon tidak ikut). */
export function totalSudahAdaPo(pohon: readonly SimpulKategori[], perKategori: ReadonlyMap<string, number>): number {
  return pohon.reduce((s, akar) => s + (perKategori.get(akar.id) ?? 0), 0);
}
