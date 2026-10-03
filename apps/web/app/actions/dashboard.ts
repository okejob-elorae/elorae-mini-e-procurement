'use server';

import {
  getDashboardStats as getDashboardStatsLib,
  getRawMaterialShortage as getRawMaterialShortageLib,
  getWorkOrderCountByStatus as getWorkOrderCountByStatusLib,
  getCOGSRawVsFinished as getCOGSRawVsFinishedLib,
  getSuppliersForReportFilter as getSuppliersForReportFilterLib,
  getTrenPenjualanRentang,
} from '@/lib/dashboard/queries';
import { auth } from '@/lib/auth';
import type { TitikTren } from '@/lib/dashboard/tren';

export async function getDashboardStats() {
  return getDashboardStatsLib();
}

export async function getRawMaterialShortage() {
  return getRawMaterialShortageLib();
}

export async function getWorkOrderCountByStatus() {
  return getWorkOrderCountByStatusLib();
}

export async function getCOGSRawVsFinished() {
  return getCOGSRawVsFinishedLib();
}

export async function getSuppliersForReportFilter() {
  return getSuppliersForReportFilterLib();
}

/**
 * Grafik tren beranda untuk rentang tanggal pilihan pengguna. Mengembalikan
 * kode, bukan melempar: pesan galat server di produksi disamarkan jadi digest
 * dan tidak bisa dibaca layar.
 */
export async function ambilTrenPenjualanRentang(
  mulai: string,
  akhir: string,
): Promise<{ ok: true; tren: TitikTren[] } | { ok: false; code: 'UNAUTHENTICATED' | 'INVALID_RANGE' }> {
  const session = await auth();
  if (!session?.user) return { ok: false, code: 'UNAUTHENTICATED' };
  const tren = await getTrenPenjualanRentang(mulai, akhir);
  if (!tren) return { ok: false, code: 'INVALID_RANGE' };
  return { ok: true, tren };
}
