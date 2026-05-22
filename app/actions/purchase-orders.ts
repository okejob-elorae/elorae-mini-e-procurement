'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { POStatus } from '@prisma/client';
import { poSchema } from '@/lib/validations';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { getActorName, notifyPOCreated, notifyPOStatusUpdated, notifyPOPaymentToggled } from '@/app/actions/notifications';
import { createPurchaseOrder, type POFormData } from '@/lib/purchase-orders/mutations';
import { listPOs, getPOById as getPOByIdQuery } from '@/lib/purchase-orders/queries';
import { assertLinesVariantSkusMatchItemDefinitions } from '@/lib/items/validate-variant-lines';

function poReceiptLineKey(itemId: string, variantSku?: string | null) {
  return `${itemId}\n${variantSku ?? ''}`;
}

export async function createPO(data: POFormData, userId: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_CREATE);

  let po;
  try {
    po = await createPurchaseOrder(data, userId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(error.issues[0]?.message ?? 'Invalid purchase order data');
    }
    throw error;
  }

  getActorName(userId)
    .then((triggeredByName) => notifyPOCreated(po.id, po.docNumber, triggeredByName))
    .catch(() => {});

  return { id: po.id, docNumber: po.docNumber };
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
    await assertLinesVariantSkusMatchItemDefinitions(tx.item, data.items);

    const oldItems = await tx.pOItem.findMany({
      where: { poId: id },
      select: { itemId: true, variantSku: true, receivedQty: true },
    });
    const receivedByLine = new Map<string, number>();
    for (const o of oldItems) {
      const r = Number(o.receivedQty);
      const k = poReceiptLineKey(o.itemId, o.variantSku);
      receivedByLine.set(k, (receivedByLine.get(k) ?? 0) + r);
    }

    if (preserveReceived) {
      for (const [key, recv] of receivedByLine) {
        if (recv <= 0) continue;
        const lines = data.items.filter(
          (i) => poReceiptLineKey(i.itemId, i.variantSku ?? null) === key
        );
        const totalNewQty = lines.reduce((s, i) => s + i.qty, 0);
        if (lines.length === 0 || totalNewQty < recv) {
          throw new Error(
            `Cannot edit: a line has ${recv} received — keep that line and qty ≥ ${recv}, or remove only zero-received lines.`
          );
        }
      }
    }

    const totalAmount = data.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));

    await tx.pOItem.deleteMany({ where: { poId: id } });

    const remainingRecv = new Map(receivedByLine);
    const itemCreates = data.items.map((item) => {
      const k = poReceiptLineKey(item.itemId, item.variantSku ?? null);
      const avail = remainingRecv.get(k) ?? 0;
      const receivedQty = preserveReceived ? Math.min(avail, item.qty) : 0;
      remainingRecv.set(k, Math.max(0, avail - receivedQty));
      return {
        itemId: item.itemId,
        variantSku: item.variantSku?.trim() || null,
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
  return { id };
}

export async function changePOStatus(
  id: string,
  newStatus: 'SUBMITTED' | 'CANCELLED' | 'CLOSED',
  userId: string,
  notes?: string,
  pin?: string
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  if (newStatus === 'SUBMITTED') {
    requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_APPROVE);
  } else {
    requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);
  }

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
  return { id: po.id, status: po.status };
}

export async function submitPO(id: string, userId: string) {
  return changePOStatus(id, 'SUBMITTED', userId, 'PO Submitted to supplier');
}

export async function cancelPO(id: string, userId: string, reason?: string, pin?: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);

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
  filters?: Parameters<typeof listPOs>[0],
  opts?: Parameters<typeof listPOs>[1]
) {
  return listPOs(filters, opts);
}

export async function getPOById(id: string) {
  return getPOByIdQuery(id);
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
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);

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
