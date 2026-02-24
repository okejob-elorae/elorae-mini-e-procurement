'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
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
    throw new Error(pinResult.messageKey ?? pinResult.message);
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

    // Generate next ADJ doc number from max existing in same period (avoid unique constraint)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `ADJ/${year}/${month}/`;
    const existing = await tx.stockAdjustment.findMany({
      where: { docNumber: { startsWith: prefix } },
      select: { docNumber: true },
      orderBy: { docNumber: 'desc' },
      take: 1,
    });
    const nextNum = existing.length
      ? (parseInt(existing[0].docNumber.slice(prefix.length), 10) || 0) + 1
      : 1;
    const docNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;
    
    // Create adjustment document
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

export async function getStockAdjustments(
  itemId?: string,
  opts?: { page: number; pageSize: number }
) {
  const where: any = {};

  if (itemId) {
    where.itemId = itemId;
  }

  const include = {
    item: true,
    approvedBy: { select: { name: true } },
    createdBy: { select: { name: true, email: true } },
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.stockAdjustment.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockAdjustment.count({ where }),
    ]);
    const items = rows.map((r) => ({
      ...r,
      qtyChange: toNum(r.qtyChange),
      prevQty: toNum(r.prevQty),
      newQty: toNum(r.newQty),
      prevAvgCost: toNum(r.prevAvgCost),
      newAvgCost: toNum(r.newAvgCost),
      item: serializeItemForClient(r.item as { reorderPoint?: unknown; [k: string]: unknown }),
    }));
    return { items, totalCount };
  }

  const rows = await prisma.stockAdjustment.findMany({
    where,
    include,
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

export async function getStockAdjustmentById(id: string) {
  const row = await prisma.stockAdjustment.findUnique({
    where: { id },
    include: {
      item: true,
      approvedBy: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  if (!row) return null;
  return {
    ...row,
    qtyChange: toNum(row.qtyChange),
    prevQty: toNum(row.prevQty),
    newQty: toNum(row.newQty),
    prevAvgCost: toNum(row.prevAvgCost),
    newAvgCost: toNum(row.newAvgCost),
    item: serializeItemForClient(row.item as { reorderPoint?: unknown; [k: string]: unknown }),
  };
}

// Get inventory statistics
export async function getInventoryStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalItems,
    inventoryWithReorder,
    totalValue,
    totalGRNs,
    todayMovements
  ] = await Promise.all([
    prisma.item.count({ where: { isActive: true } }),
    prisma.inventoryValue.findMany({
      where: { item: { reorderPoint: { not: null } } },
      include: { item: { select: { reorderPoint: true } } },
    }),
    prisma.inventoryValue.aggregate({
      _sum: { totalValue: true }
    }),
    prisma.gRN.count(),
    prisma.stockMovement.count({
      where: {
        createdAt: { gte: todayStart }
      }
    })
  ]);

  const lowStockItems = inventoryWithReorder.filter(
    (r) =>
      r.item.reorderPoint != null &&
      Number(r.qtyOnHand) <= Number(r.item.reorderPoint)
  ).length;
  
  return {
    totalItems,
    lowStockItems,
    totalValue: Number(totalValue._sum.totalValue ?? 0),
    totalGRNs,
    todayMovements,
  };
}
