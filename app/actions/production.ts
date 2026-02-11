'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { generateMaterialPlan } from '@/lib/production/planning';
import { reconcileWorkOrder } from '@/lib/production/reconciliation';
import { calculateMovingAverage } from '@/lib/inventory/costing';

// Prisma uses CUID, not UUID - accept non-empty string for IDs
const idStr = z.string().min(1);

const woSchema = z.object({
  vendorId: idStr,
  outputMode: z.enum(['GENERIC', 'SKU']),
  plannedQty: z.number().positive(),
  targetDate: z.date().optional(),
  finishedGoodId: idStr,
  notes: z.string().optional()
});

export type WOFormData = z.infer<typeof woSchema>;

export async function createWorkOrder(data: WOFormData, userId: string) {
  woSchema.parse(data);

  const plannedOutput = new Decimal(data.plannedQty);
  const materialPlan = await generateMaterialPlan(
    data.finishedGoodId,
    plannedOutput
  );

  const shortages = materialPlan.filter((m) => m.shortage.gt(0));
  if (shortages.length > 0) {
    const msg = shortages
      .map(
        (s) =>
          `${s.itemName} (kurang ${s.shortage.toFixed(2)} ${s.uomCode})`
      )
      .join(', ');
    throw new Error(`Stok tidak mencukupi: ${msg}`);
  }

  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('WO', tx);

    const wo = await tx.workOrder.create({
      data: {
        docNumber,
        vendorId: data.vendorId,
        finishedGoodId: data.finishedGoodId,
        outputMode: data.outputMode,
        plannedQty: data.plannedQty,
        targetDate: data.targetDate,
        notes: data.notes,
        createdById: userId,
        consumptionPlan: JSON.stringify(
          materialPlan.map((m) => ({
            itemId: m.itemId,
            itemName: m.itemName,
            uomId: m.uomId,
            uomCode: m.uomCode,
            qtyRequired: m.qtyRequired.toNumber(),
            wastePercent: m.wastePercent.toNumber(),
            plannedQty: m.plannedQty.toNumber(),
            issuedQty: 0,
            returnedQty: 0
          }))
        )
      }
    });

    return wo;
  });
}

export async function issueWorkOrder(id: string, _userId: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id }
  });
  
  if (!wo) throw new Error('Work Order not found');
  if (wo.status !== 'DRAFT') throw new Error('Work Order already issued');
  
  await prisma.workOrder.update({
    where: { id },
    data: {
      status: 'ISSUED',
      issuedAt: new Date()
    }
  });
  
  revalidatePath('/backoffice/work-orders');
}

const issueSchema = z.object({
  woId: idStr,
  items: z
    .array(
      z.object({
        itemId: idStr,
        qty: z.number().positive(),
        uomId: idStr
      })
    )
    .min(1),
  issueType: z.enum(['FABRIC', 'ACCESSORIES']),
  isPartial: z.boolean().default(false),
  parentIssueId: idStr.optional(),
  notes: z.string().optional()
});

export type IssueFormData = z.infer<typeof issueSchema>;

