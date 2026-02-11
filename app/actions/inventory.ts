'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';

const adjustmentSchema = z.object({
  itemId: z.string().min(1, 'Item is required'),
  type: z.enum(['POSITIVE', 'NEGATIVE']),
  qty: z.number().positive(),
  reason: z.string().min(5, 'Alasan minimal 5 karakter'),
  evidenceUrl: z.string().url().optional(),
});

export type AdjustmentFormData = z.infer<typeof adjustmentSchema>;

export async function createStockAdjustment(
  data: AdjustmentFormData,
  userPin: string,
  userId: string,
  ipAddress?: string
) {
  adjustmentSchema.parse(data);

  const pinResult = await verifyPinForAction(
    userId,
    userPin,
    'STOCK_ADJUSTMENT',
    undefined,
    ipAddress
  );
  if (!pinResult.success) {
    throw new Error(pinResult.message);
  }

  return await prisma.$transaction(async (tx) => {

    // Get current inventory
    const current = await tx.inventoryValue.findUnique({
      where: { itemId: data.itemId }
    });

    if (!current) {
      throw new Error('Item tidak memiliki record inventory');
    }

    const prevQty = new Decimal(current.qtyOnHand.toString());
    const prevAvgCost = new Decimal(current.avgCost.toString());
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
    
    const newTotalValue = newQty.mul(prevAvgCost);

    // Update inventory (avg cost unchanged)
    await tx.inventoryValue.update({
      where: { itemId: data.itemId },
      data: {
        qtyOnHand: newQty.toNumber(),
        totalValue: newTotalValue.toNumber(),
        lastUpdated: new Date(),
      },
    });

    // Create stock movement
    const adjQty = data.type === 'POSITIVE' ? data.qty : -data.qty;
    const totalCostAdj =
      data.type === 'POSITIVE'
        ? qtyChange.mul(prevAvgCost).toNumber()
        : qtyChange.mul(prevAvgCost).neg().toNumber();

    await tx.stockMovement.create({
      data: {
        itemId: data.itemId,
        type: 'ADJUSTMENT',
        refType: 'ADJUSTMENT',
        refId: adjustment.id,
        refDocNumber: docNumber,
        qty: adjQty,
        unitCost: prevAvgCost.toNumber(),
        totalCost: totalCostAdj,
        balanceQty: newQty.toNumber(),
        balanceValue: newTotalValue.toNumber(),
        notes: `Adjustment: ${data.reason}`,
      },
    });

    // Audit log (before = state at start of tx)
    const prevValue = prevQty.mul(prevAvgCost);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'STOCK_ADJUSTMENT',
        entityType: 'StockAdjustment',
        entityId: adjustment.id,
        changes: {
          before: { qty: prevQty.toString(), value: prevValue.toString() },
          after: { qty: newQty.toString(), value: newTotalValue.toString() },
          reason: data.reason,
          type: data.type,
        },
        ipAddress,
      },
    });

    revalidatePath('/backoffice/inventory');
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

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

function serializeItemForClient(item: { reorderPoint?: unknown; [k: string]: unknown } | null) {
  if (!item) return null;
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
  };
}

export async function getStockAdjustments(itemId?: string) {
  const where: any = {};

  if (itemId) {
    where.itemId = itemId;
  }

  const rows = await prisma.stockAdjustment.findMany({
    where,
    include: {
      item: true,
      approvedBy: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    ...r,
    qtyChange: toNum(r.qtyChange),
    prevQty: toNum(r.prevQty),
    newQty: toNum(r.newQty),
    prevAvgCost: toNum(r.prevAvgCost),
    newAvgCost: toNum(r.newAvgCost),
    item: serializeItemForClient(r.item as { reorderPoint?: unknown; [k: string]: unknown }),
  }));
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
    totalValue: Number(totalValue._sum.totalValue ?? 0),
    totalGRNs,
    todayMovements,
  };
}
