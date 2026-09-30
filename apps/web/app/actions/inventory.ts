'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { moveMainStock, prisma } from '@elorae/db';
import type { Prisma, StockLedgerRefType } from '@elorae/db';
import { findExistingInventoryValueRow } from '@/lib/inventory/costing';
import {
  filterAndSortStockItems,
  summarizeStockHealth,
  type StockSort,
  type StockStatus,
} from "@/lib/inventory/stock-status";
import { buildVariantStockChips } from "@/lib/inventory/variant-stock-label";
import { variantDetailForSku } from '@/lib/items/variants';
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

async function requireInventoryView(): Promise<void> {
  const session = await auth();
  requirePermission(session?.user?.permissions ?? [], PERMISSIONS.INVENTORY_VIEW);
}

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

    // Get item (for base UOM) and current inventory for (itemId, variantSku). The inventory
    // lookup is OR-tolerant on the pooled "" bucket -- ERP-created rows are spelled null, so a
    // strict compound-key lookup on '' would miss them.
    const [item, current] = await Promise.all([
      tx.item.findUnique({
        where: { id: data.itemId },
        select: { uomId: true },
      }),
      findExistingInventoryValueRow(tx, data.itemId, variantKey),
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
    const adjQtyNum = qtyChange.toNumber();
    const adjQty = data.type === 'POSITIVE' ? adjQtyNum : -adjQtyNum;

    // Computed here so it can be passed straight into the ledger mover below as totalCost.
    const totalCostAdj =
      data.type === 'POSITIVE'
        ? qtyChange.mul(prevAvgCost).toNumber()
        : qtyChange.mul(prevAvgCost).neg().toNumber();

    // Update inventory (avg cost unchanged)
    await moveMainStock(tx, {
      itemId: data.itemId,
      variantSku: variantKey,
      qtyDelta: adjQty,
      totalValue: newTotalValue.toNumber(),
      unitCost: prevAvgCost.toNumber(),
      totalCost: totalCostAdj,
      balanceValue: newTotalValue.toNumber(),
      inventoryValueId: current.id,
      refType: "StockAdjustment" satisfies StockLedgerRefType,
      refId: adjustment.id,
      refDocNumber: adjustment.docNumber,
      createdById: effectiveUserId,
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


const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

function serializeItemForClient(item: {
  reorderPoint?: unknown;
  overReceiveThreshold?: unknown;
  sellingPrice?: unknown;
  [k: string]: unknown;
} | null) {
  if (!item) return null;
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
    overReceiveThreshold: item.overReceiveThreshold != null ? toNum(item.overReceiveThreshold) : null,
    sellingPrice: item.sellingPrice != null ? toNum(item.sellingPrice) : null,
  };
}

export async function getStockAdjustments(
  itemId?: string,
  opts?: { page: number; pageSize: number }
) {
  await requireInventoryView();
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
  await requireInventoryView();
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

/** Get current inventory value for an item (or item+variant). Serialized for client. */
export async function getInventoryValue(itemId: string, variantSku?: string | null) {
  await requireInventoryView();
  const row = await findExistingInventoryValueRow(prisma, itemId, variantSku);
  if (!row) return null;
  const v = await prisma.inventoryValue.findUnique({
    where: { id: row.id },
    include: {
      item: {
        select: {
          sku: true,
          nameId: true,
          nameEn: true,
          uom: {
            select: {
              code: true,
              nameId: true,
            },
          },
        },
      },
    },
  });
  if (!v) return null;
  return {
    ...v,
    qtyOnHand: Number(v.qtyOnHand),
    avgCost: Number(v.avgCost),
    totalValue: Number(v.totalValue),
  };
}

const inventorySnapshotInclude = {
  item: {
    select: {
      sku: true,
      nameId: true,
      nameEn: true,
      type: true,
      reorderPoint: true,
      variants: true,
      uom: {
        select: {
          code: true,
          nameId: true,
        },
      },
    },
  },
};

const inventorySnapshotOrderBy = {
  item: {
    sku: "asc" as const,
  },
};

type InventorySnapshotRow = Prisma.InventoryValueGetPayload<{
  include: typeof inventorySnapshotInclude;
}>;

type VariantChipAccum = {
  variantSku: string;
  qtyOnHand: number;
  reservedQty: number;
};

/**
 * Aggregate InventoryValue rows by itemId (one row per item; sum qty/reserved/value, weighted avg
 * cost). Preserves factual per-variant chips from non-empty variantSku rows.
 */
function aggregateSnapshotByItemId(values: InventorySnapshotRow[]) {
  const byItem = new Map<
    string,
    {
      qtyOnHand: number;
      reservedQty: number;
      totalValue: number;
      item: InventorySnapshotRow["item"];
      variantRows: VariantChipAccum[];
    }
  >();
  for (const v of values) {
    const qty = toNum(v.qtyOnHand) ?? 0;
    const reserved = toNum(v.reservedQty) ?? 0;
    const val = toNum(v.totalValue) ?? 0;
    const existing = byItem.get(v.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.reservedQty += reserved;
      existing.totalValue += val;
      existing.variantRows.push({
        variantSku: v.variantSku ?? "",
        qtyOnHand: qty,
        reservedQty: reserved,
      });
    } else {
      byItem.set(v.itemId, {
        qtyOnHand: qty,
        reservedQty: reserved,
        totalValue: val,
        item: v.item,
        variantRows: [
          {
            variantSku: v.variantSku ?? "",
            qtyOnHand: qty,
            reservedQty: reserved,
          },
        ],
      });
    }
  }
  const rows = Array.from(byItem.entries()).map(([itemId, agg]) => {
    const reorderPoint =
      agg.item.reorderPoint != null ? toNum(agg.item.reorderPoint) : null;
    const { variants: itemVariantsJson, ...itemRest } = agg.item;
    const variants = buildVariantStockChips(agg.variantRows, itemVariantsJson);
    return {
      itemId,
      sku: agg.item.sku ?? "",
      qtyOnHand: agg.qtyOnHand,
      reservedQty: agg.reservedQty,
      available: agg.qtyOnHand - agg.reservedQty,
      totalValue: agg.totalValue,
      avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
      reorderPoint,
      variants,
      item: {
        ...itemRest,
        reorderPoint,
      },
    };
  });
  return rows;
}

export type GetInventorySnapshotOpts = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: StockStatus;
  sort?: StockSort;
};

/** Get inventory snapshot (one row per item, aggregated from variant-level rows). */
export async function getInventorySnapshot(opts?: GetInventorySnapshotOpts) {
  await requireInventoryView();

  const values = await prisma.inventoryValue.findMany({
    include: inventorySnapshotInclude,
    orderBy: inventorySnapshotOrderBy,
  });

  const allItems = aggregateSnapshotByItemId(values);
  /* Portfolio summary (value / count / health) is always over the full set. */
  const totalValue = allItems.reduce((sum, v) => sum + v.totalValue, 0);
  const health = summarizeStockHealth(
    allItems.map((v) => ({
      available: v.available,
      reorderPoint: v.item.reorderPoint,
    })),
  );
  /* lowStockItems kept for callers; maps to menipis (excludes habis/negatif). */
  const lowStockItems = health.menipisCount;

  /**
   * Search filters the list (server-side, across all rows — not just the current page).
   * Also matches against per-variant SKUs (e.g. "27000101P-BLK-XL") so a variant-code
   * search surfaces the article it belongs to.
   */
  const q = opts?.search?.trim().toLowerCase();
  const searched = q
    ? allItems.filter(
        (v) =>
          v.item.sku.toLowerCase().includes(q) ||
          v.item.nameId.toLowerCase().includes(q) ||
          v.variants.some((variant) => variant.variantSku.toLowerCase().includes(q)),
      )
    : allItems;

  const matched = filterAndSortStockItems(searched, {
    status: opts?.status,
    sort: opts?.sort ?? "stock_desc",
  });

  const portfolio = {
    totalValue,
    totalItems: allItems.length,
    lowStockItems,
    totalAvailable: health.totalAvailable,
    menipisCount: health.menipisCount,
    habisCount: health.habisCount,
    negatifCount: health.negatifCount,
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const start = (opts.page - 1) * opts.pageSize;
    const items = matched.slice(start, start + opts.pageSize);
    return {
      items,
      totalCount: matched.length,
      ...portfolio,
    };
  }

  return {
    items: matched,
    totalCount: matched.length,
    ...portfolio,
  };
}

export type RejectedGoodsRecapRow = {
  id: string;
  itemId: string;
  /** Set when rejection was recorded per variant (FG receipt breakdown or vendor return line). */
  variantSku: string | null;
  /** Attribute summary from Item.variants when resolvable (e.g. Size: M · Color: Black). */
  variantDetail: string | null;
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
  await requireInventoryView();
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
        item: { select: { sku: true, nameId: true, nameEn: true, variants: true } },
      },
      orderBy: { receivedAt: 'desc' },
      ...(filters?.page != null && filters?.pageSize != null && filters.pageSize > 0
        ? { skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }
        : {}),
    }),
    prisma.rejectedGoodsLedger.count({ where }),
  ]);

  const items = rows.map((r) => {
    const variantSku = r.variantSku ?? null;
    return {
      id: r.id,
      itemId: r.itemId,
      variantSku,
      variantDetail: variantDetailForSku(r.item.variants, variantSku),
      qty: Number(r.qty),
      refType: r.refType,
      refDocNumber: r.refDocNumber,
      woId: r.woId,
      receivedAt: r.receivedAt,
      notes: r.notes,
      createdAt: r.createdAt,
      item: {
        sku: r.item.sku,
        nameId: r.item.nameId,
        nameEn: r.item.nameEn,
      },
    };
  });

  return { items, totalCount };
}
