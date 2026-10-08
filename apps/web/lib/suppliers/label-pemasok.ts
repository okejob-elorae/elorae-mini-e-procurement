/**
 * SATU cara menulis pemasok di pilihan formulir: "Nama (KODE)", diurut menurut
 * nama — sama dengan daftar Pembayaran pemasok. Dulu PO baru menulis
 * "SUP0005 - CV Lainnya" tanpa urutan, GRN "SUP0001 – PT Kain Indah" urut abjad,
 * dan Pembayaran pemasok "PT Kain Indah (SUP0001)". Murni, aman untuk klien.
 */
export type PemasokBerlabel = { code: string; name: string };

export function labelPemasok(p: PemasokBerlabel): string {
  const nama = p.name.trim();
  const kode = p.code.trim();
  if (!kode) return nama;
  if (!nama) return kode;
  return `${nama} (${kode})`;
}

export function urutPemasok<T extends PemasokBerlabel>(daftar: readonly T[]): T[] {
  return [...daftar].sort((a, b) => a.name.localeCompare(b.name, "id", { sensitivity: "base" }) || a.code.localeCompare(b.code));
}
