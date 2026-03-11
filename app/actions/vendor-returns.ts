'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { reverseInventoryValue } from '@/lib/inventory/costing';
import { getActorName, notifyVendorReturnCreated, notifyVendorReturnStatusUpdated } from '@/app/actions/notifications';

// Prisma uses CUID, not UUID
const idStr = z.string().min(1);

const returnLineSchema = z.object({
  type: z.enum(['FABRIC', 'ACCESSORIES', 'FG_REJECT']),
  itemId: idStr,
  variantSku: z.string().optional(),
  qty: z.number().positive(),
  reason: z.string().min(3),
  condition: z.enum(['GOOD', 'DAMAGED', 'DEFECTIVE']),
  referenceIssueId: idStr.optional()
});

const returnSchema = z.object({
  woId: idStr.optional(),
  grnId: idStr.optional(),
  vendorId: idStr,
  lines: z.array(returnLineSchema).min(1),
  evidenceUrls: z.array(z.string().url()).optional()
});

export type VendorReturnLineInput = z.infer<typeof returnLineSchema>;
export type CreateVendorReturnInput = z.infer<typeof returnSchema>;

export async function createVendorReturn(
  data: CreateVendorReturnInput,
  userId: string
) {
  returnSchema.parse(data);

  const ret = await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('RET', tx);

    const linesWithValue = await Promise.all(
      data.lines.map(async (line) => {
        const variantKey = line.variantSku ?? null;
        const inventory = await tx.inventoryValue.findUnique({
          where: { itemId_variantSku: { itemId: line.itemId, variantSku: variantKey } }
        });
        const avgCost = inventory
          ? new Decimal(inventory.avgCost.toString())
          : new Decimal(0);
        const value = avgCost.mul(line.qty);
        return {
          ...line,
          itemName: (await tx.item.findUnique({
            where: { id: line.itemId },
            select: { nameId: true }
          }))?.nameId,
          costValue: value.toNumber()
        };
      })
    );

    const totalValue = linesWithValue.reduce(
      (sum, line) => sum.plus(line.costValue),
      new Decimal(0)
    );

    const ret = await tx.vendorReturn.create({
      data: {
        docNumber,
        woId: data.woId ?? null,
        grnId: data.grnId ?? null,
        vendorId: data.vendorId,
        lines: JSON.stringify(linesWithValue),
        totalItems: data.lines.length,
        totalValue: totalValue.toNumber(),
        evidenceUrls: data.evidenceUrls
          ? JSON.stringify(data.evidenceUrls)
          : null,
        createdById: userId
      }
    });

    return ret;
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyVendorReturnCreated(ret.id, ret.docNumber, triggeredByName)
    )
    .catch(() => {});
  return ret;
}

export async function updateVendorReturn(
  id: string,
  data: CreateVendorReturnInput,
  userId: string
) {
  returnSchema.parse(data);

  const existing = await prisma.vendorReturn.findUnique({
    where: { id }
  });
  if (!existing || existing.status !== 'DRAFT') {
    throw new Error('Can only edit draft returns');
  }

  return await prisma.$transaction(async (tx) => {
    const linesWithValue = await Promise.all(
      data.lines.map(async (line) => {
        const variantKey = line.variantSku ?? null;
        const inventory = await tx.inventoryValue.findUnique({
          where: { itemId_variantSku: { itemId: line.itemId, variantSku: variantKey } }
        });
        const avgCost = inventory
          ? new Decimal(inventory.avgCost.toString())
          : new Decimal(0);
        const value = avgCost.mul(line.qty);
        return {
          ...line,
          itemName: (await tx.item.findUnique({
            where: { id: line.itemId },
            select: { nameId: true }
          }))?.nameId,
          costValue: value.toNumber()
        };
      })
    );

    const totalValue = linesWithValue.reduce(
      (sum, line) => sum.plus(line.costValue),
      new Decimal(0)
    );

    const updated = await tx.vendorReturn.update({
      where: { id },
      data: {
        woId: data.woId ?? null,
        grnId: data.grnId ?? null,
        vendorId: data.vendorId,
        lines: JSON.stringify(linesWithValue),
        totalItems: data.lines.length,
        totalValue: totalValue.toNumber(),
        evidenceUrls: data.evidenceUrls
          ? JSON.stringify(data.evidenceUrls)
          : null
      }
    });

    revalidatePath('/backoffice/vendor-returns');
    revalidatePath(`/backoffice/vendor-returns/${id}`);
    return updated;
  });
}

