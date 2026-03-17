'use server';

import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { calculateMovingAverage } from '@/lib/inventory/costing';
import { revalidatePath } from 'next/cache';
import { getActorName, notifyGRNCreated } from '@/app/actions/notifications';

const grnItemSchema = z.object({
  itemId: z.string().min(1),
  variantSku: z.string().optional(),
  qty: z.number().positive(),
  unitCost: z.number().nonnegative(),
  uomId: z.string().min(1).optional(),
  rolls: z
    .array(
      z.object({
        rollRef: z.string().min(1),
        length: z.number().positive(),
        notes: z.string().optional(),
      })
    )
    .optional(),
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

  const result = await prisma.$transaction(async (tx) => {
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
        const itemRow = await tx.item.findUnique({
          where: { id: item.itemId },
          select: { type: true, uomId: true, overReceiveThreshold: true },
        });
        if (!itemRow) {
          throw new Error(`Item not found: ${item.itemId}`);
        }
        const isFabric = itemRow.type === 'FABRIC';
        const rolls = item.rolls ?? [];
        const derivedQty = isFabric && rolls.length > 0
          ? rolls.reduce((sum, roll) => sum + roll.length, 0)
          : item.qty;
        const qty = new Decimal(derivedQty);
        const unitCost = new Decimal(item.unitCost);
        const lineTotal = qty.mul(unitCost);
        totalAmount = totalAmount.plus(lineTotal);

        const variantKey = item.variantSku ?? null;
        const costCalc = await calculateMovingAverage(
          item.itemId,
          qty,
          unitCost,
          tx,
          variantKey
        );

        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            variantSku: variantKey,
            type: 'IN',
            refType: 'GRN',
            refId: 'temp',
            refDocNumber: docNumber,
            qty: derivedQty,
            unitCost: item.unitCost,
            totalCost: lineTotal.toNumber(),
            balanceQty: costCalc.newQty.toNumber(),
            balanceValue: costCalc.newTotalValue.toNumber(),
            notes: validated.notes ?? undefined,
          },
        });

        return {
          itemId: item.itemId,
          qty: derivedQty,
          unitCost: item.unitCost,
          itemType: itemRow.type,
          uomId: item.uomId || itemRow.uomId,
          overReceiveThreshold: itemRow.overReceiveThreshold != null ? Number(itemRow.overReceiveThreshold) : null,
          rolls,
          totalCost: lineTotal.toNumber(),
          prevAvgCost: costCalc.previousAvgCost.toNumber(),
          newAvgCost: costCalc.newAvgCost.toNumber(),
          prevQty: costCalc.previousQty.toNumber(),
          newQty: costCalc.newQty.toNumber(),
        };
      })
    );

    let requiresOwnerApproval = false;
    if (validated.poId) {
      const poItems = await tx.pOItem.findMany({
        where: { poId: validated.poId },
        select: { itemId: true, qty: true, receivedQty: true },
      });
      const poMap = new Map(
        poItems.map((poItem) => [poItem.itemId, poItem])
      );
      for (const item of processedItems) {
        const poItem = poMap.get(item.itemId);
        if (!poItem) continue;
        const nextReceivedQty = Number(poItem.receivedQty) + Number(item.qty);
        const overBy = nextReceivedQty - Number(poItem.qty);
        const threshold = Number(item.overReceiveThreshold ?? 0);
        if (overBy > threshold) {
          requiresOwnerApproval = true;
          break;
        }
      }
    }

    const grn = await tx.gRN.create({
      data: {
        docNumber,
        poId: validated.poId ?? null,
        supplierId: validated.supplierId,
        receivedBy: userId,
        totalAmount: totalAmount.toNumber(),
        requiresOwnerApproval,
        photoUrls: validated.photoUrls ? JSON.stringify(validated.photoUrls) : null,
        items: JSON.stringify(processedItems),
        notes: validated.notes ?? null,
      },
    });

    let rollSeq = 0;
    const rollCreates: Array<{
      grnId: string;
      itemId: string;
      rollCode: string;
      rollRef: string;
      initialLength: number;
      remainingLength: number;
      uomId: string;
      notes: string | null;
    }> = [];
    for (const item of processedItems) {
      if (item.itemType !== 'FABRIC' || !Array.isArray(item.rolls) || item.rolls.length === 0) continue;
      for (let index = 0; index < item.rolls.length; index++) {
        rollSeq += 1;
        const roll = item.rolls[index];
        rollCreates.push({
          grnId: grn.id,
          itemId: item.itemId,
          rollCode: `${docNumber}-R${String(rollSeq).padStart(2, '0')}`,
          rollRef: roll.rollRef || `ROLL-${index + 1}`,
          initialLength: roll.length,
          remainingLength: roll.length,
          uomId: item.uomId,
          notes: roll.notes ?? null,
        });
      }
    }
    if (rollCreates.length > 0) {
      await tx.fabricRoll.createMany({ data: rollCreates });
    }

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
            receivedQty: { increment: Number(item.qty) },
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

      // Defer PO status transition to CLOSED/OVER until GRN is owner-approved when over-receive
      const shouldUpdatePOStatus = !requiresOwnerApproval;
      if (shouldUpdatePOStatus) {
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

  getActorName(userId)
    .then((triggeredByName) => notifyGRNCreated(result.id, result.docNumber, triggeredByName))
    .catch(() => {});
  return result;
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

/** Fetch fabric rolls for a GRN (for collapsible row). Returns plain objects (no Decimal). */
export async function getRollsByGrnId(grnId: string) {
  const rolls = await prisma.fabricRoll.findMany({
    where: { grnId },
    include: {
      item: { select: { sku: true, nameId: true } },
      uom: { select: { code: true } },
    },
    orderBy: { rollCode: 'asc' },
  });
  return rolls.map((r) => ({
    id: r.id,
    rollCode: r.rollCode,
    rollRef: r.rollRef,
    initialLength: Number(r.initialLength),
    remainingLength: Number(r.remainingLength),
    isClosed: r.isClosed,
    notes: r.notes,
    item: r.item,
    uom: r.uom,
  }));
}

/** Options for By Roll tab filters: GRNs and items that have at least one roll. */
export async function getFabricRollFilterOptions(): Promise<{
  grnOptions: Array<{ value: string; label: string }>;
  itemOptions: Array<{ value: string; label: string }>;
}> {
  const [grnIdsRaw, itemIds] = await Promise.all([
    prisma.fabricRoll.findMany({ select: { grnId: true }, distinct: ['grnId'] }),
    prisma.fabricRoll.findMany({ select: { itemId: true }, distinct: ['itemId'] }),
  ]);
  const grnIds = grnIdsRaw.filter((r) => r.grnId != null) as { grnId: string }[];
  const [grns, items] = await Promise.all([
    grnIds.length ? prisma.gRN.findMany({ where: { id: { in: grnIds.map((r) => r.grnId) } }, select: { id: true, docNumber: true }, orderBy: { grnDate: 'desc' } }) : [],
    itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds.map((r) => r.itemId) } }, select: { id: true, sku: true, nameId: true }, orderBy: { sku: 'asc' } }) : [],
  ]);
  return {
    grnOptions: grns.map((g) => ({ value: g.id, label: g.docNumber })),
    itemOptions: items.map((i) => ({ value: i.id, label: `${i.sku} – ${i.nameId}` })),
  };
}

