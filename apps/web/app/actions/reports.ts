'use server';

import { prisma } from '@elorae/db';
// Procurement Report
export async function getProcurementReport(filters?: {
  fromDate?: Date;
  toDate?: Date;
  supplierId?: string;
}) {
  const where: any = {};
  
  if (filters?.fromDate || filters?.toDate) {
    where.createdAt = {};
    if (filters.fromDate) where.createdAt.gte = filters.fromDate;
    if (filters.toDate) where.createdAt.lte = filters.toDate;
  }
  
  if (filters?.supplierId) {
    where.supplierId = filters.supplierId;
  }
  
  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: {
        select: { name: true, code: true }
      },
      items: {
        include: {
          item: {
            select: { sku: true, nameId: true }
          }
        }
      },
      _count: {
        select: { grns: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  const summary = {
    totalPOs: pos.length,
    totalValue: pos.reduce((sum, po) => sum + Number(po.grandTotal), 0),
    byStatus: {
      draft: pos.filter(p => p.status === 'DRAFT').length,
      submitted: pos.filter(p => p.status === 'SUBMITTED').length,
      partial: pos.filter(p => p.status === 'PARTIAL').length,
      closed: pos.filter(p => p.status === 'CLOSED').length,
      over: pos.filter(p => p.status === 'OVER').length,
      cancelled: pos.filter(p => p.status === 'CANCELLED').length
    }
  };
  
  return { pos, summary };
}

// Inventory Report (one row per item, aggregated from variant-level InventoryValue)
export async function getInventoryReport() {
  const rows = await prisma.inventoryValue.findMany({
    include: {
      item: {
        include: {
          uom: {
            select: { code: true, nameId: true }
          }
        }
      }
    },
    orderBy: { item: { sku: 'asc' } }
  });

  const byItem = new Map<string, { qtyOnHand: number; reserved: number; totalValue: number; item: (typeof rows)[0]['item'] }>();
  for (const r of rows) {
    const qty = Number(r.qtyOnHand);
    const reserved = Number(r.reservedQty);
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.reserved += reserved;
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, { qtyOnHand: qty, reserved, totalValue: val, item: r.item });
    }
  }
  const inventory = Array.from(byItem.entries()).map(([itemId, agg]) => ({
    itemId,
    qtyOnHand: agg.qtyOnHand,
    reserved: agg.reserved,
    available: agg.qtyOnHand - agg.reserved,
    totalValue: agg.totalValue,
    avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
    item: agg.item,
  }));

  const totalValue = inventory.reduce((sum, inv) => sum + inv.totalValue, 0);
  const totalQty = inventory.reduce((sum, inv) => sum + inv.qtyOnHand, 0);
  const summary = {
    totalItems: inventory.length,
    totalValue,
    totalQty,
    lowStock: inventory.filter(inv =>
      inv.item.reorderPoint != null && inv.available <= Number(inv.item.reorderPoint)
    ).length,
    zeroStock: inventory.filter(inv => inv.qtyOnHand === 0).length
  };

  const byType = {
    fabric: inventory.filter(i => i.item.type === 'FABRIC'),
    accessories: inventory.filter(i => i.item.type === 'ACCESSORIES'),
    finishedGood: inventory.filter(i => i.item.type === 'FINISHED_GOOD')
  };

  return { inventory, summary, byType };
}

// Production Report
export async function getProductionReport(filters?: {
  fromDate?: Date;
  toDate?: Date;
  vendorId?: string;
}) {
  const where: any = {};
  
  if (filters?.fromDate || filters?.toDate) {
    where.createdAt = {};
    if (filters.fromDate) where.createdAt.gte = filters.fromDate;
    if (filters.toDate) where.createdAt.lte = filters.toDate;
  }
  
  if (filters?.vendorId) {
    where.vendorId = filters.vendorId;
  }
  
  const workOrders = await prisma.workOrder.findMany({
    where,
    include: {
      vendor: {
        select: { name: true, code: true }
      },
      issues: true,
      receipts: true,
      _count: {
        select: { returns: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  const summary = {
    totalWOs: workOrders.length,
    byStatus: {
      draft: workOrders.filter(w => w.status === 'DRAFT').length,
      issued: workOrders.filter(w => w.status === 'ISSUED').length,
      inProduction: workOrders.filter(w => w.status === 'IN_PRODUCTION').length,
      partial: workOrders.filter(w => w.status === 'PARTIAL').length,
      completed: workOrders.filter(w => w.status === 'COMPLETED').length,
      cancelled: workOrders.filter(w => w.status === 'CANCELLED').length
    },
    totalMaterialCost: workOrders.reduce((sum, wo) => 
      sum + wo.issues.reduce((s, i) => s + Number(i.totalCost), 0), 0
    ),
    totalFGValue: workOrders.reduce((sum, wo) => 
      sum + wo.receipts.reduce((s, r) => s + Number(r.totalCostValue || 0), 0), 0
    ),
    completionRate: workOrders.length > 0
      ? (workOrders.filter(w => w.status === 'COMPLETED').length / workOrders.length * 100)
      : 0
  };
  
  return { workOrders, summary };
}

// ETA Report (Late POs)
export async function getETAReport() {
  const today = new Date();
  
  const overduePOs = await prisma.purchaseOrder.findMany({
    where: {
      etaDate: { lt: today },
      status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] }
    },
    include: {
      supplier: {
        select: { name: true, code: true }
      },
      items: {
        include: {
          item: {
            select: { sku: true, nameId: true }
          }
        }
      }
    },
    orderBy: { etaDate: 'asc' }
  });
  
  const upcomingPOs = await prisma.purchaseOrder.findMany({
    where: {
      etaDate: { gte: today, lte: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) },
      status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] }
    },
    include: {
      supplier: {
        select: { name: true, code: true }
      },
      items: true
    },
    orderBy: { etaDate: 'asc' }
  });
  
  return {
    overdue: overduePOs.map(po => ({
      ...po,
      daysOverdue: Math.floor((today.getTime() - po.etaDate!.getTime()) / (1000 * 60 * 60 * 24)),
      pendingQty: po.items.reduce((sum, item) => 
        sum + (Number(item.qty) - Number(item.receivedQty)), 0
      )
    })),
    upcoming: upcomingPOs.map(po => ({
      ...po,
      daysUntil: Math.floor((po.etaDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    }))
  };
}
