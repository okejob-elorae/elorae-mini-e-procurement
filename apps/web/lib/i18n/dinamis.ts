import type { useTranslations } from 'next-intl';

/**
 * Terjemahan dengan kunci yang dirakit saat berjalan.
 *
 * `useTranslations` mengetikkan kuncinya sebagai literal, jadi kunci yang
 * dirakit dari data (`why_${keadaan}`) tidak bisa diketikkan — dan cast di
 * tempat memaksa setiap pemanggil mengarang bentuk castnya sendiri, yang
 * sebagian di antaranya akan salah.
 *
 * Dipakai HANYA untuk kunci yang berasal dari nilai terbatas dan diketahui
 * (keadaan, langkah, status). Kunci dari masukan pengguna tidak boleh lewat
 * sini — ia akan menampilkan kuncinya sendiri saat tidak ketemu.
 */
export type TerjemahDinamis = (
  kunci: string,
  nilai?: Record<string, string | number>,
) => string;

export function dinamis(t: ReturnType<typeof useTranslations>): TerjemahDinamis {
  return t as unknown as TerjemahDinamis;
}
