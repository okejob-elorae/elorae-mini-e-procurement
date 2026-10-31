import type { StatusTone } from '@/components/ui/status-pill';
import type { TahapSiklusLengkap } from '@/lib/konsinyasi/queries';

/**
 * Nada per tahap.
 *
 * `bayar_spg` merah, bukan kuning: gaji orang yang terlambat adalah keluhan
 * yang membuat program ini ada, dan warnanya harus menyebut itu.
 * `bayar_toko` kuning: uang toko yang belum masuk perlu dikejar, tapi tidak ada
 * orang kita yang belum digaji karenanya.
 */
export const NADA_TAHAP: Record<TahapSiklusLengkap, StatusTone> = {
  laporan: 'waiting',
  cocok: 'progress',
  bayar_spg: 'attention',
  nota: 'progress',
  pajak: 'progress',
  bayar_toko: 'waiting',
  selesai: 'settled',
};

export const URUT_TAHAP: TahapSiklusLengkap[] = [
  'laporan',
  'cocok',
  'bayar_spg',
  'nota',
  'pajak',
  'bayar_toko',
  'selesai',
];
