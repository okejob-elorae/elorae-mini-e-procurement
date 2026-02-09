'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { calculateMovingAverage } from '@/lib/inventory/costing';
import { verifyPin } from '@/lib/auth';

const grnItemSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().positive(),
  unitCost: z.number().positive()
});

const grnSchema = z.object({
  poId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  items: z.array(grnItemSchema).min(1),
  photoUrls: z.array(z.string()).optional(),
  notes: z.string().optional()
});

export type GRNFormData = z.infer<typeof grnSchema>;

export async function createGRN(data: GRNFormData, userId: string) {
  const validated = grnSchema.parse(data);
  
  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('GRN', tx);
    let totalAmount = new Decimal(0);
    
    // Process each item with moving average calculation
    const grnItems = await Promise.all(validated.items.map(async (item) => {
      const qty = new Decimal(item.qty);
      const cost = new Decimal(item.unitCost);
      totalAmount = totalAmount.plus(qty.mul(cost));
      
      // Calculate new average cost
      const costCalc = await calculateMovingAverage(
        item.itemId,
        qty,
        cost,
        tx
      );
      
      // Create stock movement
      await tx.stockMovement.create({
        data: {
          itemId: item.itemId,
          type: 'IN',
          refType: 'GRN',
          refId: 'temp',
          refDocNumber: docNumber,
          qty: item.qty,
          unitCost: item.unitCost,
          totalCost: qty.mul(cost).toNumber(),
          balanceQty: costCalc.previousQty.plus(qty).toNumber(),
          balanceValue: costCalc.newTotalValue.toNumber()
        }
      });
      
      return {
        itemId: item.itemId,
        qty: item.qty,
        unitCost: item.unitCost,
        totalCost: qty.mul(cost).toNumber(),
        prevAvgCost: costCalc.previousAvgCost.toNumber(),
        newAvgCost: costCalc.newAvgCost.toNumber()
      };
    }));
    
    // Create GRN
    const grn = await tx.gRN.create({
      data: {
        docNumber,
        poId: validated.poId,
        supplierId: validated.supplierId,
        receivedBy: userId,
        totalAmount: totalAmount.toNumber(),
        photoUrls: validated.photoUrls ? JSON.stringify(validated.photoUrls) : null,
        notes: validated.notes,
        items: JSON.stringify(grnItems)
      }
    });
    
    // Update stock movements with correct refId
    await tx.stockMovement.updateMany({
      where: { refDocNumber: docNumber },
      data: { refId: grn.id }
    });
    
    // If linked to PO, update PO received quantities
    if (validated.poId) {
      for (const item of validated.items) {
        await tx.pOItem.updateMany({
          where: { 
            poId: validated.poId,
            itemId: item.itemId
          },
          data: {
            receivedQty: { increment: item.qty }
          }
        });
      }
      
      // Check if PO fully received
      const poItems = await tx.pOItem.findMany({
        where: { poId: validated.poId }
      });
      
      const allReceived = poItems.every(item => 
        item.receivedQty >= item.qty
      );
      
      await tx.purchaseOrder.update({
        where: { id: validated.poId },
        data: { 
          status: allReceived ? 'CLOSED' : 'PARTIAL'
        }
      });
    }
    
    return grn;
  });
}

const adjustmentSchema = z.object({
  itemId: z.string().uuid(),
  type: z.enum(['POSITIVE', 'NEGATIVE']),
  qty: z.number().positive(),
  reason: z.string().min(1, 'Reason is required'),
  evidenceUrl: z.string().optional()
});

export type AdjustmentFormData = z.infer<typeof adjustmentSchema>;

