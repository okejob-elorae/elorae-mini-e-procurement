"use server";

import { prisma, SalesHistoryStatus } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { buildKonsiDemand } from "@/lib/forecast/konsi-demand";
import { buildMarketplaceDemand, wibYearMonth } from "@/lib/forecast/marketplace-demand";
import { loadKonsiReports, loadMarketplaceDemandInput } from "@/lib/forecast/demand-sources";
import { LOOKBACK_BAWAAN, hitungBulanBerpermintaan, jendelaLookback } from "./cakupan-permintaan";

export interface CakupanPermintaanForecast {
  /** Bulan WIB dalam jendela forecast yang punya penjualan dari sumber mana pun. */
  bulan: number;
  /** Panjang jendela yang dibaca forecast untuk tahun ini. */
  lookbackMonths: number;
}

/**
 * Berapa bulan penjualan yang akan dibaca `runForecast` untuk `targetYear`: jendela dan
 * sumbernya sama — `SalesHistory` (impor Excel + offline), pesanan marketplace yang
 * tersinkron, dan laporan konsinyasi yang disetujui. Kartu "Cakupan data" hanya menghitung
 * `SalesHistory`, jadi tidak bisa dipakai untuk saran ini.
 */
export async function getCakupanPermintaanForecast(targetYear: number): Promise<CakupanPermintaanForecast> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.FORECAST_VIEW);
  if (!Number.isInteger(targetYear)) throw new Error("Invalid year");

  const config = await prisma.forecastConfig.findUnique({
    where: { year: targetYear },
    select: { lookbackMonths: true },
  });
  const lookbackMonths = config?.lookbackMonths ?? LOOKBACK_BAWAAN;
  const window = jendelaLookback(targetYear, lookbackMonths);

  const [history, marketplaceInput, konsiReports] = await Promise.all([
    prisma.salesHistory.findMany({
      where: {
        orderStatus: SalesHistoryStatus.COMPLETED,
        orderDate: { gte: window.start, lte: window.end },
      },
      select: { orderDate: true, netQuantity: true },
    }),
    loadMarketplaceDemandInput(window),
    loadKonsiReports(window),
  ]);

  const bulan = hitungBulanBerpermintaan([
    ...history.map((h) => ({ ...wibYearMonth(h.orderDate), netQuantity: h.netQuantity })),
    ...buildMarketplaceDemand(marketplaceInput).rows,
    ...buildKonsiDemand(konsiReports).rows,
  ]);

  return { bulan, lookbackMonths };
}