export async function deleteVendorReturn(id: string, userId: string) {
  const existing = await prisma.vendorReturn.findUnique({
    where: { id }
  });
  if (!existing || existing.status !== 'DRAFT') {
    throw new Error('Can only delete draft returns');
  }
  await prisma.vendorReturn.delete({ where: { id } });
  revalidatePath('/backoffice/vendor-returns');
}

export async function processReturn(id: string, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const ret = await tx.vendorReturn.findUnique({
      where: { id }
    });

    if (!ret || ret.status !== 'DRAFT') {
      throw new Error('Return tidak valid atau sudah diproses');
    }

    const lines = (ret.lines as Array<{ type: string; itemId: string; variantSku?: string | null; qty: number | string; costValue: number | string }>) || [];

    for (const line of lines) {
      if (line.type === 'FABRIC' || line.type === 'ACCESSORIES') {
        const parsedQty = Number(line.qty);
        const parsedCostValue = Number(line.costValue);
        if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
          throw new Error(`Invalid return qty for item ${line.itemId}`);
        }
        if (!Number.isFinite(parsedCostValue) || parsedCostValue < 0) {
          throw new Error(`Invalid return cost for item ${line.itemId}`);
        }
        const variantKey = line.variantSku ?? null;
        const qty = new Decimal(parsedQty);
        const unitCost = parsedQty === 0 ? new Decimal(0) : new Decimal(parsedCostValue).div(parsedQty);
        const costResult = await reverseInventoryValue(
          line.itemId,
          qty,
          unitCost,
          tx,
          variantKey
        );
        const outgoingValue = qty.mul(unitCost);
        await tx.stockMovement.create({
          data: {
            itemId: line.itemId,
            variantSku: variantKey,
            type: 'OUT',
            refType: 'VENDOR_RETURN',
            refId: ret.id,
            refDocNumber: ret.docNumber,
            qty: -parsedQty,
            unitCost: unitCost.toNumber(),
            totalCost: outgoingValue.toNumber(),
            balanceQty: costResult.newQty.toNumber(),
            balanceValue: costResult.newTotalValue.toNumber(),
            notes: ret.woId ? `Vendor return ${ret.docNumber} (WO)` : `Vendor return ${ret.docNumber}`,
          },
        });
      }
    }

    let poIdToRevalidate: string | null = null;
    if (ret.woId) {
      const wo = await tx.workOrder.findUnique({
        where: { id: ret.woId },
        select: { poId: true, docNumber: true },
      });
      if (wo?.poId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: wo.poId },
          select: { status: true },
        });
        if (po) {
          await tx.pOStatusHistory.create({
            data: {
              poId: wo.poId,
              status: po.status,
              changedById: userId,
              notes: `Vendor return ${ret.docNumber} processed (WO ${wo.docNumber})`,
            },
          });
          poIdToRevalidate = wo.poId;
        }
      }
    }

    await tx.vendorReturn.update({
      where: { id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        processedBy: userId,
        stockImpacted: true,
      },
    });

    return { ret, poIdToRevalidate };
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyVendorReturnStatusUpdated(
        id,
        result.ret.docNumber,
        'DRAFT',
        'PROCESSED',
        triggeredByName
      )
    )
    .catch(() => {});

  revalidatePath('/backoffice/vendor-returns');
  revalidatePath(`/backoffice/vendor-returns/${result.ret.id}`);
  if (result.poIdToRevalidate) {
    revalidatePath(`/backoffice/purchase-orders/${result.poIdToRevalidate}`);
  }
  return result.ret;
}

