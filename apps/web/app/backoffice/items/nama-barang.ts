/**
 * Nama Inggris barang tidak wajib diisi di formulir. Kolom `Item.nameEn` di
 * basis data tetap terisi: bila kosong, nama Indonesia dipakai — itu juga yang
 * selama ini tampil di daftar berbahasa Inggris dan yang dikirim ke Jubelio.
 */
export function namaInggrisAtauIndonesia(nameEn: string | null | undefined, nameId: string): string {
  const en = (nameEn ?? "").trim();
  return en || nameId.trim();
}

/** Rapikan nama sebelum dikirim ke server: pangkas spasi, isi nameEn yang kosong. */
export function rapikanNamaBarang<T extends { nameId: string; nameEn?: string | null }>(isian: T): T & { nameEn: string } {
  return { ...isian, nameId: isian.nameId.trim(), nameEn: namaInggrisAtauIndonesia(isian.nameEn, isian.nameId) };
}
