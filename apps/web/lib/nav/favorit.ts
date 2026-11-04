/**
 * Halaman yang disematkan pengguna.
 *
 * Menu ini berisi 53 tautan dalam 11 grup, tapi seseorang membuka tiga halaman
 * yang sama sepanjang hari — dan tiap kali harus membuka grupnya lagi. Sematan
 * mengangkat ketiganya ke atas.
 *
 * Disimpan di localStorage, BUKAN di basis data. Ini kebiasaan per perangkat
 * dan per orang, tidak menyangkut uang atau stok apa pun; menyimpannya di
 * server berarti sebuah migrasi dan satu bulatan jaringan untuk sesuatu yang
 * hilangnya tidak merugikan siapa pun.
 */

export const KUNCI_FAVORIT = 'elorae:nav-favorit';

/**
 * Batas jumlah sematan.
 *
 * Ada batasnya karena bagian yang disematkan dimaksudkan sebagai jalan pintas.
 * Sematan yang boleh sebanyak-banyaknya berakhir memuat seluruh menu sekali
 * lagi di atas menu — dan jalan pintas yang panjangnya sama dengan jalan
 * aslinya bukan jalan pintas.
 */
export const BATAS_FAVORIT = 6;

export function bacaFavorit(): string[] {
  try {
    const mentah = localStorage.getItem(KUNCI_FAVORIT);
    if (!mentah) return [];
    const isi: unknown = JSON.parse(mentah);
    // Isinya bisa apa saja — ditulis versi lama, atau diedit orang. Yang bukan
    // daftar teks diabaikan, tidak dilempar: menu yang gagal dirender gara-gara
    // sematan rusak mengunci orang di dalam aplikasi tanpa jalan.
    if (!Array.isArray(isi)) return [];
    return isi.filter((x): x is string => typeof x === 'string').slice(0, BATAS_FAVORIT);
  } catch {
    return [];
  }
}

export function tulisFavorit(daftar: string[]): void {
  try {
    localStorage.setItem(KUNCI_FAVORIT, JSON.stringify(daftar.slice(0, BATAS_FAVORIT)));
  } catch {
    // Mode penyamaran atau penyimpanan penuh. Sematannya hilang saat halaman
    // dimuat ulang, dan itu kerugian yang bisa diterima diam-diam.
  }
}

/**
 * Sematkan atau lepas.
 *
 * Yang sudah penuh MENOLAK menambah, bukan membuang yang paling lama. Membuang
 * diam-diam berarti sematan seseorang hilang tanpa ia pernah memintanya —
 * pemanggilnya yang memberi tahu bahwa sudah penuh.
 */
export function ubahFavorit(
  daftar: string[],
  href: string,
): { daftar: string[]; hasil: 'ditambah' | 'dilepas' | 'penuh' } {
  if (daftar.includes(href)) {
    return { daftar: daftar.filter((x) => x !== href), hasil: 'dilepas' };
  }
  if (daftar.length >= BATAS_FAVORIT) return { daftar, hasil: 'penuh' };
  return { daftar: [...daftar, href], hasil: 'ditambah' };
}
