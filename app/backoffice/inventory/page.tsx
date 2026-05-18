import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import {
  getInventorySnapshot,
  getGRNs,
  getStockAdjustments,
  getCurrentStockSummary,
} from '@/lib/inventory/queries';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { InventoryPageClient } from './InventoryPageClient';

export const dynamic = 'force-dynamic';

function serializeGrnRows(
  rows: Array<{
    id: string;
    docNumber: string;
    grnDate: Date;
    totalAmount: number;
    requiresOwnerApproval?: boolean;
    ownerApprovedAt?: Date | null;
    ownerDeclinedAt?: Date | null;
    supplier: { name: string };
    po?: { docNumber: string } | null;
  }>
) {
  return rows.map((grn) => ({
    id: grn.id,
    docNumber: grn.docNumber,
    grnDate: grn.grnDate.toISOString(),
    totalAmount: String(grn.totalAmount),
    requiresOwnerApproval: grn.requiresOwnerApproval,
    ownerApprovedAt: grn.ownerApprovedAt?.toISOString() ?? null,
    ownerDeclinedAt: grn.ownerDeclinedAt?.toISOString() ?? null,
    supplier: grn.supplier,
    po: grn.po ?? undefined,
  }));
}

function serializeAdjustmentRows(
  rows: Array<{
    id: string;
    docNumber: string;
    type: 'POSITIVE' | 'NEGATIVE';
    qtyChange: number | null;
    reason: string;
    createdAt: Date;
    evidenceUrl?: string | null;
    item: { sku: string; nameId: string };
    createdBy?: { name: string | null; email: string | null } | null;
    approvedBy?: { name: string | null } | null;
  }>
) {
  return rows.map((adj) => ({
    id: adj.id,
    docNumber: adj.docNumber,
    type: adj.type,
    qtyChange: String(adj.qtyChange ?? 0),
    reason: adj.reason,
    createdAt: adj.createdAt.toISOString(),
    evidenceUrl: adj.evidenceUrl,
    item: adj.item,
    createdBy: adj.createdBy,
    approvedBy: adj.approvedBy,
  }));
}

export default async function InventoryPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const pageOpts = { page: 1, pageSize: DEFAULT_PAGE_SIZE };

  const [invData, grnData, adjData, adjustmentItemList] = await Promise.all([
    getInventorySnapshot(pageOpts),
    getGRNs(undefined, pageOpts),
    getStockAdjustments(undefined, pageOpts),
    getCurrentStockSummary(),
  ]);

  const inv =
    invData != null && typeof invData === 'object' && 'items' in invData
      ? (invData as {
          items: unknown[];
          totalCount?: number;
          totalValue?: number;
          totalItems?: number;
          lowStockItems?: number;
        })
      : null;

  const grnResult =
    grnData != null && typeof grnData === 'object' && 'items' in grnData
      ? (grnData as { items: Parameters<typeof serializeGrnRows>[0]; totalCount: number })
      : null;

  const adjResult =
    adjData != null && typeof adjData === 'object' && 'items' in adjData
      ? (adjData as unknown as {
          items: Parameters<typeof serializeAdjustmentRows>[0];
          totalCount: number;
        })
      : null;

  return (
    <InventoryPageClient
      initialInventory={(inv?.items ?? []) as Parameters<typeof InventoryPageClient>[0]['initialInventory']}
      initialSummary={{
        totalItems: inv?.totalItems ?? 0,
        totalValue: inv?.totalValue ?? 0,
        lowStockItems: inv?.lowStockItems ?? 0,
      }}
      initialStockTotalCount={inv?.totalCount ?? inv?.items?.length ?? 0}
      initialGrns={grnResult ? serializeGrnRows(grnResult.items) : []}
      initialGrnTotalCount={grnResult?.totalCount ?? 0}
      initialAdjustments={adjResult ? serializeAdjustmentRows(adjResult.items) : []}
      initialAdjTotalCount={adjResult?.totalCount ?? 0}
      initialAdjustmentItemList={
        adjustmentItemList as Parameters<typeof InventoryPageClient>[0]['initialAdjustmentItemList']
      }
    />
  );
}
