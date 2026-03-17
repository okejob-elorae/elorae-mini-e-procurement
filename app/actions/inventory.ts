'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { getActorName, notifyStockAdjustmentCreated } from '@/app/actions/notifications';

const adjustmentSchema = z.object({
  itemId: z.string().min(1, 'Item is required'),
  variantSku: z.string().optional(),
  type: z.enum(['POSITIVE', 'NEGATIVE']),
  qty: z.number().positive(),
  uomId: z.string().min(1).optional(),
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
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.INVENTORY_MANAGE);
  
  adjustmentSchema.parse(data);

  // Use server session for PIN verification; fallback to lookup by email if session id not in DB (e.g. stale JWT)
  const pinResult = await verifyPinForAction(
    session.user.id,
    userPin,
    'STOCK_ADJUSTMENT',
    undefined,
    ipAddress,
    session.user.email ?? undefined
  );
  if (!pinResult.success) {
    throw new Error(pinResult.messageKey ?? pinResult.message);
  }
  const effectiveUserId = pinResult.userId ?? session.user.id;

  const adjustmentResult = await prisma.$transaction(async (tx) => {

    // Keep variantSku consistent with inventory costing helpers:
    // compound keys use '' for non-variant items (no nulls).
    const variantKey = data.variantSku ?? '';
    const compositeWhere = {
      itemId_variantSku: { itemId: data.itemId, variantSku: variantKey },
    };

    // Get item (for base UOM) and current inventory for (itemId, variantSku)
    const [item, current] = await Promise.all([
      tx.item.findUnique({
        where: { id: data.itemId },
        select: { uomId: true },
      }),
      tx.inventoryValue.findUnique({
        where: compositeWhere,
      }),
    ]);

    if (!item) throw new Error('Item not found');
    if (!current) {
      throw new Error('Item tidak memiliki record inventory');
    }

    let qtyInBaseUom = new Decimal(data.qty);
    if (data.uomId && data.uomId !== item.uomId) {
      const conv = await tx.uOMConversion.findUnique({
        where: {
          fromUomId_toUomId: {
            fromUomId: data.uomId,
            toUomId: item.uomId,
          },
        },
      });
      if (conv) {
        qtyInBaseUom = new Decimal(data.qty).mul(conv.factor.toString());
      } else {
        const convReverse = await tx.uOMConversion.findUnique({
          where: {
            fromUomId_toUomId: {
              fromUomId: item.uomId,
              toUomId: data.uomId,
            },
          },
        });
        if (convReverse) {
          qtyInBaseUom = new Decimal(data.qty).div(convReverse.factor.toString());
        } else {
          throw new Error(`No UOM conversion defined between selected UOM and item base UOM`);
        }
      }
    }

    const prevQty = new Decimal(current.qtyOnHand.toString());
    const prevAvgCost = new Decimal(current.avgCost.toString());
    const qtyChange = qtyInBaseUom;
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
        qtyChange: qtyChange.toNumber(),
        reason: data.reason,
        evidenceUrl: data.evidenceUrl,
        prevQty: prevQty.toNumber(),
        newQty: newQty.toNumber(),
        prevAvgCost: prevAvgCost.toNumber(),
        newAvgCost: prevAvgCost.toNumber(),
        approvedById: effectiveUserId,
        createdById: effectiveUserId
      }
    });
    
    const newTotalValue = newQty.mul(prevAvgCost);

    // Update inventory (avg cost unchanged)
    await tx.inventoryValue.update({
      where: compositeWhere,
      data: {
        qtyOnHand: newQty.toNumber(),
        totalValue: newTotalValue.toNumber(),
        lastUpdated: new Date(),
      },
    });

    // Create stock movement (in base UOM)
    const adjQtyNum = qtyChange.toNumber();
    const adjQty = data.type === 'POSITIVE' ? adjQtyNum : -adjQtyNum;
    const totalCostAdj =
      data.type === 'POSITIVE'
        ? qtyChange.mul(prevAvgCost).toNumber()
        : qtyChange.mul(prevAvgCost).neg().toNumber();

    await tx.stockMovement.create({
      data: {
        itemId: data.itemId,
        variantSku: variantKey,
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
        userId: effectiveUserId,
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

  getActorName(effectiveUserId)
    .then((triggeredByName) =>
      notifyStockAdjustmentCreated(adjustmentResult.id, adjustmentResult.docNumber, triggeredByName)
    )
    .catch(() => {});
  return adjustmentResult;
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

/** Get average cost per item for given item IDs (weighted by qty across variants). */
export async function getItemAvgCosts(
  itemIds: string[]
): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const rows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, qtyOnHand: true, totalValue: true },
  });
  const byItem = new Map<string, { qty: number; totalValue: number }>();
  for (const r of rows) {
    const qty = Number(r.qtyOnHand);
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.qty += qty;
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, { qty, totalValue: val });
    }
  }
  const out: Record<string, number> = {};
  for (const [id, agg] of byItem.entries()) {
    out[id] = agg.qty > 0 ? agg.totalValue / agg.qty : 0;
  }
  return out;
}

