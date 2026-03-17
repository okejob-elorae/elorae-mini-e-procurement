'use server';

import { prisma } from '@/lib/prisma';

function getWeekStart(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getTodayStart(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatActivityLabel(action: string, entityType: string): string {
  const entityLabels: Record<string, string> = {
    PurchaseOrder: 'Purchase Order',
    PO: 'Purchase Order',
    GRN: 'Goods Receipt',
    WorkOrder: 'Work Order',
    WO: 'Work Order',
    Item: 'Item',
    Supplier: 'Supplier',
    StockAdjustment: 'Stock Adjustment',
    VendorReturn: 'Vendor Return',
    MaterialIssue: 'Material Issue',
    FGReceipt: 'FG Receipt',
  };
  const entity = entityLabels[entityType] ?? entityType;
  const actionLower = action.toUpperCase();
  if (actionLower === 'CREATE' || actionLower === 'CREATED') return `${entity} created`;
  if (actionLower === 'UPDATE' || actionLower === 'UPDATED') return `${entity} updated`;
  if (actionLower === 'DELETE' || actionLower === 'DELETED') return `${entity} deleted`;
  if (actionLower === 'SUBMIT' || actionLower === 'SUBMITTED') return `${entity} submitted`;
  if (actionLower === 'ADJUST_STOCK') return 'Stock adjusted';
  if (actionLower === 'VIEW_BANK_ACCOUNT') return 'Bank account viewed';
  return `${entity}: ${action}`;
}

export type DashboardStats = {
  po: {
    submitted: number;
    inProduction: number;
    thisWeek: number;
    overdue: number;
    totalValue: number;
  };
  items: {
    activeCount: number;
    lowStockCount: number;
  };
  workOrders: {
    inProduction: number;
    completedToday: number;
  };
  suppliers: {
    activeCount: number;
  };
  inventory: {
    totalValue: number;
  };
  grnsThisWeek: number;
  movementsToday: number;
  recentActivity: Array<{
    id: string;
    action: string;
    label: string;
    userName: string | null;
    createdAt: Date;
  }>;
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const todayStart = getTodayStart(now);
  const weekStart = getWeekStart(now);

  const [
    poSubmitted,
    poPartial,
    poThisWeek,
    poOverdue,
    poTotalValue,
    itemsActive,
    inventoryRows,
    inventoryTotalValue,
    woInProduction,
    woCompletedToday,
    suppliersActive,
    grnsThisWeek,
    movementsToday,
    auditLogs,
  ] = await Promise.all([
    prisma.purchaseOrder.count({ where: { status: 'SUBMITTED' } }),
    prisma.purchaseOrder.count({ where: { status: 'PARTIAL' } }),
    prisma.purchaseOrder.count({
      where: { createdAt: { gte: weekStart } },
    }),
    prisma.purchaseOrder.count({
      where: {
        etaDate: { lt: now },
        status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] },
      },
    }),
    prisma.purchaseOrder.aggregate({ _sum: { grandTotal: true } }),
    prisma.item.count({ where: { isActive: true } }),
    prisma.inventoryValue.findMany({
      where: { item: { reorderPoint: { not: null } } },
      include: { item: { select: { reorderPoint: true } } },
    }),
    prisma.inventoryValue.aggregate({ _sum: { totalValue: true } }),
    prisma.workOrder.count({
      where: { status: { in: ['IN_PRODUCTION', 'PARTIAL'] } },
    }),
    prisma.workOrder.count({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: todayStart, lte: now },
      },
    }),
    prisma.supplier.count({ where: { isActive: true } }),
    prisma.gRN.count({
      where: { grnDate: { gte: weekStart } },
    }),
    prisma.stockMovement.count({
      where: { createdAt: { gte: todayStart } },
    }),
    prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true } },
      },
    }),
  ]);

  const inventoryByItem = new Map<string, { qtyOnHand: number; reorderPoint: number | null }>();
  for (const r of inventoryRows) {
    const rp = r.item.reorderPoint != null ? Number(r.item.reorderPoint) : null;
    const existing = inventoryByItem.get(r.itemId);
    if (existing) {
      existing.qtyOnHand += Number(r.qtyOnHand);
    } else {
      inventoryByItem.set(r.itemId, { qtyOnHand: Number(r.qtyOnHand), reorderPoint: rp });
    }
  }
  const lowStockCount = Array.from(inventoryByItem.values()).filter(
    (a) => a.reorderPoint != null && a.qtyOnHand <= a.reorderPoint
  ).length;

  const recentActivity = auditLogs.map((log) => ({
    id: log.id,
    action: log.action,
    label: formatActivityLabel(log.action, log.entityType),
    userName: log.user?.name ?? null,
    createdAt: log.createdAt,
  }));

  return {
    po: {
      submitted: poSubmitted,
      inProduction: poPartial,
      thisWeek: poThisWeek,
      overdue: poOverdue,
      totalValue: Number(poTotalValue._sum.grandTotal ?? 0),
    },
    items: {
      activeCount: itemsActive,
      lowStockCount,
    },
    workOrders: {
      inProduction: woInProduction,
      completedToday: woCompletedToday,
    },
    suppliers: {
      activeCount: suppliersActive,
    },
    inventory: {
      totalValue: Number(inventoryTotalValue._sum.totalValue ?? 0),
    },
    grnsThisWeek,
    movementsToday,
    recentActivity,
  };
}