export async function issueMaterials(data: IssueFormData, userId: string) {
  const validated = issueSchema.parse(data);

  return await prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({
      where: { id: data.woId },
      select: { status: true, consumptionPlan: true, docNumber: true }
    });

    if (!wo) throw new Error('Work Order not found');
    if (!['DRAFT', 'ISSUED', 'IN_PRODUCTION'].includes(wo.status)) {
      throw new Error('Work Order tidak valid atau sudah selesai');
    }

    const docNumber = await generateDocNumber('ISSUE', tx);
    let totalCost = new Decimal(0);
    const movementData: Array<{
      itemId: string;
      qty: number;
      unitCost: number;
      totalCost: number;
      balanceQty: number;
      balanceValue: number;
    }> = [];
    const issueItemsForJson: Array<{
      itemId: string;
      qty: number;
      uomId: string;
      avgCostAtIssue: number;
      totalCost: number;
    }> = [];

    for (const item of validated.items) {
      const inventory = await tx.inventoryValue.findUnique({
        where: { itemId: item.itemId }
      });

      if (
        !inventory ||
        new Decimal(inventory.qtyOnHand.toString()).lt(item.qty)
      ) {
        const it = await tx.item.findUnique({
          where: { id: item.itemId },
          select: { nameId: true }
        });
        throw new Error(
          `Stok tidak mencukupi untuk ${it?.nameId || item.itemId}`
        );
      }

      const avgCostNum = Number(inventory.avgCost);
      const cost = new Decimal(avgCostNum).mul(item.qty);
      totalCost = totalCost.plus(cost);

      const newQty = new Decimal(inventory.qtyOnHand.toString()).minus(item.qty);
      const newValue = newQty.mul(new Decimal(inventory.avgCost.toString()));

      await tx.inventoryValue.update({
        where: { itemId: item.itemId },
        data: {
          qtyOnHand: newQty.toNumber(),
          totalValue: newValue.toNumber()
        }
      });

      movementData.push({
        itemId: item.itemId,
        qty: -item.qty,
        unitCost: avgCostNum,
        totalCost: cost.toNumber(),
        balanceQty: newQty.toNumber(),
        balanceValue: newValue.toNumber()
      });

      issueItemsForJson.push({
        itemId: item.itemId,
        qty: item.qty,
        uomId: item.uomId,
        avgCostAtIssue: avgCostNum,
        totalCost: cost.toNumber()
      });
    }

    const issue = await tx.materialIssue.create({
      data: {
        docNumber,
        woId: data.woId,
        issueType: data.issueType,
        isPartial: data.isPartial,
        parentIssueId: data.parentIssueId ?? undefined,
        notes: data.notes ?? undefined,
        items: JSON.stringify(issueItemsForJson),
        totalCost: totalCost.toNumber(),
        issuedById: userId
      }
    });

    for (const mov of movementData) {
      await tx.stockMovement.create({
        data: {
          itemId: mov.itemId,
          type: 'OUT',
          refType: 'WO_ISSUE',
          refId: issue.id,
          refDocNumber: docNumber,
          qty: mov.qty,
          unitCost: mov.unitCost,
          totalCost: mov.totalCost,
          balanceQty: mov.balanceQty,
          balanceValue: mov.balanceValue,
          notes: `Issue to WO ${wo.docNumber}`
        }
      });
    }

    const plan = (wo.consumptionPlan as any[]) || [];
    for (const issued of validated.items) {
      const planItem = plan.find((p: any) => p.itemId === issued.itemId);
      if (planItem) {
        planItem.issuedQty = (planItem.issuedQty || 0) + issued.qty;
      }
    }

    await tx.workOrder.update({
      where: { id: data.woId },
      data: {
        consumptionPlan: JSON.stringify(plan),
        status: 'IN_PRODUCTION'
      }
    });

    revalidatePath(`/backoffice/work-orders/${data.woId}`);
    return issue;
  });
}

/** Split allocation (PD6): create child issues linked to parent. Minimal stub. */
export async function splitMaterialIssue(
  _originalIssueId: string,
  _splits: Array<{
    vendorId?: string;
    items: Array<{ itemId: string; qty: number }>;
  }>,
  _userId: string
): Promise<void> {
  throw new Error('Split material issue not yet implemented');
}

const receiptSchema = z.object({
  woId: idStr,
  qtyReceived: z.number().positive(),
  qtyRejected: z.number().default(0),
  qcNotes: z.string().optional(),
  qcPhotos: z.array(z.string()).optional()
});

export type ReceiptFormData = z.infer<typeof receiptSchema>;

export async function receiveFG(data: ReceiptFormData, userId: string) {
  receiptSchema.parse(data);

  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('RECEIPT', tx);
    const qtyAccepted = data.qtyReceived - (data.qtyRejected || 0);
    
    const wo = await tx.workOrder.findUnique({
      where: { id: data.woId },
      include: { issues: true }
    });

    if (!wo) throw new Error('Work Order not found');

    const totalMaterialCost = wo.issues.reduce((sum, issue) => {
      return sum.plus(issue.totalCost.toString());
    }, new Decimal(0));

    const avgCostPerUnit =
      qtyAccepted > 0
        ? totalMaterialCost.div(qtyAccepted)
        : new Decimal(0);

    const receipt = await tx.fGReceipt.create({
      data: {
        docNumber,
        woId: data.woId,
        receiptType: wo.outputMode,
        qtyReceived: data.qtyReceived,
        qtyRejected: data.qtyRejected || 0,
        qtyAccepted,
        qcPassed: true,
        qcNotes: data.qcNotes,
        qcPhotos: data.qcPhotos ? JSON.stringify(data.qcPhotos) : null,
        materialCost: totalMaterialCost.toNumber(),
        avgCostPerUnit: avgCostPerUnit.toNumber(),
        totalCostValue: totalMaterialCost.toNumber(),
        receivedById: userId
      }
    });

    const newActualQty =
      (wo.actualQty?.toString() ? Number(wo.actualQty) : 0) + qtyAccepted;
    await tx.workOrder.update({
      where: { id: data.woId },
      data: {
        actualQty: newActualQty,
        status: newActualQty >= Number(wo.plannedQty) ? 'COMPLETED' : 'PARTIAL',
        completedAt:
          newActualQty >= Number(wo.plannedQty) ? new Date() : null
      }
    });

    if (qtyAccepted > 0 && wo.finishedGoodId) {
      const costResult = await calculateMovingAverage(
        wo.finishedGoodId,
        new Decimal(qtyAccepted),
        avgCostPerUnit,
        tx
      );
      await tx.stockMovement.create({
        data: {
          itemId: wo.finishedGoodId,
          type: 'IN',
          refType: 'FG_RECEIPT',
          refId: receipt.id,
          refDocNumber: docNumber,
          qty: qtyAccepted,
          unitCost: avgCostPerUnit.toNumber(),
          totalCost: totalMaterialCost.toNumber(),
          balanceQty: costResult.newQty.toNumber(),
          balanceValue: costResult.newTotalValue.toNumber(),
          notes: `FG receipt ${docNumber}`
        }
      });
    }

    return receipt;
  });
}

