'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { generateMaterialPlan } from '@/lib/production/planning';
import { reconcileWorkOrder } from '@/lib/production/reconciliation';
import { calculateMovingAverage } from '@/lib/inventory/costing';
import { getActorName, notifyWOCreated, notifyWOStatusUpdated, notifyWOMaterialsIssued, notifyWOCompleted } from '@/app/actions/notifications';
import { getPpnRatePercent } from '@/app/actions/settings/ppn';
import { auth } from '@/lib/auth';

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
  poId?: string | null;
  vendorId: string;
  finishedGoodId: string;
  consumptionMaterialId?: string | null;
  outputMode: string;
  plannedQty: unknown;
  expectedConsumption?: unknown;
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
  po?: { id: string; docNumber: string } | null;
  vendor?: unknown;
  finishedGood?: unknown;
  issues?: Array<{ id: string; docNumber: string; issueType: string; totalCost: unknown; issuedAt: Date; [k: string]: unknown }>;
  receipts?: Array<{ id: string; docNumber: string; qtyReceived: unknown; qtyRejected?: unknown; qtyAccepted: unknown; materialCost?: unknown; avgCostPerUnit?: unknown; totalCostValue?: unknown; receivedAt: Date; [k: string]: unknown }>;
  returns?: unknown[];
  steps?: Array<{
    id: string;
    sequence: number;
    supplierId: string;
    stepName: string | null;
    servicePrice: unknown;
    qty: unknown;
    totalCost: unknown;
    issueDocNumber: string | null;
    receiptDocNumber: string | null;
    issuedAt: Date | null;
    receivedAt: Date | null;
    notes: string | null;
    supplier?: { id: string; name: string; code: string } | null;
  }>;
}) {
  const plan = parseConsumptionPlan(wo.consumptionPlan);
  const out: Record<string, unknown> = {
    id: wo.id,
    docNumber: wo.docNumber,
    poId: wo.poId ?? null,
    po: wo.po ?? null,
    vendorId: wo.vendorId,
    finishedGoodId: wo.finishedGoodId,
    consumptionMaterialId: (wo as { consumptionMaterialId?: string | null }).consumptionMaterialId ?? null,
    outputMode: wo.outputMode,
    plannedQty: Number(wo.plannedQty),
    expectedConsumption: wo.expectedConsumption != null ? Number(wo.expectedConsumption) : null,
    actualQty: wo.actualQty != null ? Number(wo.actualQty) : null,
    targetDate: wo.targetDate,
    status: wo.status,
    issuedAt: wo.issuedAt,
    completedAt: wo.completedAt,
    canceledAt: wo.canceledAt,
    canceledReason: wo.canceledReason,
    consumptionPlan: plan,
    skuBreakdown: (() => {
      const raw = wo.skuBreakdown;
      if (raw == null) return null;
      const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      return parsed && typeof parsed === 'object' ? parsed : null;
    })(),
    rollBreakdown: (() => {
      const raw = wo.rollBreakdown;
      if (raw == null) return null;
      const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      return Array.isArray(parsed) ? parsed : null;
    })(),
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
    steps: (wo.steps ?? []).map((s) => ({
      ...s,
      servicePrice: Number(s.servicePrice),
      qty: s.qty != null ? Number(s.qty) : null,
      totalCost: s.totalCost != null ? Number(s.totalCost) : null,
    })),
  };
  return out;
}

