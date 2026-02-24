'use server';

import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { calculateMovingAverage } from '@/lib/inventory/costing';
import { revalidatePath } from 'next/cache';

const grnItemSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().positive(),
  unitCost: z.number().nonnegative(),
  uomId: z.string().min(1).optional(),
});

const grnSchema = z.object({
  poId: z.string().min(1).optional(),
  supplierId: z.string().min(1),
  items: z.array(grnItemSchema).min(1),
  notes: z.string().optional(),
  photoUrls: z.array(z.string()).optional(),
});

export type GRNFormData = z.infer<typeof grnSchema>;

export async function createGRN(data: z.infer<typeof grnSchema>, userId: string) {
  const validated = grnSchema.parse(data);

  return await prisma.$transaction(async (tx) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `GRN/${year}/${month}/`;
    const existing = await tx.gRN.findMany({
      where: { docNumber: { startsWith: prefix } },
      select: { docNumber: true },
      orderBy: { docNumber: 'desc' },
      take: 1,
    });
    const nextNum = existing.length
      ? (parseInt(existing[0].docNumber.slice(prefix.length), 10) || 0) + 1
      : 1;
    const docNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;

    let totalAmount = new Decimal(0);

    const processedItems = await Promise.all(
      validated.items.map(async (item) => {
        const qty = new Decimal(item.qty);
        const unitCost = new Decimal(item.unitCost);
        const lineTotal = qty.mul(unitCost);
        totalAmount = totalAmount.plus(lineTotal);

        const costCalc = await calculateMovingAverage(
          item.itemId,
          qty,
          unitCost,
          tx
        );

        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            type: 'IN',
            refType: 'GRN',
            refId: 'temp',
            refDocNumber: docNumber,
            qty: item.qty,
            unitCost: item.unitCost,
            totalCost: lineTotal.toNumber(),
            balanceQty: costCalc.newQty.toNumber(),
            balanceValue: costCalc.newTotalValue.toNumber(),
            notes: validated.notes ?? undefined,
          },
        });

        return {
          itemId: item.itemId,
          qty: item.qty,
          unitCost: item.unitCost,
          totalCost: lineTotal.toNumber(),
          prevAvgCost: costCalc.previousAvgCost.toNumber(),
          newAvgCost: costCalc.newAvgCost.toNumber(),
          prevQty: costCalc.previousQty.toNumber(),
          newQty: costCalc.newQty.toNumber(),
        };
      })
    );

    const grn = await tx.gRN.create({
      data: {
        docNumber,
        poId: validated.poId ?? null,
        supplierId: validated.supplierId,
        receivedBy: userId,
        totalAmount: totalAmount.toNumber(),
        photoUrls: validated.photoUrls ? JSON.stringify(validated.photoUrls) : null,
        items: JSON.stringify(processedItems),
        notes: validated.notes ?? null,
      },
    });

    await tx.stockMovement.updateMany({
      where: { refDocNumber: docNumber },
      data: { refId: grn.id },
    });

    if (validated.poId) {
      for (const item of validated.items) {
        await tx.pOItem.updateMany({
          where: {
            poId: validated.poId!,
            itemId: item.itemId,
          },
          data: {
            receivedQty: { increment: item.qty },
          },
        });
      }

      const poItems = await tx.pOItem.findMany({
        where: { poId: validated.poId },
      });

      const allFullyReceived = poItems.every((poItem) =>
        new Decimal(poItem.receivedQty.toString()).gte(poItem.qty.toString())
      );
      const anyOverReceived = poItems.some((poItem) =>
        new Decimal(poItem.receivedQty.toString()).gt(poItem.qty.toString())
      );
      const anyReceived = poItems.some((poItem) =>
        new Decimal(poItem.receivedQty.toString()).gt(0)
      );

      let newStatus: 'SUBMITTED' | 'PARTIAL' | 'CLOSED' | 'OVER' = 'SUBMITTED';
      if (allFullyReceived) newStatus = anyOverReceived ? 'OVER' : 'CLOSED';
      else if (anyReceived) newStatus = 'PARTIAL';

      await tx.purchaseOrder.update({
        where: { id: validated.poId },
        data: { status: newStatus },
      });

      await tx.pOStatusHistory.create({
        data: {
          poId: validated.poId,
          status: newStatus,
          changedById: userId,
          notes: `GRN issued: ${grn.docNumber}`,
        },
      });
    }

    revalidatePath('/backoffice/inventory');
    return {
      id: grn.id,
      docNumber: grn.docNumber,
      poId: grn.poId,
      supplierId: grn.supplierId,
      receivedBy: grn.receivedBy,
      totalAmount: Number(grn.totalAmount),
      photoUrls: grn.photoUrls,
      items: grn.items,
      notes: grn.notes,
      grnDate: grn.grnDate,
      createdAt: grn.createdAt,
    };
  });
}

export async function getGRNs(
  filters?: {
    supplierId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    poId?: string;
  },
  opts?: { page: number; pageSize: number }
) {
  const where: Record<string, unknown> = {};
  if (filters?.supplierId) where.supplierId = filters.supplierId;
  if (filters?.poId) where.poId = filters.poId;
  if (filters?.dateFrom || filters?.dateTo) {
    where.grnDate = {};
    if (filters.dateFrom) (where.grnDate as Record<string, Date>).gte = filters.dateFrom;
    if (filters.dateTo) (where.grnDate as Record<string, Date>).lte = filters.dateTo;
  }

  const include = {
    supplier: true,
    po: { select: { docNumber: true } },
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.gRN.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        orderBy: { grnDate: 'desc' },
      }),
      prisma.gRN.count({ where }),
    ]);
    const items = rows.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
    }));
    return { items, totalCount };
  }

  const rows = await prisma.gRN.findMany({
    where,
    include,
    orderBy: { grnDate: 'desc' },
  });
  return rows.map((r) => ({
    ...r,
    totalAmount: Number(r.totalAmount),
  }));
}

export async function getGRNById(id: string) {
  const grn = await prisma.gRN.findUnique({
    where: { id },
    include: {
      supplier: true,
      po: {
        include: { supplier: true },
      },
    },
  });
  if (!grn) return null;
  return {
    ...grn,
    totalAmount: Number(grn.totalAmount),
  };
}
