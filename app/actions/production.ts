'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { calculateMaterialNeeds, checkMaterialAvailability } from '@/lib/production/consumption';

const woSchema = z.object({
  vendorId: z.string().uuid(),
  outputMode: z.enum(['GENERIC', 'SKU']),
  plannedQty: z.number().positive(),
  targetDate: z.date().optional(),
  finishedGoodId: z.string().uuid(),
  notes: z.string().optional()
});

export type WOFormData = z.infer<typeof woSchema>;

export async function createWorkOrder(data: WOFormData, userId: string) {
  const validated = woSchema.parse(data);
  
  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('WO', tx);
    
    // Calculate material requirements
    const materialPlan = await calculateMaterialNeeds(
      data.finishedGoodId,
      new Decimal(data.plannedQty)
    );
    
    const wo = await tx.workOrder.create({
      data: {
        docNumber,
        vendorId: data.vendorId,
        outputMode: data.outputMode,
        plannedQty: data.plannedQty,
        targetDate: data.targetDate,
        notes: data.notes,
        createdById: userId,
        consumptionPlan: JSON.stringify(materialPlan.map(m => ({
          itemId: m.itemId,
          itemName: m.itemName,
          plannedQty: m.totalNeeded.toNumber(),
          qtyRequired: m.qtyRequired.toNumber(),
          wastePercent: m.wastePercent.toNumber(),
          uomId: m.uomId,
          issuedQty: 0,
          returnedQty: 0
        })))
      }
    });
    
    return wo;
  });
}

export async function issueWorkOrder(id: string, userId: string) {
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
  woId: z.string().uuid(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    qty: z.number().positive()
  })).min(1),
  issueType: z.enum(['FABRIC', 'ACCESSORIES']),
  isPartial: z.boolean().default(false)
});

export type IssueFormData = z.infer<typeof issueSchema>;

export async function issueMaterials(data: IssueFormData, userId: string) {
  const validated = issueSchema.parse(data);
  
  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('ISSUE', tx);
    let totalCost = new Decimal(0);
    
    // Verify stock availability and calculate costs
    const issueItems = await Promise.all(validated.items.map(async (item) => {
      const inventory = await tx.inventoryValue.findUnique({
        where: { itemId: item.itemId }
      });
      
      if (!inventory || new Decimal(inventory.qtyOnHand.toString()).lt(item.qty)) {
        throw new Error(`Insufficient stock for item ${item.itemId}`);
      }
      
      const cost = new Decimal(inventory.avgCost.toString()).mul(item.qty);
      totalCost = totalCost.plus(cost);
      
      // Deduct from inventory
      await tx.inventoryValue.update({
        where: { itemId: item.itemId },
        data: {
          qtyOnHand: { decrement: item.qty },
          totalValue: { decrement: cost.toNumber() }
        }
      });
      
      // Create OUT movement
      await tx.stockMovement.create({
        data: {
          itemId: item.itemId,
          type: 'OUT',
          refType: 'WO_ISSUE',
          refId: data.woId,
          refDocNumber: docNumber,
          qty: -item.qty,
          unitCost: inventory.avgCost,
          totalCost: cost.toNumber(),
          balanceQty: new Decimal(inventory.qtyOnHand.toString()).minus(item.qty).toNumber(),
          balanceValue: new Decimal(inventory.totalValue.toString()).minus(cost).toNumber()
        }
      });
      
      return {
        itemId: item.itemId,
        qty: item.qty,
        avgCostAtIssue: inventory.avgCost,
        uomId: inventory.itemId
      };
    }));
    
    // Create issue document
    const issue = await tx.materialIssue.create({
      data: {
        docNumber,
        woId: data.woId,
        issueType: data.issueType,
        isPartial: data.isPartial,
        items: JSON.stringify(issueItems),
        totalCost: totalCost.toNumber(),
        issuedById: userId
      }
    });
    
    // Update WO issued quantities in consumptionPlan
    const wo = await tx.workOrder.findUnique({
      where: { id: data.woId },
      select: { consumptionPlan: true }
    });
    
    const plan = wo?.consumptionPlan as any[];
    validated.items.forEach(issued => {
      const planItem = plan.find((p: any) => p.itemId === issued.itemId);
      if (planItem) {
        planItem.issuedQty = (planItem.issuedQty || 0) + issued.qty;
      }
    });
    
    await tx.workOrder.update({
      where: { id: data.woId },
      data: { 
        consumptionPlan: JSON.stringify(plan),
        status: 'IN_PRODUCTION'
      }
    });
    
    return issue;
  });
}

const receiptSchema = z.object({
  woId: z.string().uuid(),
  qtyReceived: z.number().positive(),
  qtyRejected: z.number().default(0),
  qcNotes: z.string().optional(),
  qcPhotos: z.array(z.string()).optional()
});

export type ReceiptFormData = z.infer<typeof receiptSchema>;

export async function receiveFG(data: ReceiptFormData, userId: string) {
  const validated = receiptSchema.parse(data);
  
  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('RECEIPT', tx);
    const qtyAccepted = data.qtyReceived - (data.qtyRejected || 0);
    
    // Get WO details
    const wo = await tx.workOrder.findUnique({
      where: { id: data.woId },
      include: { issues: true }
    });
    
    if (!wo) throw new Error('Work Order not found');
    
    // Calculate production cost based on materials issued
    const totalMaterialCost = wo.issues.reduce((sum, issue) => {
      return sum.plus(issue.totalCost.toString());
    }, new Decimal(0));
    
    const avgCostPerUnit = qtyAccepted > 0 
      ? totalMaterialCost.div(qtyAccepted)
      : new Decimal(0);
    
    // Create receipt
    const receipt = await tx.fGReceipt.create({
      data: {
        docNumber,
        woId: data.woId,
        receiptType: wo.outputMode,
        qtyReceived: data.qtyReceived,
        qtyRejected: data.qtyRejected || 0,
        qtyAccepted,
        qcNotes: data.qcNotes,
        qcPhotos: data.qcPhotos ? JSON.stringify(data.qcPhotos) : null,
        receivedById: userId,
        avgCostPerUnit: avgCostPerUnit.toNumber(),
        totalCostValue: totalMaterialCost.toNumber()
      }
    });
    
    // Update WO
    const newActualQty = (wo.actualQty?.toString() ? Number(wo.actualQty) : 0) + qtyAccepted;
    await tx.workOrder.update({
      where: { id: data.woId },
      data: {
        actualQty: newActualQty,
        status: newActualQty >= Number(wo.plannedQty) ? 'COMPLETED' : 'PARTIAL',
        completedAt: newActualQty >= Number(wo.plannedQty) ? new Date() : null
      }
    });
    
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
