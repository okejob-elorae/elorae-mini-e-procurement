import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import {
  getDashboardStats,
  getRawMaterialShortage,
  getWorkOrderCountByStatus,
  getCOGSRawVsFinished,
  getSuppliersForReportFilter,
  getOversoldInventory,
} from '@/lib/dashboard/queries';
import { getOverduePOs } from '@/lib/purchase-orders/queries';
import { getMarketplaceKpi } from '@/lib/sales-orders/queries';
import { serializeDashboardStats, toIso } from '@/lib/dashboard/serialize';
import { DashboardPageClient } from './DashboardPageClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const [stats, overduePOs, suppliers, cogsRawVsFinished, rawMaterialShortage, woStatusCounts, marketplaceKpi, oversoldInventory] =
    await Promise.all([
      getDashboardStats(),
      getOverduePOs(),
      getSuppliersForReportFilter(),
      getCOGSRawVsFinished(),
      getRawMaterialShortage(),
      getWorkOrderCountByStatus(),
      getMarketplaceKpi(),
      getOversoldInventory(),
    ]);

  return (
    <DashboardPageClient
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
    />
  );
}
