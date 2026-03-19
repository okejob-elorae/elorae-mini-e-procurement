'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { POStatus } from '@prisma/client';
import { poSchema } from '@/lib/validations';
import { getETAStatus } from '@/lib/eta-alerts';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { getActorName, notifyPOCreated, notifyPOStatusUpdated, notifyPOPaymentToggled } from '@/app/actions/notifications';

export type POFormData = z.infer<typeof poSchema>;

export async function createPO(data: POFormData, userId: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_CREATE);
  
  const validated = poSchema.parse(data);
  
  const po = await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('PO', tx);
    
    // Calculate totals
    const totalAmount = validated.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));
    
    const created = await tx.purchaseOrder.create({
      data: {
        docNumber,
        supplierId: validated.supplierId,
        etaDate: validated.etaDate,
        paymentDueDate: validated.paymentDueDate ?? undefined,
        notes: validated.notes,
        terms: validated.terms,
        totalAmount: totalAmount.toNumber(),
        grandTotal: totalAmount.toNumber(),
        createdById: userId,
        items: {
          create: validated.items
        }
      },
      include: { items: true }
    });
    
    // Create initial status history
    await tx.pOStatusHistory.create({
      data: {
        poId: created.id,
        status: 'DRAFT',
        changedById: userId,
        notes: 'PO Created'
      }
    });
    
    return created;
  });

  getActorName(userId)
    .then((triggeredByName) => notifyPOCreated(po.id, po.docNumber, triggeredByName))
    .catch(() => {});

  return po;
}

export async function updatePO(
  id: string,
  data: POFormData,
  userId: string,
  pin?: string
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);
  
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true }
  });

  if (existing?.status === 'CLOSED' || existing?.status === 'CANCELLED') {
    throw new Error('Cannot edit closed or cancelled PO');
  }

  if (existing?.status !== 'DRAFT') {
    if (!pin) {
      throw new Error('PIN required to edit a posted PO');
    }
    const pinResult = await verifyPinForAction(userId, pin, 'EDIT_POSTED_PO');
    if (!pinResult.success) {
      throw new Error(pinResult.messageKey ?? pinResult.message);
    }
  }

  const receivedPreservingStatuses = ['SUBMITTED', 'PARTIAL', 'OVER'] as const;
  const preserveReceived =
    existing?.status &&
    receivedPreservingStatuses.includes(
      existing.status as (typeof receivedPreservingStatuses)[number]
    );

  const po = await prisma.$transaction(async (tx) => {
    const oldItems = await tx.pOItem.findMany({
      where: { poId: id },
      select: { itemId: true, receivedQty: true },
    });
    const receivedByItem = new Map<string, number>();
    for (const o of oldItems) {
      const r = Number(o.receivedQty);
      receivedByItem.set(o.itemId, (receivedByItem.get(o.itemId) ?? 0) + r);
    }

    if (preserveReceived) {
      for (const [itemId, recv] of receivedByItem) {
        if (recv <= 0) continue;
        const lines = data.items.filter((i) => i.itemId === itemId);
        const totalNewQty = lines.reduce((s, i) => s + i.qty, 0);
        if (lines.length === 0 || totalNewQty < recv) {
          throw new Error(
            `Cannot edit: item has ${recv} received — keep the line and qty ≥ ${recv}, or remove only zero-received lines.`
          );
        }
      }
    }

    const totalAmount = data.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));

    await tx.pOItem.deleteMany({ where: { poId: id } });

    const remainingRecv = new Map(receivedByItem);
    const itemCreates = data.items.map((item) => {
      const avail = remainingRecv.get(item.itemId) ?? 0;
      const receivedQty = preserveReceived ? Math.min(avail, item.qty) : 0;
      remainingRecv.set(item.itemId, Math.max(0, avail - receivedQty));
      return {
        itemId: item.itemId,
        qty: item.qty,
        price: item.price,
        ppnIncluded: item.ppnIncluded,
        uomId: item.uomId,
        notes: item.notes ?? null,
        receivedQty,
      };
    });

    const po = await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: data.supplierId,
        etaDate: data.etaDate,
        paymentDueDate: data.paymentDueDate ?? undefined,
        notes: data.notes,
        terms: data.terms,
        totalAmount: totalAmount.toNumber(),
        grandTotal: totalAmount.toNumber(),
        items: { create: itemCreates },
      },
      include: {
        items: { include: { item: true } },
        supplier: true,
      },
    });

    if (existing?.status && existing.status !== 'DRAFT') {
      await tx.pOStatusHistory.create({
        data: {
          poId: id,
          status: existing.status,
          changedById: userId,
          notes: 'PO Edited (PIN verified)',
        },
      });
    }

    return po;
  });

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
  return po;
}

