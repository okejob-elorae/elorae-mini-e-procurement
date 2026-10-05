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
import { kartuBeranda, statistikBeranda } from "@/app/backoffice/dashboard/kartu-beranda";

/**
 * Setiap ekspor berkas ini adalah titik akhir yang bisa dipanggil siapa pun
 * yang sudah masuk, jadi pagarnya di sini — sama dengan halaman beranda
 * (`dashboard:view`), sebelum satu kueri pun berjalan. Melempar seperti
 * `requirePermission`, supaya bentuk kembalian untuk yang sah tidak berubah.
 */
async function wajibBolehLihatBeranda(): Promise<string[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const izin = session.user.permissions ?? [];
  requirePermission(izin, PERMISSIONS.DASHBOARD_VIEW);
  return izin;
}

/** Bentuk yang sama dengan yang dikirim halaman beranda — tanpa nilai rupiah yang tidak digambar. */
export async function getDashboardStats() {
  const izin = await wajibBolehLihatBeranda();
  return statistikBeranda(await getDashboardStatsLib(), kartuBeranda(izin));
}

export async function getRawMaterialShortage() {
  await wajibBolehLihatBeranda();
  return getRawMaterialShortageLib();
}

export async function getWorkOrderCountByStatus() {
  await wajibBolehLihatBeranda();
  return getWorkOrderCountByStatusLib();
}

/** Nilai persediaan: hanya untuk yang melihat kartu stok beranda (`inventory:view`). */
export async function getCOGSRawVsFinished() {
  const izin = await wajibBolehLihatBeranda();
  if (!kartuBeranda(izin).stok) requirePermission(izin, PERMISSIONS.INVENTORY_VIEW);
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
  // Angka penjualan SELURUH saluran: aturannya sama dengan kartu tren di beranda
  // (kedua izin penjualan), supaya rentang lain tidak membuka apa yang disembunyikan halamannya.
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.DASHBOARD_VIEW) || !kartuBeranda(izin).tren) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const tren = await getTrenPenjualanRentang(mulai, akhir);
  if (!tren) return { ok: false, code: "INVALID_RANGE" };
  return { ok: true, tren };
}