const completeReturnSchema = z.object({
  trackingNumber: z.string().min(1, 'Tracking number is required'),
  receiptFileUrl: z.string().url('Receipt file URL is required')
});

export type CompleteReturnInput = z.infer<typeof completeReturnSchema>;

export async function completeReturn(
  id: string,
  userId: string,
  data: CompleteReturnInput
) {
  completeReturnSchema.parse(data);

  const completeResult = await prisma.$transaction(async (tx) => {
    const ret = await tx.vendorReturn.findUnique({
      where: { id }
    });

    if (!ret || ret.status !== 'PROCESSED') {
      throw new Error('Return must be in PROCESSED status to complete');
    }

    const lines = (ret.lines as any[]) || [];

    for (const line of lines) {
      if ((line.type === 'FABRIC' || line.type === 'ACCESSORIES') && ret.woId) {
        const wo = await tx.workOrder.findUnique({
          where: { id: ret.woId },
          select: { consumptionPlan: true }
        });

        if (wo) {
          const plan = (wo.consumptionPlan as any[]) || [];
          const planItem = plan.find((p: any) => p.itemId === line.itemId);
          if (planItem) {
            planItem.returnedQty = (planItem.returnedQty || 0) + line.qty;
          }
          await tx.workOrder.update({
            where: { id: ret.woId },
            data: { consumptionPlan: JSON.stringify(plan) }
          });
        }
      }
    }

    await tx.vendorReturn.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedById: userId,
        trackingNumber: data.trackingNumber,
        receiptFileUrl: data.receiptFileUrl,
        stockImpacted: ret.stockImpacted
      }
    });

    revalidatePath('/backoffice/vendor-returns');
    revalidatePath(`/backoffice/vendor-returns/${id}`);
    if (ret.woId) {
      revalidatePath(`/backoffice/work-orders/${ret.woId}`);
    }
    return ret;
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyVendorReturnStatusUpdated(
        id,
        completeResult.docNumber,
        'PROCESSED',
        'COMPLETED',
        triggeredByName
      )
    )
    .catch(() => {});
  return completeResult;
}

export async function getVendorReturns(
  filters?: {
    status?: string;
    vendorId?: string;
    woId?: string;
    search?: string;
  },
  opts?: { page: number; pageSize: number }
) {
  const andParts: Array<Record<string, unknown>> = [];
  if (filters?.status) andParts.push({ status: filters.status });
  if (filters?.vendorId) andParts.push({ vendorId: filters.vendorId });
  if (filters?.woId) andParts.push({ woId: filters.woId });
  const searchTrim = filters?.search?.trim();
  if (searchTrim) {
    andParts.push({
      OR: [
        { docNumber: { contains: searchTrim } },
        { vendor: { name: { contains: searchTrim } } },
        { vendor: { code: { contains: searchTrim } } }
      ]
    });
  }
  const where = andParts.length > 0 ? { AND: andParts } : {};

  const include = {
    vendor: {
      select: { id: true, name: true, code: true }
    },
    wo: {
      select: { id: true, docNumber: true }
    },
    grn: {
      select: { id: true, docNumber: true }
    }
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.vendorReturn.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.vendorReturn.count({ where }),
    ]);
    const items = rows.map((r) => ({
      ...r,
      totalValue: Number(r.totalValue)
    }));
    return { items, totalCount };
  }

  const rows = await prisma.vendorReturn.findMany({
    where,
    include,
    orderBy: { createdAt: 'desc' }
  });

  return rows.map((r) => ({
    ...r,
    totalValue: Number(r.totalValue)
  }));
}

export async function getVendorReturnById(id: string) {
  const ret = await prisma.vendorReturn.findUnique({
    where: { id },
    include: {
      vendor: true,
      wo: { select: { id: true, docNumber: true } },
      grn: { select: { id: true, docNumber: true } }
    }
  });
  if (!ret) return null;
  return {
    ...ret,
    totalValue: Number(ret.totalValue)
  };
}
