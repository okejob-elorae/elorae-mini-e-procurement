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
import {
  buildActionItems,
  getActionItemCounts,
  getClaimsAwaitingVerification,
} from "@/lib/dashboard/action-items";
import { batasHariIniWib } from "@/lib/dashboard/hari-wib";
import { hasPermission } from "@/lib/rbac";
import { kartuBeranda, statistikBeranda } from "./kartu-beranda";
import { DashboardPageClient } from "./DashboardPageClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const izin = session.user.permissions ?? [];
  // Kartu yang tidak boleh dilihat tidak dimuat sama sekali — lihat `kartuBeranda`.
  const kartu = kartuBeranda(izin);

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
    getDashboardStats(kartu),
    getOverduePOs(),
    kartu.stok ? getCOGSRawVsFinished() : null,
    getRawMaterialShortage(),
    kartu.penjualanMarketplace ? getMarketplaceKpi() : null,
    kartu.stok ? getOversoldInventory() : null,
    kartu.penjualanLapangan ? getSalesmenSalesSummary() : null,
    getActionItemCounts(),
    kartu.piutang ? ringkasPiutangBeranda() : null,
    kartu.tren ? getTrenPenjualan() : null,
    kartu.klaimMenunggu ? getClaimsAwaitingVerification() : null,
  ]);

  /*
   * Folded from data the page already loaded rather than re-counted. The
   * overdue-promise row reuses the receivables summary above, so it states the
   * same number as the "Lewat janji bayar" line and the receivables page.
   * Rows whose permission the viewer lacks are dropped HERE, not only in the
   * panel: a hidden row still ships its count and rupiah to the browser.
   */
  const actionItems = buildActionItems({
    ...actionCounts,
    overduePOs: overduePOs.length,
    overduePOsAmount: overduePOs.reduce((s, po) => s + po.grandTotal, 0),
    draftPOs: stats.po.draft,
    oversoldSkus: oversoldInventory?.length ?? 0,
    unshippedOrders: marketplaceKpi?.pendingFulfillmentCount ?? 0,
    overduePromises: piutang ? { count: piutang.lewatJumlah, amount: piutang.lewatNilai } : undefined,
    claimsAwaitingVerification: klaimMenunggu ?? undefined,
  }, izin).filter((item) => !item.permission || hasPermission(izin, item.permission));

  return (
    <Suspense fallback={null}>
      <DashboardPageClient
        actionItems={actionItems}
        initialStats={statistikBeranda(stats, kartu)}
        overduePOCount={overduePOs.length}
        initialCogsRawVsFinished={cogsRawVsFinished}
        shortageCount={rawMaterialShortage.length}
        marketplaceKpi={marketplaceKpi}
        oversoldCount={oversoldInventory ? oversoldInventory.length : null}
        initialSalesmenSales={salesmenSales}
        piutang={piutang}
        trenPenjualan={trenPenjualan}
        hariIniWib={batasHariIniWib().tanggal}
        dimuatPada={new Date().toISOString()}
      />
    </Suspense>
  );
}
