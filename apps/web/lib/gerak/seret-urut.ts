/**
 * Seret-lepas untuk daftar berurutan — hitungan murni (2026-10-07).
 *
 * Dipakai `components/gerak/useSeretUrut.ts` (pointer event, mouse dan jari)
 * dan oleh layar yang menyimpan hasilnya. Istilah:
 *  - `celah` = tempat sisip 0..n pada daftar SEBELUM butir diangkat:
 *    0 = di atas butir pertama, n = di bawah butir terakhir;
 *  - `indeks tujuan` = posisi akhir butir sesudah dipindah (0..n-1).
 *
 * Panah ↑/↓ tetap ada di setiap layar sebagai jalan papan ketik; seret hanya
 * jalan pintas.
 */

/** Gerak minimal (px) sebelum tekanan menjadi seretan — klik biasa tetap klik. */
export const AMBANG_SERET_PX = 6;

/** Jarak dari tepi wadah (px) tempat gulir otomatis mulai bekerja. */
export const TEPI_GULIR_PX = 48;

/** Laju gulir otomatis tertinggi (px per bingkai). */
export const LAJU_GULIR_MAKS = 18;

/** Sudah cukup jauh bergerak untuk dianggap seretan? */
export function lewatAmbang(dx: number, dy: number, ambang: number = AMBANG_SERET_PX): boolean {
  return dx * dx + dy * dy >= ambang * ambang;
}

/**
 * Celah sisip di bawah penunjuk: banyaknya butir yang titik tengahnya berada
 * di atas `posisi`. `tengah` = titik tengah vertikal tiap butir, urut tampil.
 */
export function celahSisip(tengah: readonly number[], posisi: number): number {
  let n = 0;
  for (const t of tengah) if (t < posisi) n += 1;
  return n;
}

/** Posisi akhir butir `dari` bila dilepas di `celah` (celah dihitung sebelum diangkat). */
export function indeksTujuan(dari: number, celah: number): number {
  return celah > dari ? celah - 1 : celah;
}

/** Celah tepat di atas atau di bawah butir itu sendiri — urutan tidak berubah. */
export function celahDiam(dari: number, celah: number): boolean {
  return celah === dari || celah === dari + 1;
}

/** Salinan larik dengan butir `dari` dipindah ke posisi `ke`. Indeks di luar batas → salinan apa adanya. */
export function pindahkan<T>(larik: readonly T[], dari: number, ke: number): T[] {
  const hasil = [...larik];
  if (!Number.isInteger(dari) || !Number.isInteger(ke)) return hasil;
  if (dari < 0 || dari >= hasil.length || ke < 0 || ke >= hasil.length || dari === ke) return hasil;
  const [butir] = hasil.splice(dari, 1);
  hasil.splice(ke, 0, butir);
  return hasil;
}

/** Salinan larik dengan `butir` disisipkan di `celah` (dijepit ke 0..n). */
export function sisipkan<T>(larik: readonly T[], butir: T, celah: number): T[] {
  const hasil = [...larik];
  const c = Number.isFinite(celah) ? Math.min(Math.max(Math.trunc(celah), 0), hasil.length) : hasil.length;
  hasil.splice(c, 0, butir);
  return hasil;
}

/**
 * Laju gulir otomatis (px per bingkai) saat penunjuk dekat tepi atas/bawah
 * wadah: negatif = ke atas, 0 = diam. Makin dekat (atau melewati) tepi, makin
 * cepat, sampai `maks`. Wadah pendek memakai seperempat tingginya sebagai tepi.
 */
export function lajuGulir(
  y: number,
  atas: number,
  bawah: number,
  tepi: number = TEPI_GULIR_PX,
  maks: number = LAJU_GULIR_MAKS,
): number {
  const t = Math.min(tepi, (bawah - atas) / 4);
  if (!(t > 0)) return 0;
  if (y < atas + t) return -Math.ceil(maks * Math.min(1, (atas + t - y) / t));
  if (y > bawah - t) return Math.ceil(maks * Math.min(1, (y - (bawah - t)) / t));
  return 0;
}