export async function createStockAdjustment(
  data: AdjustmentFormData,
  userPin: string,
  userId: string,
  ipAddress?: string
) {
  const validated = adjustmentSchema.parse(data);
  
  return await prisma.$transaction(async (tx) => {
    // Verify PIN
    const isValid = await verifyPin(userId, userPin);
    
    if (!isValid) {
      throw new Error('Invalid PIN');
    }
    
    // Get current inventory
    const current = await tx.inventoryValue.findUnique({
      where: { itemId: data.itemId }
    });
    
    const prevQty = new Decimal(current?.qtyOnHand?.toString() || 0);
    const prevAvgCost = new Decimal(current?.avgCost?.toString() || 0);
    const qtyChange = new Decimal(data.qty);
    const newQty = data.type === 'POSITIVE' 
      ? prevQty.plus(qtyChange)
      : prevQty.minus(qtyChange);
    
    if (newQty.lt(0)) {
      throw new Error('Adjustment would result in negative stock');
    }
    
    // Create adjustment document
    const docNumber = await generateDocNumber('ADJ', tx);
    const adjustment = await tx.stockAdjustment.create({
      data: {
        docNumber,
        itemId: data.itemId,
        type: data.type,
        qtyChange: data.qty,
        reason: data.reason,
        evidenceUrl: data.evidenceUrl,
        prevQty: prevQty.toNumber(),
        newQty: newQty.toNumber(),
        prevAvgCost: prevAvgCost.toNumber(),
        newAvgCost: prevAvgCost.toNumber(),
        approvedById: userId,
        createdById: userId
      }
    });
    
    // Update inventory
    await tx.inventoryValue.update({
      where: { itemId: data.itemId },
      data: {
        qtyOnHand: newQty.toNumber(),
        totalValue: newQty.mul(prevAvgCost).toNumber()
      }
    });
    
    // Create stock movement
    await tx.stockMovement.create({
      data: {
        itemId: data.itemId,
        type: 'ADJUSTMENT',
        refType: 'ADJUSTMENT',
        refId: adjustment.id,
        refDocNumber: docNumber,
        qty: data.type === 'POSITIVE' ? data.qty : -data.qty,
        balanceQty: newQty.toNumber(),
        balanceValue: newQty.mul(prevAvgCost).toNumber()
      }
    });
    
    // Audit log
    await tx.auditLog.create({
      data: {
        userId,
        action: 'STOCK_ADJUSTMENT',
        entityType: 'StockAdjustment',
        entityId: adjustment.id,
        changes: {
          before: { qty: prevQty.toString() },
          after: { qty: newQty.toString() },
          reason: data.reason
        },
        ipAddress
      }
    });
    
    return adjustment;
  });
}

export async function getGRNs(filters?: {
  supplierId?: string;
  fromDate?: Date;
  toDate?: Date;
}) {
  const where: any = {};
  
  if (filters?.supplierId) {
    where.supplierId = filters.supplierId;
  }
  
  if (filters?.fromDate || filters?.toDate) {
    where.grnDate = {};
    if (filters.fromDate) {
      where.grnDate.gte = filters.fromDate;
    }
    if (filters.toDate) {
      where.grnDate.lte = filters.toDate;
    }
  }
  
  return await prisma.gRN.findMany({
    where,
    include: {
      supplier: {
        select: {
          name: true,
          code: true
        }
      },
      po: {
        select: {
          docNumber: true
        }
      }
    },
    orderBy: { grnDate: 'desc' }
  });
}

export async function getStockAdjustments(itemId?: string) {
  const where: any = {};
  
  if (itemId) {
    where.itemId = itemId;
  }
  
  return await prisma.stockAdjustment.findMany({
    where,
    include: {
      item: {
        select: {
          sku: true,
          nameId: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

// Get inventory statistics
export async function getInventoryStats() {
  const [
    totalItems,
    lowStockItems,
    totalValue,
    totalGRNs,
    todayMovements
  ] = await Promise.all([
    prisma.item.count({ where: { isActive: true } }),
    prisma.inventoryValue.count({
      where: {
        item: {
          reorderPoint: { not: null }
        },
        qtyOnHand: {
          lte: prisma.inventoryValue.fields.qtyOnHand
        }
      }
    }),
    prisma.inventoryValue.aggregate({
      _sum: { totalValue: true }
    }),
    prisma.gRN.count(),
    prisma.stockMovement.count({
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    })
  ]);
  
  return {
    totalItems,
    lowStockItems,
    totalValue: totalValue._sum.totalValue || 0,
    totalGRNs,
    todayMovements
  };
}