/** Fetch all fabric rolls (for By Roll tab). Returns plain objects (no Decimal). */
export async function getFabricRolls(opts?: {
  page: number;
  pageSize: number;
  grnId?: string;
  itemId?: string;
  search?: string;
}) {
  const toNum = (v: unknown) => (v == null ? null : Number(v));
  const where: Record<string, unknown> = {};
  if (opts?.grnId) where.grnId = opts.grnId;
  if (opts?.itemId) where.itemId = opts.itemId;
  const search = opts?.search?.trim();
  if (search && search.length > 0) {
    where.OR = [
      { rollCode: { contains: search } },
      { rollRef: { contains: search } },
      { item: { sku: { contains: search } } },
      { item: { nameId: { contains: search } } },
      { grn: { docNumber: { contains: search } } },
    ];
  }

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.fabricRoll.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          item: { select: { sku: true, nameId: true } },
          uom: { select: { code: true } },
          grn: { select: { docNumber: true, grnDate: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.fabricRoll.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        rollCode: r.rollCode,
        rollRef: r.rollRef,
        initialLength: toNum(r.initialLength),
        remainingLength: toNum(r.remainingLength),
        isClosed: r.isClosed,
        notes: r.notes,
        item: r.item,
        uom: r.uom,
        grn: r.grn,
      })),
      totalCount,
    };
  }
  const rows = await prisma.fabricRoll.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      item: { select: { sku: true, nameId: true } },
      uom: { select: { code: true } },
      grn: { select: { docNumber: true, grnDate: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    rollCode: r.rollCode,
    rollRef: r.rollRef,
    initialLength: toNum(r.initialLength),
    remainingLength: toNum(r.remainingLength),
    isClosed: r.isClosed,
    notes: r.notes,
    item: r.item,
    uom: r.uom,
    grn: r.grn,
  }));
}

export async function approveGRNByOwner(id: string, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || user.role !== 'ADMIN') {
    throw new Error('Only owner/admin can approve over-receive GRN');
  }
  const grn = await prisma.gRN.update({
    where: { id },
    data: {
      requiresOwnerApproval: false,
      ownerApprovedAt: new Date(),
      ownerApprovedById: userId,
    },
  });

  // Recompute PO status now that GRN is approved (deferred transition to CLOSED/OVER)
  if (grn.poId) {
    const poItems = await prisma.pOItem.findMany({
      where: { poId: grn.poId },
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

    await prisma.purchaseOrder.update({
      where: { id: grn.poId },
      data: { status: newStatus },
    });
    await prisma.pOStatusHistory.create({
      data: {
        poId: grn.poId,
        status: newStatus,
        changedById: userId,
        notes: `GRN owner-approved: ${grn.docNumber}`,
      },
    });
    revalidatePath(`/backoffice/purchase-orders/${grn.poId}`);
  }

  revalidatePath('/backoffice/inventory');
  return grn;
}