export type RawMaterialShortageRow = {
  itemId: string;
  itemName: string;
  uomCode: string;
  totalPlanned: number;
  qtyOnHand: number;
  deficit: number;
};

/** Accumulated raw material shortages across all active (IN_PRODUCTION) work orders. */
export async function getRawMaterialShortage(): Promise<RawMaterialShortageRow[]> {
  const wos = await prisma.workOrder.findMany({
    where: { status: 'IN_PRODUCTION' },
    select: { consumptionPlan: true },
  });

  const plannedByItem = new Map<string, number>();
  const itemIds = new Set<string>();

  for (const wo of wos) {
    const plan = (() => {
      const raw = wo.consumptionPlan;
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        try {
          const p = JSON.parse(raw) as unknown;
          return Array.isArray(p) ? p : [];
        } catch {
          return [];
        }
      }
      return [];
    })();
    for (const row of plan as Array<{ itemId?: string; plannedQty?: number }>) {
      if (!row?.itemId) continue;
      const qty = Number(row.plannedQty) || 0;
      itemIds.add(row.itemId);
      plannedByItem.set(row.itemId, (plannedByItem.get(row.itemId) ?? 0) + qty);
    }
  }

  if (itemIds.size === 0) return [];

  const items = await prisma.item.findMany({
    where: { id: { in: Array.from(itemIds) } },
    select: { id: true, nameId: true, uomId: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const uomIds = [...new Set(items.map((i) => i.uomId))];
  const uoms = await prisma.uOM.findMany({
    where: { id: { in: uomIds } },
    select: { id: true, code: true },
  });
  const uomById = new Map(uoms.map((u) => [u.id, u]));

  const inventoryRows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: Array.from(itemIds) } },
    select: { itemId: true, qtyOnHand: true },
  });
  const onHandByItem = new Map<string, number>();
  for (const r of inventoryRows) {
    onHandByItem.set(r.itemId, (onHandByItem.get(r.itemId) ?? 0) + Number(r.qtyOnHand));
  }

  const result: RawMaterialShortageRow[] = [];
  for (const itemId of itemIds) {
    const totalPlanned = plannedByItem.get(itemId) ?? 0;
    const qtyOnHand = onHandByItem.get(itemId) ?? 0;
    const deficit = Math.max(0, totalPlanned - qtyOnHand);
    if (deficit <= 0) continue;
    const item = itemById.get(itemId);
    const uom = item ? uomById.get(item.uomId) : null;
    result.push({
      itemId,
      itemName: item?.nameId ?? itemId,
      uomCode: uom?.code ?? '',
      totalPlanned,
      qtyOnHand,
      deficit,
    });
  }
  return result.sort((a, b) => b.deficit - a.deficit);
}

export type WorkOrderStatusCount = {
  status: string;
  count: number;
  totalPlannedQty: number;
};

/** Work orders grouped by status with counts and total planned qty. */
export async function getWorkOrderCountByStatus(): Promise<WorkOrderStatusCount[]> {
  const wos = await prisma.workOrder.findMany({
    select: { status: true, plannedQty: true },
  });
  const byStatus = new Map<string, { count: number; totalPlanned: number }>();
  const statusOrder = ['DRAFT', 'ISSUED', 'IN_PRODUCTION', 'PARTIAL', 'COMPLETED', 'CANCELLED'];
  for (const s of statusOrder) {
    byStatus.set(s, { count: 0, totalPlanned: 0 });
  }
  for (const wo of wos) {
    const s = wo.status;
    if (!byStatus.has(s)) byStatus.set(s, { count: 0, totalPlanned: 0 });
    const rec = byStatus.get(s)!;
    rec.count += 1;
    rec.totalPlanned += Number(wo.plannedQty) || 0;
  }
  return statusOrder.map((status) => {
    const rec = byStatus.get(status) ?? { count: 0, totalPlanned: 0 };
    return { status, count: rec.count, totalPlannedQty: rec.totalPlanned };
  });
}
