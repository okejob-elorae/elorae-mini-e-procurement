'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import {
  calculateMovingAverage
} from '@/lib/inventory/costing';

// Prisma uses CUID, not UUID
const idStr = z.string().min(1);

const returnLineSchema = z.object({
  type: z.enum(['FABRIC', 'ACCESSORIES', 'FG_REJECT']),
  itemId: idStr,
  qty: z.number().positive(),
  reason: z.string().min(3),
  condition: z.enum(['GOOD', 'DAMAGED', 'DEFECTIVE']),
  referenceIssueId: idStr.optional()
});

const returnSchema = z.object({
  woId: idStr.optional(),
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

  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('RET', tx);

    const linesWithValue = await Promise.all(
      data.lines.map(async (line) => {
        const inventory = await tx.inventoryValue.findUnique({
          where: { itemId: line.itemId }
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
        const inventory = await tx.inventoryValue.findUnique({
          where: { itemId: line.itemId }
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
  return await prisma.$transaction(async (tx) => {
    const ret = await tx.vendorReturn.findUnique({
      where: { id }
    });

    if (!ret || ret.status !== 'DRAFT') {
      throw new Error('Return tidak valid atau sudah diproses');
    }

    const lines = (ret.lines as any[]) || [];

    for (const line of lines) {
      if (line.type === 'FABRIC' || line.type === 'ACCESSORIES') {
        await calculateMovingAverage(
          line.itemId,
          new Decimal(line.qty),
          new Decimal(line.costValue).div(line.qty),
          tx
        );

        if (ret.woId) {
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
    }

    await tx.vendorReturn.update({
      where: { id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        processedBy: userId,
        stockImpacted: true
      }
    });

    revalidatePath('/backoffice/vendor-returns');
    if (ret.woId) {
      revalidatePath(`/backoffice/work-orders/${ret.woId}`);
    }
    return ret;
  });
}

export async function getVendorReturns(filters?: {
  status?: string;
  vendorId?: string;
  woId?: string;
  search?: string;
}) {
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

  const rows = await prisma.vendorReturn.findMany({
    where,
    include: {
      vendor: {
        select: { id: true, name: true, code: true }
      },
      wo: {
        select: { id: true, docNumber: true }
      }
    },
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
      wo: { select: { id: true, docNumber: true } }
    }
  });
  if (!ret) return null;
  return {
    ...ret,
    totalValue: Number(ret.totalValue)
  };
}
