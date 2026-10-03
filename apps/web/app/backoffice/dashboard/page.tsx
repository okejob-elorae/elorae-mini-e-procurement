import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getDashboardStats,
  getRawMaterialShortage,
  getCOGSRawVsFinished,
  getOversoldInventory,
  getSalesmenSalesSummary,
  getTrenPenjualan,
} from "@/lib/dashboard/queries";
import { getOverduePOs } from "@/lib/purchase-orders/queries";
import { getMarketplaceKpi } from "@/lib/sales-orders/queries";
import { ringkasPiutangBeranda } from "@/lib/dashboard/piutang-ringkas";
import { serializeDashboardStats } from "@/lib/dashboard/serialize";
import {
  buildActionItems,
  getActionItemCounts,
  getClaimsAwaitingVerification,
} from "@/lib/dashboard/action-items";
import { batasHariIniWib } from "@/lib/dashboard/hari-wib";
import { DashboardPageClient } from "./DashboardPageClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [
    stats,
    overduePOs,
    cogsRawVsFinished,
    rawMaterialShortage,
    marketplaceKpi,
    oversoldInventory,
    salesmenSales,
    actionCounts,
    piutang,
    trenPenjualan,
    klaimMenunggu,
  ] = await Promise.all([
    getDashboardStats(),
    getOverduePOs(),
    getCOGSRawVsFinished(),
    getRawMaterialShortage(),
    getMarketplaceKpi(),
    getOversoldInventory(),
    getSalesmenSalesSummary(),
    getActionItemCounts(),
    ringkasPiutangBeranda(),
    getTrenPenjualan(),
    getClaimsAwaitingVerification(),
  ]);

  /*
   * Folded from data the page already loaded rather than re-counted. The
   * overdue-promise row reuses the receivables summary above, so it states the
   * same number as the "Lewat janji bayar" line and the receivables page.
   */
  const actionItems = buildActionItems({
    ...actionCounts,
    overduePOs: overduePOs.length,
    overduePOsAmount: overduePOs.reduce((s, po) => s + po.grandTotal, 0),
    draftPOs: stats.po.draft,
    oversoldSkus: oversoldInventory.length,
    unshippedOrders: marketplaceKpi.pendingFulfillmentCount,
    overduePromises: { count: piutang.lewatJumlah, amount: piutang.lewatNilai },
    claimsAwaitingVerification: klaimMenunggu,
  });

  return (
    <Suspense fallback={null}>
      <DashboardPageClient
        actionItems={actionItems}
        initialStats={serializeDashboardStats(stats)}
        overduePOCount={overduePOs.length}
        initialCogsRawVsFinished={cogsRawVsFinished}
        shortageCount={rawMaterialShortage.length}
        marketplaceKpi={marketplaceKpi}
        oversoldCount={oversoldInventory.length}
        initialSalesmenSales={salesmenSales}
        piutang={piutang}
        trenPenjualan={trenPenjualan}
        hariIniWib={batasHariIniWib().tanggal}
        dimuatPada={new Date().toISOString()}
      />
    </Suspense>
  );
}
