'use server';

import { Decimal } from 'decimal.js';
import { prisma } from '../prisma';

export interface ReconciliationResult {
  itemId: string;
  itemName: string;
  itemSku: string;
  plannedQty: Decimal;
  issuedQty: Decimal;
  returnedQty: Decimal;
  actualUsed: Decimal;
  theoreticalUsage: Decimal;
  variance: Decimal;
  variancePercent: Decimal;
  status: 'OK' | 'OVER' | 'UNDER';
}

export async function reconcileWorkOrder(woId: string): Promise<ReconciliationResult[]> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    include: {
      issues: true,
      returns: true,
      receipts: true
    }
  });
  
  if (!wo) throw new Error('Work Order not found');
  
  const consumptionPlan = wo.consumptionPlan as any[];
  const actualOutput = wo.actualQty ? new Decimal(wo.actualQty.toString()) : new Decimal(0);
  
  return Promise.all(consumptionPlan.map(async (plan) => {
    // Get item details
    const item = await prisma.item.findUnique({
      where: { id: plan.itemId },
      select: { sku: true, nameId: true }
    });
    
    // Sum all issues for this material
    const totalIssued = wo.issues.reduce((sum, issue) => {
      const items = issue.items as any[];
      const match = items.find((i: any) => i.itemId === plan.itemId);
      return sum.plus(match?.qty || 0);
    }, new Decimal(0));
    
    // Sum all returns for this material
    const totalReturned = wo.returns.reduce((sum, ret) => {
      if (ret.status !== 'PROCESSED') return sum;
      const lines = ret.lines as any[];
      const match = lines.find((l: any) => l.itemId === plan.itemId && l.type !== 'FG_REJECT');
      return sum.plus(match?.qty || 0);
    }, new Decimal(0));
    
    const actualUsed = totalIssued.minus(totalReturned);
    
    // Calculate theoretical usage based on actual output
    const qtyRequired = new Decimal(plan.qtyRequired || 0);
    const wastePercent = new Decimal(plan.wastePercent || 0);
    const wasteFactor = new Decimal(1).plus(wastePercent.div(100));
    const theoreticalUsage = actualOutput.mul(qtyRequired).mul(wasteFactor);
    
    const variance = actualUsed.minus(theoreticalUsage);
    const variancePercent = theoreticalUsage.gt(0) 
      ? variance.div(theoreticalUsage).mul(100) 
      : new Decimal(0);
    
    // Determine status with tolerance of 1%
    const tolerance = new Decimal(0.01);
    let status: 'OK' | 'OVER' | 'UNDER';
    if (variance.abs().lte(theoreticalUsage.mul(tolerance))) {
      status = 'OK';
    } else if (variance.gt(0)) {
      status = 'OVER';
    } else {
      status = 'UNDER';
    }
    
    return {
      itemId: plan.itemId,
      itemName: item?.nameId || plan.itemName,
      itemSku: item?.sku || '',
      plannedQty: new Decimal(plan.plannedQty || 0),
      issuedQty: totalIssued,
      returnedQty: totalReturned,
      actualUsed,
      theoreticalUsage,
      variance,
      variancePercent,
      status
    };
  }));
}

// Get work order summary with reconciliation status
export async function getWorkOrderSummary(woId: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    include: {
      vendor: {
        select: {
          name: true,
          code: true
        }
      },
      issues: true,
      receipts: true,
      returns: true
    }
  });
  
  if (!wo) throw new Error('Work Order not found');
  
  const reconciliation = await reconcileWorkOrder(woId);
  
  const totalMaterialCost = wo.issues.reduce((sum, issue) => {
    return sum.plus(issue.totalCost.toString());
  }, new Decimal(0));
  
  const totalFGValue = wo.receipts.reduce((sum, receipt) => {
    return sum.plus(receipt.totalCostValue?.toString() || 0);
  }, new Decimal(0));
  
  return {
    workOrder: wo,
    reconciliation,
    summary: {
      totalIssues: wo.issues.length,
      totalReceipts: wo.receipts.length,
      totalReturns: wo.returns.filter(r => r.status === 'PROCESSED').length,
      totalMaterialCost: totalMaterialCost.toNumber(),
      totalFGValue: totalFGValue.toNumber(),
      materialVariance: totalMaterialCost.minus(totalFGValue).toNumber(),
      completionPercent: wo.plannedQty > 0 
        ? new Decimal(wo.actualQty?.toString() || 0).div(wo.plannedQty.toString()).mul(100).toNumber()
        : 0
    }
  };
}

// Get all work orders with their status summary
export async function getWorkOrderList(filters?: {
  status?: string;
  vendorId?: string;
  fromDate?: Date;
  toDate?: Date;
}) {
  const where: any = {};
  
  if (filters?.status) {
    where.status = filters.status;
  }
  
  if (filters?.vendorId) {
    where.vendorId = filters.vendorId;
  }
  
  if (filters?.fromDate || filters?.toDate) {
    where.createdAt = {};
    if (filters.fromDate) {
      where.createdAt.gte = filters.fromDate;
    }
    if (filters.toDate) {
      where.createdAt.lte = filters.toDate;
    }
  }
  
  return await prisma.workOrder.findMany({
    where,
    include: {
      vendor: {
        select: {
          name: true,
          code: true
        }
      },
      _count: {
        select: {
          issues: true,
          receipts: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}