export async function changePOStatus(
  id: string,
  newStatus: 'SUBMITTED' | 'CANCELLED' | 'CLOSED',
  userId: string,
  notes?: string,
  pin?: string
) {
  if (newStatus === 'CANCELLED') {
    if (!pin) {
      throw new Error('PIN required to void/cancel a PO');
    }
    const pinResult = await verifyPinForAction(userId, pin, 'VOID_DOCUMENT');
    if (!pinResult.success) {
      throw new Error(pinResult.messageKey ?? pinResult.message);
    }

    // Block cancellation if any receipts exist (or GRNs are linked).
    const poWithReceipts = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { grns: { select: { id: true } }, items: { select: { receivedQty: true } } },
    });
    if (!poWithReceipts) throw new Error('PO not found');
    const anyReceived = (poWithReceipts.items ?? []).some((it) => Number(it.receivedQty) > 0);
    if ((poWithReceipts.grns ?? []).length > 0 || anyReceived) {
      throw new Error('Cannot cancel PO with GRNs');
    }
  }

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true, docNumber: true },
  });
  if (!existing) throw new Error('PO not found');

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: newStatus }
  });
  
  await prisma.pOStatusHistory.create({
    data: {
      poId: id,
      status: newStatus,
      changedById: userId,
      notes: notes || `Status changed to ${newStatus}`
    }
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyPOStatusUpdated(id, existing.docNumber, existing.status, newStatus, triggeredByName)
    )
    .catch(() => {});
  
  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
  return po;
}

export async function submitPO(id: string, userId: string) {
  return changePOStatus(id, 'SUBMITTED', userId, 'PO Submitted to supplier');
}

export async function cancelPO(id: string, userId: string, reason?: string, pin?: string) {
  if (!pin) {
    throw new Error('PIN required to cancel/void a PO');
  }
  const pinResult = await verifyPinForAction(userId, pin, 'VOID_DOCUMENT');
  if (!pinResult.success) {
    throw new Error(pinResult.messageKey ?? pinResult.message);
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { grns: { select: { id: true } }, items: { select: { receivedQty: true } } }
  });

  if (!po) throw new Error('PO not found');

  // Safety: block cancelling if anything was received (even if GRN rows aren't linked via poId).
  const anyReceived = (po.items ?? []).some((it) => Number(it.receivedQty) > 0);
  if (po.grns.length > 0 || anyReceived) {
    throw new Error('Cannot cancel PO with GRNs');
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    
    await tx.pOStatusHistory.create({
      data: {
        poId: id,
        status: 'CANCELLED',
        changedById: userId,
        notes: reason || 'PO Cancelled'
      }
    });
  });
  
  revalidatePath('/backoffice/purchase-orders');
}

export async function getPOs(
  filters?: {
    status?: POStatus;
    statusIn?: POStatus[];
    supplierId?: string;
    fromDate?: Date;
    toDate?: Date;
    overdue?: boolean;
    paymentDueFrom?: Date;
    paymentDueTo?: Date;
    paid?: boolean;
  },
  opts?: { page: number; pageSize: number }
) {
  const where: any = {};

  if (filters?.status) {
    where.status = filters.status;
  }
  if (filters?.statusIn?.length) {
    where.status = { in: filters.statusIn };
  }

  if (filters?.supplierId) {
    where.supplierId = filters.supplierId;
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
  if (filters?.paymentDueFrom || filters?.paymentDueTo) {
    where.paymentDueDate = {};
    if (filters.paymentDueFrom) {
      where.paymentDueDate.gte = filters.paymentDueFrom;
    }
    if (filters.paymentDueTo) {
      where.paymentDueDate.lte = filters.paymentDueTo;
    }
  }
  if (filters?.paid === true) {
    where.paidAt = { not: null };
  }
  if (filters?.paid === false) {
    where.paidAt = null;
  }

  if (filters?.overdue) {
    where.etaDate = { lt: new Date() };
    where.status = { notIn: ['CLOSED', 'OVER', 'CANCELLED'] };
  }

  const include = {
    supplier: {
      select: {
        name: true,
        code: true,
      },
    },
    items: {
      include: {
        item: {
          select: {
            sku: true,
            nameId: true,
          },
        },
      },
    },
    _count: {
      select: {
        grns: true,
      },
    },
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [pos, totalCount] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    const items = pos.map((po) => ({
      ...po,
      totalAmount: toNum(po.totalAmount),
      taxAmount: toNum(po.taxAmount),
      grandTotal: toNum(po.grandTotal),
      items: po.items.map((i) => ({
        ...i,
        qty: toNum(i.qty),
        price: toNum(i.price),
        receivedQty: toNum(i.receivedQty),
      })),
      etaAlert: getETAStatus(po.etaDate, po.status),
    }));
    return { items, totalCount };
  }

  const pos = await prisma.purchaseOrder.findMany({
    where,
    include,
    orderBy: { createdAt: 'desc' },
  });

  return pos.map((po) => ({
    ...po,
    totalAmount: toNum(po.totalAmount),
    taxAmount: toNum(po.taxAmount),
    grandTotal: toNum(po.grandTotal),
    items: po.items.map((i) => ({
      ...i,
      qty: toNum(i.qty),
      price: toNum(i.price),
      receivedQty: toNum(i.receivedQty),
    })),
    etaAlert: getETAStatus(po.etaDate, po.status),
  }));
}

function toNum(v: unknown): number | null {
  return v == null ? null : Number(v);
}

export async function getPOById(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: {
          item: {
            include: {
              uom: true
            }
          }
        }
      },
      grns: true,
      statusHistory: {
        include: {
          changedBy: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });
  if (!po) return null;
  return {
    ...po,
    totalAmount: toNum(po.totalAmount),
    taxAmount: toNum(po.taxAmount),
    grandTotal: toNum(po.grandTotal),
    items: po.items.map((i) => ({
      ...i,
      qty: toNum(i.qty),
      price: toNum(i.price),
      receivedQty: toNum(i.receivedQty),
    })),
    grns: po.grns.map((g) => ({
      id: g.id,
      docNumber: g.docNumber,
      totalAmount: toNum(g.totalAmount),
      grnDate: g.grnDate,
    })),
  };
}

