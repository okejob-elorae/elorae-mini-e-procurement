import type { StatusTone } from '@/components/ui/status-pill';
import type { TahapSiklus } from '@/lib/konsinyasi/aturan';

/**
 * Nada per tahap.
 *
 * `bayar_spg` merah, bukan kuning: gaji orang yang terlambat adalah keluhan
 * yang membuat program ini ada, dan warnanya harus menyebut itu.
 */
export const NADA_TAHAP: Record<TahapSiklus, StatusTone> = {
  laporan: 'waiting',
  cocok: 'progress',
  bayar_spg: 'attention',
  nota: 'progress',
  pajak: 'progress',
  selesai: 'settled',
};

export const URUT_TAHAP: TahapSiklus[] = [
  'laporan',
  'cocok',
  'bayar_spg',
  'nota',
  'pajak',
  'selesai',
];