export async function cancelWorkOrder(id: string, userId: string, reason?: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    include: { issues: true, receipts: true }
  });
  
  if (!wo) throw new Error('Work Order not found');
  
  if (wo.receipts.length > 0) {
    throw new Error('Cannot cancel Work Order with FG receipts');
  }
  
  await prisma.workOrder.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      canceledAt: new Date(),
      canceledReason: reason
    }
  });
  
  revalidatePath('/backoffice/work-orders');
}

export async function getWorkOrders(filters?: {
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
      finishedGood: {
        select: {
          id: true,
          sku: true,
          nameId: true,
          nameEn: true
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

export async function getWorkOrderById(id: string) {
  return await prisma.workOrder.findUnique({
    where: { id },
    include: {
      vendor: true,
      finishedGood: {
        include: { uom: true }
      },
      issues: {
        orderBy: { issuedAt: 'desc' }
      },
      receipts: {
        orderBy: { receivedAt: 'desc' }
      },
      returns: true
    }
  });
}

/** Get material plan for a finished good and planned qty (for WO create form). */
export async function getMaterialPlan(
  finishedGoodId: string,
  plannedQty: number
) {
  const plan = await generateMaterialPlan(
    finishedGoodId,
    new Decimal(plannedQty)
  );
  return plan.map((m) => ({
    itemId: m.itemId,
    itemName: m.itemName,
    uomId: m.uomId,
    uomCode: m.uomCode,
    qtyRequired: m.qtyRequired.toNumber(),
    wastePercent: m.wastePercent.toNumber(),
    plannedQty: m.plannedQty.toNumber(),
    availableStock: m.availableStock.toNumber(),
    shortage: m.shortage.toNumber()
  }));
}

/** Get reconciliation data for a WO (serialized for client). */
export async function getReconciliation(woId: string) {
  const { lines, summary } = await reconcileWorkOrder(woId);
  return {
    lines: lines.map((l) => ({
      itemId: l.itemId,
      itemName: l.itemName,
      itemSku: l.itemSku,
      uomCode: l.uomCode,
      plannedQty: l.plannedQty.toNumber(),
      issuedQty: l.issuedQty.toNumber(),
      returnedQty: l.returnedQty.toNumber(),
      actualUsed: l.actualUsed.toNumber(),
      theoreticalUsage: l.theoreticalUsage.toNumber(),
      variance: l.variance.toNumber(),
      variancePercent: l.variancePercent.toNumber(),
      varianceValue: l.varianceValue.toNumber(),
      issuedValue: l.issuedValue.toNumber(),
      usedValue: l.usedValue.toNumber(),
      status: l.status
    })),
    summary: {
      totalIssuedValue: summary.totalIssuedValue.toNumber(),
      totalUsedValue: summary.totalUsedValue.toNumber(),
      netVarianceValue: summary.netVarianceValue.toNumber()
    }
  };
}

// Get production statistics
export async function getProductionStats() {
  const [
    totalWOs,
    draftWOs,
    inProductionWOs,
    completedWOs,
    totalIssues,
    totalReceipts
  ] = await Promise.all([
    prisma.workOrder.count(),
    prisma.workOrder.count({ where: { status: 'DRAFT' } }),
    prisma.workOrder.count({ where: { status: 'IN_PRODUCTION' } }),
    prisma.workOrder.count({ where: { status: 'COMPLETED' } }),
    prisma.materialIssue.count(),
    prisma.fGReceipt.count()
  ]);
  
  return {
    totalWOs,
    draftWOs,
    inProductionWOs,
    completedWOs,
    totalIssues,
    totalReceipts
  };
}
