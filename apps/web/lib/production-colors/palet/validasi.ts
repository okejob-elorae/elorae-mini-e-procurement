import { JUMLAH_SABLON_MAKS } from '../sablon/saran';
import { ATURAN_HARMONI, JUMLAH_WARNA, type AturanHarmoni } from './harmoni';
import { normalisasiHex } from './warna';

export const BATAS_NAMA_PALET = 60;

export type AlasanPaletTidakSah =
  | 'NAMA_KOSONG'
  | 'NAMA_TERLALU_PANJANG'
  | 'ATURAN_TIDAK_DIKENAL'
  | 'WARNA_TIDAK_SAH'
  | 'KAIN_TIDAK_SAH'
  | 'PORSI_TIDAK_SAH';

export type IsiPalet = {
  nama: string;
  aturan: AturanHarmoni;
  warna: string[];
  kain: string | null;
  porsi: number[] | null;
};

/**
 * Penjaga palet sebelum disimpan.
 *
 * Masukannya `unknown` dengan sengaja: aksi server bisa dipanggil langsung,
 * tanpa melewati roda, jadi tidak ada satu pun bentuk yang boleh diandaikan.
 * Warna disimpan sudah dirapikan (`#rrggbb` huruf kecil) supaya dua palet yang
 * sama tidak tampak berbeda hanya karena cara mengetiknya.
 *
 * Dua bentuk sah. Palet bebas: tepat lima warna, tanpa porsi — porsi yang
 * terkirim dibuang, bukan disimpan diam-diam. Palet berkain: satu sampai enam
 * warna sablon, porsi sejajar dengan warnanya, dan berjumlah tepat 100 —
 * lembar untuk tukang sablon tidak boleh berisi desain 90%.
 */
export function periksaPalet(masukan: {
  nama: unknown;
  aturan: unknown;
  warna: unknown;
  kain?: unknown;
  porsi?: unknown;
}): { ok: true; isi: IsiPalet } | { ok: false; alasan: AlasanPaletTidakSah } {
  const nama = typeof masukan.nama === 'string' ? masukan.nama.trim() : '';
  if (!nama) return { ok: false, alasan: 'NAMA_KOSONG' };
  if (nama.length > BATAS_NAMA_PALET) return { ok: false, alasan: 'NAMA_TERLALU_PANJANG' };

  if (!(ATURAN_HARMONI as readonly unknown[]).includes(masukan.aturan)) {
    return { ok: false, alasan: 'ATURAN_TIDAK_DIKENAL' };
  }

  let kain: string | null = null;
  if (masukan.kain !== undefined && masukan.kain !== null) {
    kain = typeof masukan.kain === 'string' ? normalisasiHex(masukan.kain) : null;
    if (!kain) return { ok: false, alasan: 'KAIN_TIDAK_SAH' };
  }

  const jumlahSah = (n: number) => (kain ? n >= 1 && n <= JUMLAH_SABLON_MAKS : n === JUMLAH_WARNA);
  if (!Array.isArray(masukan.warna) || !jumlahSah(masukan.warna.length)) {
    return { ok: false, alasan: 'WARNA_TIDAK_SAH' };
  }
  const warna: string[] = [];
  for (const w of masukan.warna) {
    const bersih = typeof w === 'string' ? normalisasiHex(w) : null;
    if (!bersih) return { ok: false, alasan: 'WARNA_TIDAK_SAH' };
    warna.push(bersih);
  }

  let porsi: number[] | null = null;
  if (kain) {
    const p = masukan.porsi;
    if (
      !Array.isArray(p) ||
      p.length !== warna.length ||
      !p.every((x) => Number.isInteger(x) && x >= 0 && x <= 100) ||
      p.reduce((s: number, x: number) => s + x, 0) !== 100
    ) {
      return { ok: false, alasan: 'PORSI_TIDAK_SAH' };
    }
    porsi = p as number[];
  }

  return { ok: true, isi: { nama, aturan: masukan.aturan as AturanHarmoni, warna, kain, porsi } };
}
