import dataC from '../palet/pantone-c.json';
import { normalisasiHex } from '../palet/warna';

/**
 * Tinta dasar yang dimiliki tukang sablon — bahan untuk resep campur.
 *
 * Disimpan di `SystemSetting`, satu daftar untuk seluruh tim: tinta ada di
 * gudang sablon, bukan di laptop masing-masing orang.
 */

export type TintaDasar = { nama: string; hex: string; kode: string | null };

export const KUNCI_TINTA_DASAR = 'production.print.baseInks';
export const BATAS_TINTA_DASAR = 16;
const BATAS_NAMA = 40;

/**
 * Empat belas warna dasar PANTONE Formula Guide — setiap warna Coated C adalah
 * campuran dari sini — ditambah putih, yang di sablon hampir selalu ada.
 */
const KODE_DASAR_PANTONE = [
  'Yellow C',
  'Yellow 012 C',
  'Orange 021 C',
  'Warm Red C',
  'Red 032 C',
  'Rubine Red C',
  'Rhodamine Red C',
  'Purple C',
  'Violet C',
  'Blue 072 C',
  'Reflex Blue C',
  'Process Blue C',
  'Green C',
  'Black C',
];

export function presetTintaPantone(): TintaDasar[] {
  const hexPer = new Map(dataC as [string, string][]);
  const pantone = KODE_DASAR_PANTONE.flatMap((kode) => {
    const hex = hexPer.get(kode);
    return hex ? [{ nama: kode.replace(/ C$/, ''), hex, kode }] : [];
  });
  return [...pantone, { nama: 'Putih', hex: '#ffffff', kode: null }];
}

export type AlasanTintaTidakSah = 'BUKAN_DAFTAR' | 'TERLALU_BANYAK' | 'NAMA_KOSONG' | 'HEX_TIDAK_SAH' | 'NAMA_KEMBAR';

/** Masukan `unknown` dengan sengaja: aksi server bisa dipanggil tanpa melewati layar. */
export function periksaTintaDasar(
  masukan: unknown,
): { ok: true; tinta: TintaDasar[] } | { ok: false; alasan: AlasanTintaTidakSah } {
  if (!Array.isArray(masukan)) return { ok: false, alasan: 'BUKAN_DAFTAR' };
  if (masukan.length > BATAS_TINTA_DASAR) return { ok: false, alasan: 'TERLALU_BANYAK' };

  const tinta: TintaDasar[] = [];
  const nama = new Set<string>();
  for (const baris of masukan) {
    const b = (baris ?? {}) as Record<string, unknown>;
    const n = typeof b.nama === 'string' ? b.nama.trim().slice(0, BATAS_NAMA) : '';
    if (!n) return { ok: false, alasan: 'NAMA_KOSONG' };
    const hex = typeof b.hex === 'string' ? normalisasiHex(b.hex) : null;
    if (!hex) return { ok: false, alasan: 'HEX_TIDAK_SAH' };
    if (nama.has(n.toLowerCase())) return { ok: false, alasan: 'NAMA_KEMBAR' };
    nama.add(n.toLowerCase());
    tinta.push({ nama: n, hex, kode: typeof b.kode === 'string' && b.kode.trim() ? b.kode.trim() : null });
  }
  return { ok: true, tinta };
}

/**
 * Nilai tersimpan → daftar. Isi yang rusak dibaca sebagai kosong: nilai
 * pengaturan bisa disunting tangan, dan halamannya harus tetap terbuka supaya
 * orang bisa menyusunnya ulang.
 */
export function bacaTintaDasar(nilai: string | null): TintaDasar[] {
  if (!nilai) return [];
  try {
    const hasil = periksaTintaDasar(JSON.parse(nilai));
    return hasil.ok ? hasil.tinta : [];
  } catch {
    return [];
  }
}