// Get overdue POs with alert status
export async function getOverduePOs() {
  const today = new Date();
  
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      etaDate: { lt: today },
      status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] }
    },
    include: {
      supplier: {
        select: {
          name: true,
          code: true
        }
      },
      items: {
        select: {
          qty: true,
          receivedQty: true
        }
      }
    },
    orderBy: { etaDate: 'asc' }
  });
  
  return pos.map(po => {
    const etaStatus = getETAStatus(po.etaDate, po.status);
    const totalQty = po.items.reduce((sum, item) => sum + Number(item.qty), 0);
    const receivedQty = po.items.reduce((sum, item) => sum + Number(item.receivedQty), 0);
    const pendingQty = totalQty - receivedQty;

    return {
      id: po.id,
      docNumber: po.docNumber,
      etaDate: po.etaDate,
      status: po.status,
      grandTotal: Number(po.grandTotal),
      supplier: po.supplier,
      daysOverdue: Math.abs(etaStatus.daysUntil),
      pendingQty,
      etaAlert: etaStatus,
    };
  });
}

// Get PO statistics for dashboard
export async function getPOStats() {
  const [
    totalPOs,
    draftPOs,
    submittedPOs,
    partialPOs,
    overduePOs,
    totalValue
  ] = await Promise.all([
    prisma.purchaseOrder.count(),
    prisma.purchaseOrder.count({ where: { status: 'DRAFT' } }),
    prisma.purchaseOrder.count({ where: { status: 'SUBMITTED' } }),
    prisma.purchaseOrder.count({ where: { status: 'PARTIAL' } }),
    prisma.purchaseOrder.count({
      where: {
        etaDate: { lt: new Date() },
        status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] }
      }
    }),
    prisma.purchaseOrder.aggregate({
      _sum: { grandTotal: true }
    })
  ]);
  
  return {
    totalPOs,
    draftPOs,
    submittedPOs,
    partialPOs,
    overduePOs,
    totalValue: Number(totalValue._sum.grandTotal ?? 0),
  };
}

/** Mark a PO as paid (or unmark by passing paidAt: null). */
export async function setPOPaidAt(poId: string, paidAt: Date | null) {
  const session = await auth();
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { docNumber: true, status: true },
  });
  if (!po) throw new Error('PO not found');

  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { paidAt },
  });

  if (session?.user?.id) {
    await prisma.pOStatusHistory.create({
      data: {
        poId,
        status: po.status,
        changedById: session.user.id,
        paymentEvent: paidAt != null ? 'MARKED' : 'UNMARKED',
        notes: paidAt != null ? 'Supplier payment marked' : 'Supplier payment unmarked',
      },
    });
    getActorName(session.user.id)
      .then((triggeredByName) =>
        notifyPOPaymentToggled(poId, po.docNumber, paidAt != null, triggeredByName)
      )
      .catch(() => {});
  }

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath('/backoffice/purchase-orders/[id]');
  revalidatePath('/backoffice/supplier-payments');
}
