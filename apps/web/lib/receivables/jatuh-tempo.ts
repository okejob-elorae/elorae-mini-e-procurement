/**
 * "Lewat jatuh tempo" — tunggakan yang dihitung dari tanggal jatuh tempo
 * FAKTUR, terpisah dari "lewat janji bayar" yang dihitung dari kontrabon.
 *
 * Enam keadaan di `rules.ts` adalah keadaan uang. Yang ini keadaan TAMPILAN:
 * faktur `belum` (tanpa kontrabon, tanpa klaim, tanpa tahanan) yang jatuh
 * temponya sudah lewat. Dulu faktur seperti ini berlabel "tidak ada tunggakan"
 * dan tidak tercantum di daftar tindakan mana pun.
 *
 * Murni dan bebas Prisma — boleh diimpor komponen klien.
 */

import { tanggalWib } from '@/lib/dashboard/hari-wib';
import type { KeadaanPiutang } from './rules';

export type KeadaanTampil = KeadaanPiutang | 'jatuh_tempo';

/** Urutan tampil: yang menuntut tindakan lebih dulu. Satu urutan untuk semua layar kantor. */
export const URUT_KEADAAN_TAMPIL: readonly KeadaanTampil[] = [
  'lewat',
  'jatuh_tempo',
  'tertahan',
  'klaim',
  'tt',
  'belum',
  'lunas',
];

const HARI_MS = 86_400_000;

/**
 * Berapa hari kalender WIB faktur ini lewat jatuh tempo, atau `null`.
 *
 * Hanya keadaan `belum`. Kontrabon berjalan memakai janji bayarnya sendiri
 * (`lewat`), klaim yang menunggu berarti sales sudah melapor, dan tahanan retur
 * adalah aturan uang — ketiganya bukan tunggakan yang dikejar dari jatuh tempo.
 *
 * Dibandingkan per hari WIB: hari jatuh temponya sendiri belum lewat.
 */
export function hariLewatJatuhTempo(b: {
  keadaan: KeadaanPiutang;
  dueDate: Date;
  hariIni: Date;
}): number | null {
  if (b.keadaan !== 'belum') return null;
  const tempo = Date.parse(`${tanggalWib(b.dueDate)}T00:00:00Z`);
  const kini = Date.parse(`${tanggalWib(b.hariIni)}T00:00:00Z`);
  const hari = Math.round((kini - tempo) / HARI_MS);
  return hari > 0 ? hari : null;
}

export function keadaanTampil(b: {
  keadaan: KeadaanPiutang;
  hariLewatJatuhTempo: number | null;
}): KeadaanTampil {
  return b.keadaan === 'belum' && b.hariLewatJatuhTempo !== null ? 'jatuh_tempo' : b.keadaan;
}

/** `?keadaan=` dari alamat. Nilai lain diabaikan, bukan ditolak. */
export function bacaKeadaanTampil(raw: string | undefined | null): KeadaanTampil | null {
  return raw && (URUT_KEADAAN_TAMPIL as readonly string[]).includes(raw) ? (raw as KeadaanTampil) : null;
}
