"use server";

import {
  getDashboardStats as getDashboardStatsLib,
  getRawMaterialShortage as getRawMaterialShortageLib,
  getWorkOrderCountByStatus as getWorkOrderCountByStatusLib,
  getCOGSRawVsFinished as getCOGSRawVsFinishedLib,
  getSuppliersForReportFilter as getSuppliersForReportFilterLib,
  getTrenPenjualanRentang,
} from "@/lib/dashboard/queries";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS, requirePermission } from "@/lib/rbac";
import type { TitikTren } from "@/lib/dashboard/tren";

/**
 * Setiap ekspor berkas ini adalah titik akhir yang bisa dipanggil siapa pun
 * yang sudah masuk, jadi pagarnya di sini — sama dengan halaman beranda
 * (`dashboard:view`), sebelum satu kueri pun berjalan. Melempar seperti
 * `requirePermission`, supaya bentuk kembalian untuk yang sah tidak berubah.
 */
async function wajibBolehLihatBeranda(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  requirePermission(session.user.permissions ?? [], PERMISSIONS.DASHBOARD_VIEW);
}

export async function getDashboardStats() {
  await wajibBolehLihatBeranda();
  return getDashboardStatsLib();
}

export async function getRawMaterialShortage() {
  await wajibBolehLihatBeranda();
  return getRawMaterialShortageLib();
}

export async function getWorkOrderCountByStatus() {
  await wajibBolehLihatBeranda();
  return getWorkOrderCountByStatusLib();
}

export async function getCOGSRawVsFinished() {
  await wajibBolehLihatBeranda();
  return getCOGSRawVsFinishedLib();
}

export async function getSuppliersForReportFilter() {
  await wajibBolehLihatBeranda();
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
): Promise<
  { ok: true; tren: TitikTren[] } | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_RANGE" }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, code: "UNAUTHENTICATED" };
  // Angka penjualan seluruh saluran — hanya untuk yang boleh membuka beranda.
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.DASHBOARD_VIEW)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const tren = await getTrenPenjualanRentang(mulai, akhir);
  if (!tren) return { ok: false, code: "INVALID_RANGE" };
  return { ok: true, tren };
}