const rollBreakdownItemSchema = z.object({
  rollRef: z.string(),
  qty: z.number().nonnegative(),
  notes: z.string().optional(),
});
const skuBreakdownSchema = z.object({
  variantSku: z.string().min(1),
  attributes: z.record(z.string(), z.string()).optional(),
});
const woStepSchema = z.object({
  sequence: z.number().int().positive(),
  supplierId: idStr,
  stepName: z.string().optional(),
  servicePrice: z.number().min(0).default(0),
  servicePpnIncluded: z.boolean().default(false),
  qty: z.number().positive().optional(),
  notes: z.string().optional(),
});
const woSchema = z
  .object({
    vendorId: idStr,
    outputMode: z.enum(['GENERIC', 'SKU']),
    plannedQty: z.number().positive(),
    expectedConsumption: z.number().positive().optional(),
    consumptionMaterialId: idStr.optional(),
    targetDate: z.date().optional(),
    finishedGoodId: idStr,
    poId: idStr.optional(),
    notes: z.string().optional(),
    rollBreakdown: z.array(rollBreakdownItemSchema).optional(),
    skuBreakdown: skuBreakdownSchema.optional(),
    steps: z.array(woStepSchema).optional(),
    hppMarginPercent: z.number().min(0).max(100).optional(),
    hppAdditionalCost: z.number().min(0).optional(),
  })
  .refine(
    (data) => {
      if (data.outputMode !== 'SKU') return true;
      return data.skuBreakdown?.variantSku != null && data.skuBreakdown.variantSku.length > 0;
    },
    { message: 'Variant (SKU) is required when Output Mode is SKU', path: ['skuBreakdown'] }
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

  const result = await prisma.$transaction(async (tx) => {
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
      consumptionMaterialId: data.consumptionMaterialId ?? null,
      outputMode: data.outputMode,
      plannedQty: data.plannedQty,
      expectedConsumption: data.expectedConsumption ?? undefined,
      targetDate: data.targetDate,
      poId: data.poId ?? null,
      notes: data.notes,
      hppMarginPercent: data.hppMarginPercent ?? null,
      hppAdditionalCost: data.hppAdditionalCost ?? null,
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
    if (data.outputMode === 'SKU' && data.skuBreakdown) {
      createData.skuBreakdown = JSON.stringify(data.skuBreakdown);
    }
    const wo = await tx.workOrder.create({
      data: createData as any,
    });

    if (data.steps?.length) {
      await tx.workOrderStep.createMany({
        data: data.steps.map((step) => ({
          woId: wo.id,
          sequence: step.sequence,
          supplierId: step.supplierId,
          stepName: step.stepName ?? null,
          servicePrice: step.servicePrice,
          servicePpnIncluded: step.servicePpnIncluded ?? false,
          qty: step.qty ?? null,
          totalCost: step.qty != null ? step.qty * step.servicePrice : null,
          notes: step.notes ?? null,
        })),
      });
    }

    return { id: wo.id, docNumber };
  });

  getActorName(userId)
    .then((triggeredByName) => notifyWOCreated(result.id, result.docNumber, triggeredByName))
    .catch(() => {});
  return result;
}

/** Update a work order. Only allowed when status is DRAFT. */
export async function updateWorkOrder(woId: string, data: WOFormData, userId: string) {
  woSchema.parse(data);

  const existing = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { id: true, status: true, docNumber: true },
  });
  if (!existing) throw new Error('Work order not found');
  if (existing.status !== 'DRAFT') {
    throw new Error('Only draft work orders can be updated');
  }

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

  await prisma.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {
      vendorId: data.vendorId,
      finishedGoodId: data.finishedGoodId,
      consumptionMaterialId: data.consumptionMaterialId ?? null,
      outputMode: data.outputMode,
      plannedQty: data.plannedQty,
      expectedConsumption: data.expectedConsumption ?? undefined,
      targetDate: data.targetDate ?? null,
      poId: data.poId ?? null,
      notes: data.notes ?? null,
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
      updateData.rollBreakdown = JSON.stringify(data.rollBreakdown);
    } else {
      updateData.rollBreakdown = null;
    }
    if (data.outputMode === 'SKU' && data.skuBreakdown) {
      updateData.skuBreakdown = JSON.stringify(data.skuBreakdown);
    } else {
      updateData.skuBreakdown = null;
    }

    await tx.workOrder.update({
      where: { id: woId },
      data: updateData as any,
    });

    await tx.workOrderStep.deleteMany({ where: { woId } });
    if (data.steps?.length) {
      await tx.workOrderStep.createMany({
        data: data.steps.map((step) => ({
          woId,
          sequence: step.sequence,
          supplierId: step.supplierId,
          stepName: step.stepName ?? null,
          servicePrice: step.servicePrice,
          servicePpnIncluded: step.servicePpnIncluded ?? false,
          qty: step.qty ?? null,
          totalCost: step.qty != null ? step.qty * step.servicePrice : null,
          notes: step.notes ?? null,
        })),
      });
    }
  });

  revalidatePath('/backoffice/work-orders');
  revalidatePath(`/backoffice/work-orders/${woId}`);
  return { id: woId, docNumber: existing.docNumber };
}

export async function updateWOHppAdjustments(
  woId: string,
  data: { hppMarginPercent?: number; hppAdditionalCost?: number }
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  if (session.user.role !== 'ADMIN') {
    throw new Error('Only owner/admin can update HPP adjustments');
  }
  const updated = await prisma.workOrder.update({
    where: { id: woId },
    data: {
      hppMarginPercent: data.hppMarginPercent ?? null,
      hppAdditionalCost: data.hppAdditionalCost ?? null,
    },
  });
  revalidatePath(`/backoffice/work-orders/${woId}`);
  return serializeWorkOrder(updated as any);
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

  getActorName(userId)
    .then((triggeredByName) =>
      notifyWOStatusUpdated(id, wo.docNumber, 'DRAFT', 'ISSUED', triggeredByName)
    )
    .catch(() => {});
  
  revalidatePath('/backoffice/work-orders');
}

