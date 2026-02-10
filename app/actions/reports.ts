'use server';

import { prisma } from '@/lib/prisma';
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
      cancelled: pos.filter(p => p.status === 'CANCELLED').length
    }
  };
  
  return { pos, summary };
}

// Inventory Report
export async function getInventoryReport() {
  const inventory = await prisma.inventoryValue.findMany({
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
  
  const summary = {
    totalItems: inventory.length,
    totalValue: inventory.reduce((sum, inv) => sum + Number(inv.totalValue), 0),
    totalQty: inventory.reduce((sum, inv) => sum + Number(inv.qtyOnHand), 0),
    lowStock: inventory.filter(inv => 
      inv.item.reorderPoint && inv.qtyOnHand <= inv.item.reorderPoint
    ).length,
    zeroStock: inventory.filter(inv => Number(inv.qtyOnHand) === 0).length
  };
  
  // Group by item type
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
      status: { notIn: ['CLOSED', 'CANCELLED'] }
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
      status: { notIn: ['CLOSED', 'CANCELLED'] }
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

// Stock Movement Report
export async function getStockMovementReport(filters?: {
  itemId?: string;
  fromDate?: Date;
  toDate?: Date;
  type?: 'IN' | 'OUT' | 'ADJUSTMENT';
}) {
  const where: any = {};
  
  if (filters?.itemId) where.itemId = filters.itemId;
  if (filters?.type) where.type = filters.type;
  
  if (filters?.fromDate || filters?.toDate) {
    where.createdAt = {};
    if (filters.fromDate) where.createdAt.gte = filters.fromDate;
    if (filters.toDate) where.createdAt.lte = filters.toDate;
  }
  
  const movements = await prisma.stockMovement.findMany({
    where,
    include: {
      item: {
        select: {
          sku: true,
          nameId: true,
          uom: {
            select: { code: true }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 500
  });
  
  const summary = {
    totalMovements: movements.length,
    totalIn: movements.filter(m => m.type === 'IN').reduce((sum, m) => sum + Number(m.qty), 0),
    totalOut: movements.filter(m => m.type === 'OUT').reduce((sum, m) => sum + Math.abs(Number(m.qty)), 0),
    totalAdjustments: movements.filter(m => m.type === 'ADJUSTMENT').length
  };
  
  return { movements, summary };
}

// Dashboard Summary
export async function getDashboardSummary() {
  const today = new Date();

  const [
    poStats,
    inventoryStats,
    productionStats,
    overduePOs,
    lowStockItems,
    recentMovements
  ] = await Promise.all([
    // PO Stats
    prisma.purchaseOrder.aggregate({
      _count: { id: true },
      _sum: { grandTotal: true }
    }),
    
    // Inventory Stats
    prisma.inventoryValue.aggregate({
      _sum: { totalValue: true, qtyOnHand: true }
    }),
    
    // Production Stats
    prisma.workOrder.aggregate({
      _count: { id: true }
    }),
    
    // Overdue POs
    prisma.purchaseOrder.count({
      where: {
        etaDate: { lt: today },
        status: { notIn: ['CLOSED', 'CANCELLED'] }
      }
    }),
    
    // Low stock items
    prisma.inventoryValue.count({
      where: {
        item: { reorderPoint: { not: null } },
        qtyOnHand: { lte: prisma.inventoryValue.fields.qtyOnHand }
      }
    }),
    
    // Recent movements
    prisma.stockMovement.count({
      where: {
        createdAt: { gte: new Date(today.getTime() - 24 * 60 * 60 * 1000) }
      }
    })
  ]);
  
  return {
    procurement: {
      totalPOs: poStats._count.id,
      totalValue: poStats._sum.grandTotal || 0,
      overduePOs
    },
    inventory: {
      totalValue: inventoryStats._sum.totalValue || 0,
      totalQty: inventoryStats._sum.qtyOnHand || 0,
      lowStockItems
    },
    production: {
      totalWOs: productionStats._count.id
    },
    activity: {
      recentMovements
    }
  };
}
