/**
 * Nilai yang tampil pada kemajuan `k` (0–1) dari `dari` ke `ke`, easing kubik.
 * Target bulat (jumlah dokumen, unit) naik lewat bilangan bulat saja — tanpa
 * ini hitungan "3 PO" sempat terbaca "2,999" di tengah gerak.
 */
export function angkaAntara(dari: number, ke: number, k: number): number {
  if (k >= 1) return ke;
  const v = dari + (ke - dari) * (1 - Math.pow(1 - k, 3));
  return Number.isInteger(ke) ? Math.round(v) : v;
}