const issueSchema = z.object({
  woId: idStr,
  items: z
    .array(
      z.object({
        itemId: idStr,
        variantSku: z.string().optional(),
        qty: z.number().positive(),
        uomId: idStr,
        unitPrice: z.number().positive().optional()
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

  const issueResult = await prisma.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({
      where: { id: data.woId },
      select: { status: true, consumptionPlan: true, docNumber: true, poId: true, consumptionMaterialId: true, rollBreakdown: true }
    });

    if (!wo) throw new Error('Work Order not found');
    if (!['DRAFT', 'ISSUED', 'IN_PRODUCTION'].includes(wo.status)) {
      throw new Error('Work Order tidak valid atau sudah selesai');
    }

    const docNumber = await generateDocNumber('ISSUE', tx);
    let totalCost = new Decimal(0);
    const movementData: Array<{
      itemId: string;
      variantSku: string | null;
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
      ppnIncluded?: boolean;
      totalCost: number;
      sellingPrice?: number;
      totalSellingPrice?: number;
    }> = [];

    for (const item of validated.items) {
      // Match costing convention: non-variant items use variantSku '' in DB, not null
      const variantKey = item.variantSku != null && item.variantSku !== '' ? item.variantSku : '';
      const inventory = await tx.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId: item.itemId, variantSku: variantKey } },
      });

      const itemRow = await tx.item.findUnique({
        where: { id: item.itemId },
        select: { nameId: true, defaultPpnIncluded: true }
      });

      if (
        !inventory ||
        new Decimal(inventory.qtyOnHand.toString()).lt(item.qty)
      ) {
        throw new Error(
          `Stok tidak mencukupi untuk ${itemRow?.nameId || item.itemId}`
        );
      }

      const avgCostNum = Number(inventory.avgCost);
      let unitCost = item.unitPrice ?? avgCostNum;
      let ppnIncluded = itemRow?.defaultPpnIncluded ?? true;
      if (wo.poId) {
        const poItem = await tx.pOItem.findFirst({
          where: { poId: wo.poId, itemId: item.itemId },
          select: { ppnIncluded: true, price: true },
        });
        if (poItem) {
          ppnIncluded = poItem.ppnIncluded;
          const baseCost = item.unitPrice ?? Number(poItem.price);
          const ppnRatePercent = await getPpnRatePercent();
          const ppnMultiplier = 1 + ppnRatePercent / 100;
          unitCost = poItem.ppnIncluded ? baseCost : baseCost * ppnMultiplier;
        }
      }
      const cost = new Decimal(unitCost).mul(item.qty);
      totalCost = totalCost.plus(cost);

      const newQty = new Decimal(inventory.qtyOnHand.toString()).minus(item.qty);
      const newValue = newQty.mul(new Decimal(inventory.avgCost.toString()));

      await tx.inventoryValue.update({
        where: { id: inventory.id },
        data: {
          qtyOnHand: newQty.toNumber(),
          totalValue: newValue.toNumber()
        }
      });

      movementData.push({
        itemId: item.itemId,
        variantSku: variantKey,
        qty: -item.qty,
        unitCost,
        totalCost: cost.toNumber(),
        balanceQty: newQty.toNumber(),
        balanceValue: newValue.toNumber()
      });

      // HPP: store raw cost per line (avgCostAtIssue × qty) and PPN status; optional CMT selling price
      const lineTotalCostRaw = avgCostNum * item.qty;
      const sellingPrice = item.unitPrice != null && item.unitPrice > 0 ? item.unitPrice : undefined;
      const totalSellingPrice = sellingPrice != null ? sellingPrice * item.qty : undefined;
      issueItemsForJson.push({
        itemId: item.itemId,
        qty: item.qty,
        uomId: item.uomId,
        avgCostAtIssue: avgCostNum,
        ppnIncluded,
        totalCost: lineTotalCostRaw,
        ...(sellingPrice != null && { sellingPrice, totalSellingPrice }),
      });
    }

    // Deduct from fabric rolls when the issued item is the WO consumption material and rollBreakdown exists
    const consumptionMaterialId = (wo as { consumptionMaterialId?: string | null }).consumptionMaterialId ?? null;
    const rawRollBreakdown = (wo as { rollBreakdown?: unknown }).rollBreakdown;
    const rollBreakdown = (() => {
      if (rawRollBreakdown == null) return null;
      const arr = typeof rawRollBreakdown === 'string' ? (() => { try { return JSON.parse(rawRollBreakdown); } catch { return null; } })() : rawRollBreakdown;
      return Array.isArray(arr) ? arr as Array<{ rollRef: string; qty: number }> : null;
    })();

    for (const item of validated.items) {
      if (consumptionMaterialId != null && item.itemId === consumptionMaterialId && rollBreakdown != null && rollBreakdown.length > 0) {
        let remainingToAllocate = item.qty;
        for (const entry of rollBreakdown) {
          if (remainingToAllocate <= 0) break;
          const roll = await tx.fabricRoll.findFirst({
            where: {
              itemId: item.itemId,
              remainingLength: { gt: 0 },
              isClosed: false,
              OR: [
                { rollCode: entry.rollRef },
                { rollRef: entry.rollRef }
              ]
            },
            select: { id: true, remainingLength: true }
          });
          if (!roll) continue;
          const currentRemaining = new Decimal(roll.remainingLength.toString());
          const deduct = Decimal.min(new Decimal(remainingToAllocate), currentRemaining).toNumber();
          if (deduct <= 0) continue;
          const newRemaining = currentRemaining.minus(deduct).toNumber();
          await tx.fabricRoll.update({
            where: { id: roll.id },
            data: { remainingLength: newRemaining }
          });
          remainingToAllocate -= deduct;
        }
      }
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
          variantSku: mov.variantSku,
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

  const wo = await prisma.workOrder.findUnique({
    where: { id: data.woId },
    select: { docNumber: true },
  });
  if (wo) {
    getActorName(userId)
      .then((triggeredByName) =>
        notifyWOMaterialsIssued(data.woId, wo.docNumber, triggeredByName)
      )
      .catch(() => {});
  }
  return issueResult;
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

  const receiveResult = await prisma.$transaction(async (tx) => {
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
      const fgVariantSku =
        wo.outputMode === 'SKU'
          ? ((typeof wo.skuBreakdown === 'string'
              ? JSON.parse(wo.skuBreakdown)
              : wo.skuBreakdown) as { variantSku?: string } | null)?.variantSku ?? null
          : null;
      const costResult = await calculateMovingAverage(
        wo.finishedGoodId,
        new Decimal(qtyAccepted),
        avgCostPerUnit,
        tx,
        fgVariantSku
      );
      await tx.stockMovement.create({
        data: {
          itemId: wo.finishedGoodId,
          type: 'IN',
          refType: 'FG_RECEIPT',
          refId: receipt.id,
          refDocNumber: docNumber,
          qty: qtyAccepted,
          variantSku: fgVariantSku,
          unitCost: avgCostPerUnit.toNumber(),
          totalCost: totalMaterialCost.toNumber(),
          balanceQty: costResult.newQty.toNumber(),
          balanceValue: costResult.newTotalValue.toNumber(),
          notes: `FG receipt ${docNumber}`
        }
      });
    }

    if (data.qtyRejected > 0 && wo.finishedGoodId) {
      await tx.rejectedGoodsLedger.create({
        data: {
          itemId: wo.finishedGoodId,
          qty: data.qtyRejected,
          refType: 'FG_RECEIPT',
          refId: receipt.id,
          refDocNumber: docNumber,
          woId: data.woId,
          receivedAt: receipt.receivedAt,
          notes: data.qcNotes ?? null,
        },
      });
    }

    const woCompleted = newActualQty >= Number(wo.plannedQty);
    return { receipt, woCompleted };
  });

  if (receiveResult.woCompleted) {
    notifyWOCompleted(data.woId, userId).catch(() => {});
  }
  return receiveResult.receipt;
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

  getActorName(userId)
    .then((triggeredByName) =>
      notifyWOStatusUpdated(id, wo.docNumber, wo.status, 'CANCELLED', triggeredByName)
    )
    .catch(() => {});
  
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
      po: { select: { id: true, docNumber: true } },
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
      returns: true,
      steps: {
        include: {
          supplier: { select: { id: true, name: true, code: true } },
        },
        orderBy: { sequence: 'asc' },
      },
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

/** Roll allocation status for WO detail: per-roll initial/remaining (so user sees what’s already issued). */
export async function getWorkOrderRollAllocationStatus(woId: string): Promise<Array<{
  rollRef: string;
  allocatedQty: number;
  initialLength: number | null;
  remainingLength: number | null;
  used: number | null;
}>> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { consumptionMaterialId: true, rollBreakdown: true },
  });
  if (!wo?.consumptionMaterialId || !wo.rollBreakdown) return [];
  const raw = wo.rollBreakdown;
  const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  const breakdown = Array.isArray(arr) ? (arr as Array<{ rollRef?: string; qty?: number }>) : [];
  if (breakdown.length === 0) return [];

  const itemId = wo.consumptionMaterialId;
  const out: Array<{ rollRef: string; allocatedQty: number; initialLength: number | null; remainingLength: number | null; used: number | null }> = [];
  for (const entry of breakdown) {
    const rollRef = entry.rollRef ?? '';
    const allocatedQty = Number(entry.qty ?? 0);
    const roll = await prisma.fabricRoll.findFirst({
      where: {
        itemId,
        OR: [{ rollCode: rollRef }, { rollRef }],
      },
      select: { initialLength: true, remainingLength: true },
    });
    if (roll) {
      const initial = Number(roll.initialLength);
      const remaining = Number(roll.remainingLength);
      out.push({ rollRef, allocatedQty, initialLength: initial, remainingLength: remaining, used: initial - remaining });
    } else {
      out.push({ rollRef, allocatedQty, initialLength: null, remainingLength: null, used: null });
    }
  }
  return out;
}

