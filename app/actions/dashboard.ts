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
        status: { notIn: ['CLOSED', 'CANCELLED'] },
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

  const lowStockCount = inventoryRows.filter(
    (r) =>
      r.item.reorderPoint != null &&
      Number(r.qtyOnHand) <= Number(r.item.reorderPoint)
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
