'use server';

import {
  getDashboardStats as getDashboardStatsLib,
  getRawMaterialShortage as getRawMaterialShortageLib,
  getWorkOrderCountByStatus as getWorkOrderCountByStatusLib,
  getCOGSRawVsFinished as getCOGSRawVsFinishedLib,
  getSuppliersForReportFilter as getSuppliersForReportFilterLib,
} from '@/lib/dashboard/queries';

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