/**
 * Compute planned qty (pieces) from consumption of one material.
 * plannedQty = floor(consumptionAmount / consumptionPerPiece), with remainder.
 */
export async function computePlannedQtyFromConsumption(
  finishedGoodId: string,
  materialId: string,
  consumptionAmount: number
): Promise<{
  plannedQty: number;
  remainder: number;
  actualConsumption: number;
  consumptionPerPiece: number;
  uomCode: string;
}> {
  const rule = await prisma.consumptionRule.findUnique({
    where: {
      finishedGoodId_materialId: { finishedGoodId, materialId },
      isActive: true,
    },
    include: { material: { include: { uom: true } } },
  });
  if (!rule) {
    throw new Error('Consumption rule not found for this finished good and material');
  }
  const qtyRequired = new Decimal(rule.qtyRequired.toString());
  const wastePercent = new Decimal(rule.wastePercent.toString());
  const consumptionPerPiece = qtyRequired.mul(new Decimal(1).plus(wastePercent.div(100)));
  const amount = new Decimal(consumptionAmount);
  const plannedQtyDecimal = amount.div(consumptionPerPiece).floor();
  const plannedQty = plannedQtyDecimal.toNumber();
  const actualConsumption = plannedQtyDecimal.mul(consumptionPerPiece).toNumber();
  const remainder = amount.minus(actualConsumption).toNumber();
  return {
    plannedQty,
    remainder,
    actualConsumption,
    consumptionPerPiece: consumptionPerPiece.toNumber(),
    uomCode: rule.material.uom.code,
  };
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

export async function suggestFabricRollAllocation(itemId: string, requiredQty: number) {
  const rolls = await prisma.fabricRoll.findMany({
    where: {
      itemId,
      isClosed: false,
      remainingLength: { gt: 0 },
    },
    orderBy: { remainingLength: 'asc' },
    select: {
      id: true,
      rollCode: true,
      rollRef: true,
      remainingLength: true,
    },
  });

  let remaining = new Decimal(requiredQty);
  const selected: Array<{ rollId: string; rollCode: string; rollRef: string; qty: number }> = [];
  for (const roll of rolls) {
    if (remaining.lte(0)) break;
    const available = new Decimal(roll.remainingLength.toString());
    const take = Decimal.min(available, remaining);
    if (take.lte(0)) continue;
    selected.push({
      rollId: roll.id,
      rollCode: roll.rollCode,
      rollRef: roll.rollRef,
      qty: take.toNumber(),
    });
    remaining = remaining.minus(take);
  }

  return {
    selected,
    totalAllocated: selected.reduce((sum, row) => sum + row.qty, 0),
    unallocated: Math.max(0, remaining.toNumber()),
  };
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
  type ItemLine = { itemId: string; qty: number; uomId: string; unitPrice?: number; totalCost?: number };
  const items: ItemLine[] = Array.isArray(rawItems)
    ? rawItems.filter((i): i is ItemLine => i != null && typeof i === 'object' && typeof (i as { itemId?: unknown }).itemId === 'string')
    : rawItems && typeof rawItems === 'object'
      ? (Object.values(rawItems) as unknown[]).filter((i): i is ItemLine => i != null && typeof i === 'object' && typeof (i as { itemId?: unknown }).itemId === 'string')
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
    unitPrice: line.unitPrice != null ? Number(line.unitPrice) : undefined,
    lineTotal: line.totalCost != null ? Number(line.totalCost) : undefined,
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
