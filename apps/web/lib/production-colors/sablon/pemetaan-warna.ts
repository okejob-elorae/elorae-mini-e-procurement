import { normalisasiHex } from '../palet/warna';
import { rapikanNama } from './nama-warna';

/**
 * Pemetaan nama warna varian yang tidak dikenal kamus → hex, dipakai bersama
 * seluruh tim. Kuncinya `rapikanNama`, jadi "GALAXY!" dan "galaxy" satu entri.
 */
export const KUNCI_PEMETAAN_WARNA = 'production.print.colorNames';
export const BATAS_PEMETAAN = 300;
const BATAS_NAMA = 60;

export type PemetaanWarna = Record<string, string>;

/** Isi pengaturan yang rusak atau asing tidak boleh merobohkan halaman: entri yang tidak sah dilewati. */
export function bacaPemetaan(value: string | null): PemetaanWarna {
  if (!value) return {};
  let mentah: unknown;
  try {
    mentah = JSON.parse(value);
  } catch {
    return {};
  }
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) return {};
  const hasil: PemetaanWarna = {};
  for (const [k, v] of Object.entries(mentah)) {
    const kunci = rapikanNama(k);
    const hex = typeof v === 'string' ? normalisasiHex(v) : null;
    if (kunci && kunci.length <= BATAS_NAMA && hex) hasil[kunci] = hex;
  }
  return hasil;
}

export type AlasanPemetaanTidakSah = 'NAMA_KOSONG' | 'NAMA_TERLALU_PANJANG' | 'HEX_TIDAK_SAH' | 'TERLALU_BANYAK';

/** Tambah, ganti, atau hapus (`hex` null) satu pemetaan. Masukan `unknown`: aksi server bisa dipanggil langsung. */
export function ubahPemetaan(
  peta: PemetaanWarna,
  nama: unknown,
  hex: unknown,
): { ok: true; peta: PemetaanWarna } | { ok: false; alasan: AlasanPemetaanTidakSah } {
  const kunci = typeof nama === 'string' ? rapikanNama(nama) : '';
  if (!kunci) return { ok: false, alasan: 'NAMA_KOSONG' };
  if (kunci.length > BATAS_NAMA) return { ok: false, alasan: 'NAMA_TERLALU_PANJANG' };
  const baru = { ...peta };
  if (hex === null) {
    delete baru[kunci];
    return { ok: true, peta: baru };
  }
  const bersih = typeof hex === 'string' ? normalisasiHex(hex) : null;
  if (!bersih) return { ok: false, alasan: 'HEX_TIDAK_SAH' };
  if (!(kunci in baru) && Object.keys(baru).length >= BATAS_PEMETAAN) return { ok: false, alasan: 'TERLALU_BANYAK' };
  baru[kunci] = bersih;
  return { ok: true, peta: baru };
}
