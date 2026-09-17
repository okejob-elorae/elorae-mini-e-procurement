import { ATURAN_HARMONI, JUMLAH_WARNA, type AturanHarmoni } from './harmoni';
import { normalisasiHex } from './warna';

export const BATAS_NAMA_PALET = 60;

export type AlasanPaletTidakSah =
  | 'NAMA_KOSONG'
  | 'NAMA_TERLALU_PANJANG'
  | 'ATURAN_TIDAK_DIKENAL'
  | 'WARNA_TIDAK_SAH';

export type IsiPalet = { nama: string; aturan: AturanHarmoni; warna: string[] };

/**
 * Penjaga palet sebelum disimpan.
 *
 * Masukannya `unknown` dengan sengaja: aksi server bisa dipanggil langsung,
 * tanpa melewati roda, jadi tidak ada satu pun bentuk yang boleh diandaikan.
 * Warna disimpan sudah dirapikan (`#rrggbb` huruf kecil) supaya dua palet yang
 * sama tidak tampak berbeda hanya karena cara mengetiknya.
 */
export function periksaPalet(masukan: {
  nama: unknown;
  aturan: unknown;
  warna: unknown;
}): { ok: true; isi: IsiPalet } | { ok: false; alasan: AlasanPaletTidakSah } {
  const nama = typeof masukan.nama === 'string' ? masukan.nama.trim() : '';
  if (!nama) return { ok: false, alasan: 'NAMA_KOSONG' };
  if (nama.length > BATAS_NAMA_PALET) return { ok: false, alasan: 'NAMA_TERLALU_PANJANG' };

  if (!(ATURAN_HARMONI as readonly unknown[]).includes(masukan.aturan)) {
    return { ok: false, alasan: 'ATURAN_TIDAK_DIKENAL' };
  }

  if (!Array.isArray(masukan.warna) || masukan.warna.length !== JUMLAH_WARNA) {
    return { ok: false, alasan: 'WARNA_TIDAK_SAH' };
  }
  const warna: string[] = [];
  for (const w of masukan.warna) {
    const bersih = typeof w === 'string' ? normalisasiHex(w) : null;
    if (!bersih) return { ok: false, alasan: 'WARNA_TIDAK_SAH' };
    warna.push(bersih);
  }

  return { ok: true, isi: { nama, aturan: masukan.aturan as AturanHarmoni, warna } };
}
