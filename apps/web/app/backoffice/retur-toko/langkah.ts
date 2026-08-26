import type { StatusTone } from '@/components/ui/status-pill';
import type { LangkahRetur } from '@/lib/receivables/rules';

/**
 * Nada per langkah.
 *
 * `keputusan` merah karena uang berhenti di situ dan tidak ada seorang pun yang
 * merasa ditagih — keadaan yang bisa bertahan berbulan-bulan justru karena tak
 * ada yang merasa bertanggung jawab. `cek` kuning: bolanya jelas di gudang.
 */
export const NADA_LANGKAH: Record<LangkahRetur, StatusTone> = {
  keputusan: 'attention',
  cek: 'waiting',
  jodoh: 'progress',
  beres: 'settled',
  batal: 'inactive',
};

/** Urutan tampil: yang menuntut tindakan lebih dulu. */
export const URUT_LANGKAH: LangkahRetur[] = ['keputusan', 'cek', 'jodoh', 'beres', 'batal'];
