'use server';

import { Decimal } from 'decimal.js';
import { prisma } from '../prisma';

export interface ReconciliationResult {
  itemId: string;
  itemName: string;
  itemSku: string;
  uomCode: string;
  plannedQty: Decimal;
  issuedQty: Decimal;
  returnedQty: Decimal;
  actualUsed: Decimal;
  theoreticalUsage: Decimal;
  variance: Decimal;
  variancePercent: Decimal;
  varianceValue: Decimal;
  issuedValue: Decimal;
  usedValue: Decimal;
  status: 'OK' | 'OVER' | 'UNDER';
}

export interface ReconciliationSummary {
  totalIssuedValue: Decimal;
  totalUsedValue: Decimal;
  netVarianceValue: Decimal;
}

export async function reconcileWorkOrder(woId: string): Promise<{
  lines: ReconciliationResult[];
  summary: ReconciliationSummary;
}> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    include: {
      issues: true,
      returns: { where: { status: 'PROCESSED' } },
      receipts: true
    }
  });

  if (!wo) throw new Error('Work Order not found');

  const consumptionPlanRaw = wo.consumptionPlan;
  let consumptionPlan: any[];
  if (Array.isArray(consumptionPlanRaw)) {
    consumptionPlan = consumptionPlanRaw.filter((p: any) => p && (p.itemId != null || p.item_id != null));
  } else if (typeof consumptionPlanRaw === 'string') {
    try {
      const parsed = JSON.parse(consumptionPlanRaw) as unknown;
      consumptionPlan = Array.isArray(parsed)
        ? parsed.filter((p: any) => p && (p.itemId != null || p.item_id != null))
        : [];
    } catch {
      consumptionPlan = [];
    }
  } else {
    consumptionPlan = [];
  }
  const actualQtyRaw = wo.actualQty;
  const actualOutput =
    actualQtyRaw != null && actualQtyRaw !== ''
      ? new Decimal(String(actualQtyRaw))
      : new Decimal(0);

  const lines: ReconciliationResult[] = [];

  for (const plan of consumptionPlan) {
    const planItemIdRaw = plan.itemId ?? plan.item_id;
    if (planItemIdRaw == null || planItemIdRaw === '') continue;
    const planItemId = String(planItemIdRaw);

    const item = await prisma.item.findUnique({
      where: { id: planItemId },
      select: { sku: true, nameId: true }
    });

    const totalIssued = wo.issues.reduce((sum, issue) => {
      let raw: unknown = issue.items;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = [];
        }
      }
      const items = Array.isArray(raw) ? raw : [];
      const match = items.find(
        (i: any) => String(i.itemId ?? i.item_id) === planItemId
      );
      const qty = match?.qty ?? match?.quantity ?? 0;
      return sum.plus(new Decimal(Number(qty) || 0));
    }, new Decimal(0));

    const totalReturned = wo.returns.reduce((sum, ret) => {
      const raw = ret.lines;
      const retLines = Array.isArray(raw) ? raw : [];
      const match = retLines.find(
        (l: any) =>
          String(l.itemId ?? l.item_id) === planItemId &&
          (l.type ?? l.itemType) !== 'FG_REJECT'
      );
      const qty = match?.qty ?? match?.quantity ?? 0;
      return sum.plus(new Decimal(Number(qty) || 0));
    }, new Decimal(0));

    const actualUsed = totalIssued.minus(totalReturned);

    const qtyRequired = new Decimal(plan.qtyRequired ?? plan.qty_required ?? 0);
    const wastePercent = new Decimal(plan.wastePercent ?? plan.waste_percent ?? 0);
    const wasteFactor = new Decimal(1).plus(wastePercent.div(100));
    const theoreticalUsage = actualOutput.mul(qtyRequired).mul(wasteFactor);

    const variance = actualUsed.minus(theoreticalUsage);
    const variancePercent = theoreticalUsage.gt(0)
      ? variance.div(theoreticalUsage).mul(100)
      : new Decimal(0);

    const inventory = await prisma.inventoryValue.findUnique({
      where: { itemId: planItemId }
    });
    const avgCost =
      inventory != null && inventory.avgCost != null
        ? new Decimal(String(inventory.avgCost))
        : new Decimal(0);
    const varianceValue = variance.mul(avgCost);

    const tolerance = new Decimal(0.01);
    let status: 'OK' | 'OVER' | 'UNDER';
    if (variance.abs().lte(theoreticalUsage.mul(tolerance))) {
      status = 'OK';
    } else if (variance.gt(0)) {
      status = 'OVER';
    } else {
      status = 'UNDER';
    }

    const issuedValue = totalIssued.mul(avgCost);
    const usedValue = actualUsed.mul(avgCost);

    lines.push({
      itemId: planItemId,
      itemName: item?.nameId ?? plan.itemName ?? plan.item_name ?? '',
      itemSku: item?.sku ?? '',
      uomCode: plan.uomCode ?? plan.uom_code ?? 'PCS',
      plannedQty: new Decimal(plan.plannedQty ?? plan.planned_qty ?? 0),
      issuedQty: totalIssued,
      returnedQty: totalReturned,
      actualUsed,
      theoreticalUsage,
      variance,
      variancePercent,
      varianceValue,
      issuedValue,
      usedValue,
      status
    });
  }

  const totalIssuedValue = lines.reduce(
    (sum, line) => sum.plus(line.issuedValue),
    new Decimal(0)
  );
  const totalUsedValue = lines.reduce(
    (sum, line) => sum.plus(line.usedValue),
    new Decimal(0)
  );
  const netVarianceValue = lines.reduce(
    (sum, line) => sum.plus(line.varianceValue),
    new Decimal(0)
  );

  return {
    lines,
    summary: {
      totalIssuedValue,
      totalUsedValue,
      netVarianceValue
    }
  };
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

  const { lines: reconciliation, summary: reconSummary } =
    await reconcileWorkOrder(woId);

  const totalMaterialCost = wo.issues.reduce((sum, issue) => {
    const v = issue.totalCost;
    return sum.plus(v != null ? new Decimal(String(v)) : 0);
  }, new Decimal(0));

  const totalFGValue = wo.receipts.reduce((sum, receipt) => {
    const v = receipt.totalCostValue;
    return sum.plus(v != null ? new Decimal(String(v)) : 0);
  }, new Decimal(0));
  
  return {
    workOrder: wo,
    reconciliation,
    reconciliationSummary: reconSummary,
    summary: {
      totalIssues: wo.issues.length,
      totalReceipts: wo.receipts.length,
      totalReturns: wo.returns.filter((r) => r.status === 'PROCESSED').length,
      totalMaterialCost: totalMaterialCost.toNumber(),
      totalFGValue: totalFGValue.toNumber(),
      materialVariance: totalMaterialCost.minus(totalFGValue).toNumber(),
      completionPercent:
        Number(wo.plannedQty) > 0
          ? new Decimal(wo.actualQty?.toString() || 0)
              .div(wo.plannedQty.toString())
              .mul(100)
              .toNumber()
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
