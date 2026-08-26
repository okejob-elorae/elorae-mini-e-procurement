import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getDashboardStats,
  getRawMaterialShortage,
  getWorkOrderCountByStatus,
  getCOGSRawVsFinished,
  getSuppliersForReportFilter,
  getOversoldInventory,
  getSalesmenSalesSummary,
} from "@/lib/dashboard/queries";
import { getOverduePOs } from "@/lib/purchase-orders/queries";
import { getMarketplaceKpi } from "@/lib/sales-orders/queries";
import { serializeDashboardStats, toIso } from "@/lib/dashboard/serialize";
import { buildActionItems, getActionItemCounts } from "@/lib/dashboard/action-items";
import { DashboardPageClient } from "./DashboardPageClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [
    stats,
    overduePOs,
    suppliers,
    cogsRawVsFinished,
    rawMaterialShortage,
    woStatusCounts,
    marketplaceKpi,
    oversoldInventory,
    salesmenSales,
    actionCounts,
  ] = await Promise.all([
    getDashboardStats(),
    getOverduePOs(),
    getSuppliersForReportFilter(),
    getCOGSRawVsFinished(),
    getRawMaterialShortage(),
    getWorkOrderCountByStatus(),
    getMarketplaceKpi(),
    getOversoldInventory(),
    getSalesmenSalesSummary(),
    getActionItemCounts(),
  ]);

  /*
   * Folded from data the page already loaded rather than re-counted, so the
   * panel costs five extra COUNTs, not nine.
   */
  const actionItems = buildActionItems({
    ...actionCounts,
    overduePOs: overduePOs.length,
    submittedPOs: stats.po.submitted,
    oversoldSkus: oversoldInventory.length,
    unshippedOrders: marketplaceKpi.pendingFulfillmentCount,
  });

  return (
    <Suspense fallback={null}>
      <DashboardPageClient
        actionItems={actionItems}
        initialStats={serializeDashboardStats(stats)}
        initialOverduePOs={overduePOs.map((po) => ({
          ...po,
          etaDate: toIso(po.etaDate),
        }))}
        initialSuppliers={suppliers}
        initialCogsRawVsFinished={cogsRawVsFinished}
        initialRawMaterialShortage={rawMaterialShortage}
        initialWoStatusCounts={woStatusCounts}
        marketplaceKpi={marketplaceKpi}
        initialOversoldInventory={oversoldInventory}
        initialSalesmenSales={salesmenSales}
      />
    </Suspense>
  );
}
