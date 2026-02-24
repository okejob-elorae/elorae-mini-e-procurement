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

/** Parse consumptionPlan from DB (Json = string or object) to array for client. */
function parseConsumptionPlan(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Serialize WO (and optional includes) to plain object for Client Components (no Prisma Decimal). */
function serializeWorkOrder(wo: {
  id: string;
  docNumber: string;
  vendorId: string;
  finishedGoodId: string;
  outputMode: string;
  plannedQty: unknown;
  actualQty?: unknown;
  targetDate: Date | null;
  status: string;
  issuedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  canceledReason: string | null;
  consumptionPlan: unknown;
  skuBreakdown?: unknown;
  rollBreakdown?: unknown;
  notes: string | null;
  syncStatus?: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  vendor?: unknown;
  finishedGood?: unknown;
  issues?: Array<{ id: string; docNumber: string; issueType: string; totalCost: unknown; issuedAt: Date; [k: string]: unknown }>;
  receipts?: Array<{ id: string; docNumber: string; qtyReceived: unknown; qtyRejected?: unknown; qtyAccepted: unknown; materialCost?: unknown; avgCostPerUnit?: unknown; totalCostValue?: unknown; receivedAt: Date; [k: string]: unknown }>;
  returns?: unknown[];
}) {
  const plan = parseConsumptionPlan(wo.consumptionPlan);
  const out: Record<string, unknown> = {
    id: wo.id,
    docNumber: wo.docNumber,
    vendorId: wo.vendorId,
    finishedGoodId: wo.finishedGoodId,
    outputMode: wo.outputMode,
    plannedQty: Number(wo.plannedQty),
    actualQty: wo.actualQty != null ? Number(wo.actualQty) : null,
    targetDate: wo.targetDate,
    status: wo.status,
    issuedAt: wo.issuedAt,
    completedAt: wo.completedAt,
    canceledAt: wo.canceledAt,
    canceledReason: wo.canceledReason,
    consumptionPlan: plan,
    skuBreakdown: wo.skuBreakdown ?? null,
    rollBreakdown: Array.isArray(wo.rollBreakdown) ? wo.rollBreakdown : (wo.rollBreakdown ? [wo.rollBreakdown] : null),
    notes: wo.notes,
    syncStatus: wo.syncStatus,
    createdById: wo.createdById,
    createdAt: wo.createdAt,
    updatedAt: wo.updatedAt,
    vendor: wo.vendor ?? undefined,
    finishedGood: wo.finishedGood != null ? (typeof (wo.finishedGood as { reorderPoint?: unknown }).reorderPoint === 'number' ? wo.finishedGood : { ...(wo.finishedGood as object), reorderPoint: (wo.finishedGood as { reorderPoint?: unknown }).reorderPoint != null ? Number((wo.finishedGood as { reorderPoint: unknown }).reorderPoint) : null }) : undefined,
    issues: (wo.issues ?? []).map((iss) => ({
      ...iss,
      totalCost: Number(iss.totalCost),
    })),
    receipts: (wo.receipts ?? []).map((r) => ({
      id: r.id,
      docNumber: r.docNumber,
      woId: r.woId,
      receiptType: r.receiptType,
      qtyReceived: Number(r.qtyReceived),
      qtyRejected: r.qtyRejected != null ? Number(r.qtyRejected) : 0,
      qtyAccepted: Number(r.qtyAccepted),
      skuBreakdown: r.skuBreakdown ?? null,
      qcPassed: r.qcPassed ?? null,
      qcNotes: r.qcNotes ?? null,
      qcPhotos: r.qcPhotos ?? null,
      materialCost: r.materialCost != null ? Number(r.materialCost) : null,
      avgCostPerUnit: r.avgCostPerUnit != null ? Number(r.avgCostPerUnit) : null,
      totalCostValue: r.totalCostValue != null ? Number(r.totalCostValue) : null,
      receivedById: r.receivedById,
      receivedAt: r.receivedAt,
      syncStatus: r.syncStatus ?? null,
    })),
    returns: wo.returns ?? [],
  };
  return out;
}

const rollBreakdownItemSchema = z.object({
  rollRef: z.string(),
  qty: z.number().nonnegative(),
  notes: z.string().optional(),
});
const woSchema = z.object({
  vendorId: idStr,
  outputMode: z.enum(['GENERIC', 'SKU']),
  plannedQty: z.number().positive(),
  targetDate: z.date().optional(),
  finishedGoodId: idStr,
  notes: z.string().optional(),
  rollBreakdown: z.array(rollBreakdownItemSchema).optional(),
}).refine(
  (data) => {
    if (!data.rollBreakdown || data.rollBreakdown.length === 0) return true;
    const sum = data.rollBreakdown.reduce((s, r) => s + r.qty, 0);
    return Math.abs(sum - data.plannedQty) < 1e-6;
  },
  { message: 'Roll breakdown total must equal planned qty', path: ['rollBreakdown'] }
);

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
    const year = new Date().getFullYear();
    const prefix = `WO/${year}/`;
    const existing = await tx.workOrder.findMany({
      where: { docNumber: { startsWith: prefix } },
      select: { docNumber: true },
      orderBy: { docNumber: 'desc' },
      take: 1
    });
    const nextNum = existing.length
      ? (parseInt(existing[0].docNumber.slice(prefix.length), 10) || 0) + 1
      : 1;
    const docNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;

    const createData: Record<string, unknown> = {
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
      ),
    };
    if (data.rollBreakdown && data.rollBreakdown.length > 0) {
      createData.rollBreakdown = JSON.stringify(data.rollBreakdown);
    }
    const wo = await tx.workOrder.create({
      data: createData as any,
    });

    return { id: wo.id, docNumber };
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

    const plan = parseConsumptionPlan(wo.consumptionPlan) as Array<{ itemId: string; issuedQty?: number }>;
    for (const issued of validated.items) {
      const planItem = plan.find((p) => p.itemId === issued.itemId);
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

export async function getWorkOrders(
  filters?: {
    status?: string;
    vendorId?: string;
    fromDate?: Date;
    toDate?: Date;
  },
  opts?: { page: number; pageSize: number }
) {
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

  const include = {
    vendor: {
      select: {
        name: true,
        code: true,
      },
    },
    finishedGood: {
      select: {
        id: true,
        sku: true,
        nameId: true,
        nameEn: true,
      },
    },
    _count: {
      select: {
        issues: true,
        receipts: true,
      },
    },
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workOrder.count({ where }),
    ]);
    const items = rows.map((wo) => ({
      id: wo.id,
      docNumber: wo.docNumber,
      vendorId: wo.vendorId,
      finishedGoodId: wo.finishedGoodId,
      outputMode: wo.outputMode,
      plannedQty: Number(wo.plannedQty),
      actualQty: wo.actualQty != null ? Number(wo.actualQty) : null,
      targetDate: wo.targetDate,
      status: wo.status,
      issuedAt: wo.issuedAt,
      completedAt: wo.completedAt,
      canceledAt: wo.canceledAt,
      canceledReason: wo.canceledReason,
      notes: wo.notes,
      createdById: wo.createdById,
      createdAt: wo.createdAt,
      updatedAt: wo.updatedAt,
      vendor: wo.vendor,
      finishedGood: wo.finishedGood,
      _count: wo._count,
    }));
    return { items, totalCount };
  }

  const rows = await prisma.workOrder.findMany({
    where,
    include,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((wo) => ({
    id: wo.id,
    docNumber: wo.docNumber,
    vendorId: wo.vendorId,
    finishedGoodId: wo.finishedGoodId,
    outputMode: wo.outputMode,
    plannedQty: Number(wo.plannedQty),
    actualQty: wo.actualQty != null ? Number(wo.actualQty) : null,
    targetDate: wo.targetDate,
    status: wo.status,
    issuedAt: wo.issuedAt,
    completedAt: wo.completedAt,
    canceledAt: wo.canceledAt,
    canceledReason: wo.canceledReason,
    notes: wo.notes,
    createdById: wo.createdById,
    createdAt: wo.createdAt,
    updatedAt: wo.updatedAt,
    vendor: wo.vendor,
    finishedGood: wo.finishedGood,
    _count: wo._count,
  }));
}

export async function getWorkOrderById(id: string) {
  const raw = await prisma.workOrder.findUnique({
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
  if (!raw) return null;
  const finishedGood = raw.finishedGood as { reorderPoint?: unknown; [k: string]: unknown } | null;
  return serializeWorkOrder({
    ...raw,
    finishedGood: finishedGood
      ? { ...finishedGood, reorderPoint: finishedGood.reorderPoint != null ? Number(finishedGood.reorderPoint) : null }
      : undefined,
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

/** Get material issues for CMT register (filter by vendor and/or date). */
export async function getMaterialIssuesForCMTRegister(
  filters?: {
    vendorId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    issueType?: 'FABRIC' | 'ACCESSORIES';
  },
  opts?: { page: number; pageSize: number }
) {
  const where: any = {};
  if (filters?.vendorId) {
    where.wo = { vendorId: filters.vendorId };
  }
  if (filters?.dateFrom || filters?.dateTo) {
    where.issuedAt = {};
    if (filters.dateFrom) where.issuedAt.gte = filters.dateFrom;
    if (filters.dateTo) where.issuedAt.lte = filters.dateTo;
  }
  if (filters?.issueType) {
    where.issueType = filters.issueType as 'FABRIC' | 'ACCESSORIES';
  }

  const mapIssue = (i: { id: string; docNumber: string; issueType: string; issuedAt: Date; totalCost: unknown; wo?: { docNumber?: string; vendor?: { name?: string; code?: string } } }) => {
    const wo = i.wo;
    return {
      id: i.id,
      docNumber: i.docNumber,
      issueType: i.issueType,
      issuedAt: i.issuedAt,
      totalCost: Number(i.totalCost),
      woDocNumber: wo?.docNumber ?? '',
      vendorName: wo?.vendor?.name ?? wo?.vendor?.code ?? '',
    };
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [issues, totalCount] = await Promise.all([
      prisma.materialIssue.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          wo: {
            select: {
              docNumber: true,
              vendorId: true,
              vendor: { select: { name: true, code: true } },
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.materialIssue.count({ where }),
    ]);
    return { items: issues.map((i) => mapIssue(i as any)), totalCount };
  }

  const issues = await prisma.materialIssue.findMany({
    where,
    include: {
      wo: {
        select: {
          docNumber: true,
          vendorId: true,
          vendor: { select: { name: true, code: true } },
        },
      },
    },
    orderBy: { issuedAt: 'desc' },
    take: 500,
  });
  return issues.map((i) => mapIssue(i as any));
}

/** Get a single material issue with full details for print (Nota ke CMT). */
export async function getMaterialIssueForPrint(issueId: string) {
  const issue = await prisma.materialIssue.findUnique({
    where: { id: issueId },
    include: {
      wo: {
        select: {
          docNumber: true,
          vendor: { select: { name: true, code: true } },
        },
      },
    },
  });
  if (!issue) return null;
  let rawItems: unknown = issue.items;
  if (typeof rawItems === 'string') {
    try {
      rawItems = JSON.parse(rawItems);
    } catch {
      rawItems = null;
    }
  }
  const items: Array<{ itemId: string; qty: number; uomId: string }> = Array.isArray(rawItems)
    ? rawItems.filter((i): i is { itemId: string; qty: number; uomId: string } => i != null && typeof i === 'object' && typeof (i as { itemId?: unknown }).itemId === 'string')
    : rawItems && typeof rawItems === 'object'
      ? (Object.values(rawItems) as unknown[]).filter((i): i is { itemId: string; qty: number; uomId: string } => i != null && typeof i === 'object' && typeof (i as { itemId?: unknown }).itemId === 'string')
      : [];
  const itemIds = [...new Set(items.map((i) => i.itemId).filter(Boolean))];
  const uomIds = [...new Set(items.map((i) => i?.uomId).filter(Boolean))];
  const [itemRows, uomRows] = await Promise.all([
    itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true, sku: true } }) : [],
    uomIds.length ? prisma.uOM.findMany({ where: { id: { in: uomIds } }, select: { id: true, code: true } }) : [],
  ]);
  const itemMap = new Map(itemRows.map((i) => [i.id, i]));
  const uomMap = new Map(uomRows.map((u) => [u.id, u]));
  const lines = items.map((line) => ({
    itemName: itemMap.get(line.itemId)?.nameId ?? itemMap.get(line.itemId)?.sku ?? line.itemId,
    itemSku: itemMap.get(line.itemId)?.sku ?? '',
    qty: Number(line.qty ?? 0),
    uomCode: line.uomId ? uomMap.get(line.uomId)?.code ?? '' : '',
  }));
  return {
    docNumber: issue.docNumber,
    issueType: issue.issueType,
    issuedAt: issue.issuedAt,
    totalCost: Number(issue.totalCost),
    woDocNumber: issue.wo.docNumber,
    vendorName: issue.wo.vendor?.name ?? issue.wo.vendor?.code ?? '',
    lines,
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