export type RejectedGoodsRecapRow = {
  id: string;
  itemId: string;
  qty: number;
  refType: string;
  refDocNumber: string;
  woId: string | null;
  receivedAt: Date;
  notes: string | null;
  createdAt: Date;
  item: { sku: string; nameId: string; nameEn: string | null };
};

/** Get rejected goods recap (for report page). */
export async function getRejectedGoodsRecap(filters?: {
  itemId?: string;
  woId?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  pageSize?: number;
}): Promise<{ items: RejectedGoodsRecapRow[]; totalCount: number }> {
  const where: Record<string, unknown> = {};
  if (filters?.itemId) where.itemId = filters.itemId;
  if (filters?.woId) where.woId = filters.woId;
  if (filters?.fromDate || filters?.toDate) {
    where.receivedAt = {};
    if (filters.fromDate) (where.receivedAt as Record<string, Date>).gte = filters.fromDate;
    if (filters.toDate) (where.receivedAt as Record<string, Date>).lte = filters.toDate;
  }

  const [rows, totalCount] = await Promise.all([
    prisma.rejectedGoodsLedger.findMany({
      where,
      include: {
        item: { select: { sku: true, nameId: true, nameEn: true } },
      },
      orderBy: { receivedAt: 'desc' },
      ...(filters?.page != null && filters?.pageSize != null && filters.pageSize > 0
        ? { skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }
        : {}),
    }),
    prisma.rejectedGoodsLedger.count({ where }),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    variantSku: r.variantSku ?? null,
    qty: Number(r.qty),
    refType: r.refType,
    refDocNumber: r.refDocNumber,
    woId: r.woId,
    receivedAt: r.receivedAt,
    notes: r.notes,
    createdAt: r.createdAt,
    item: r.item,
  }));

  return { items, totalCount };
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

  const inventoryByItem = new Map<string, { qtyOnHand: number; reorderPoint: number | null }>();
  for (const r of inventoryWithReorder) {
    const rp = r.item.reorderPoint != null ? Number(r.item.reorderPoint) : null;
    const existing = inventoryByItem.get(r.itemId);
    if (existing) {
      existing.qtyOnHand += Number(r.qtyOnHand);
    } else {
      inventoryByItem.set(r.itemId, { qtyOnHand: Number(r.qtyOnHand), reorderPoint: rp });
    }
  }
  const lowStockItems = Array.from(inventoryByItem.values()).filter(
    (a) => a.reorderPoint != null && a.qtyOnHand <= a.reorderPoint
  ).length;
  
  return {
    totalItems,
    lowStockItems,
    totalValue: Number(totalValue._sum.totalValue ?? 0),
    totalGRNs,
    todayMovements,
  };
}
