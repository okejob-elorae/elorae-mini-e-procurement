'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { POStatus } from '@prisma/client';
import { poSchema } from '@/lib/validations';
import { getETAStatus } from '@/lib/eta-alerts';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { z } from 'zod';

export type POFormData = z.infer<typeof poSchema>;

export async function createPO(data: POFormData, userId: string) {
  const validated = poSchema.parse(data);
  
  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('PO', tx);
    
    // Calculate totals
    const totalAmount = validated.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));
    
    const po = await tx.purchaseOrder.create({
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
        poId: po.id,
        status: 'DRAFT',
        changedById: userId,
        notes: 'PO Created'
      }
    });
    
    return po;
  });
}

export async function updatePO(
  id: string,
  data: POFormData,
  userId: string,
  pin?: string
) {
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true }
  });

  if (existing?.status !== 'DRAFT') {
    if (!pin) {
      throw new Error('PIN required to edit a posted PO');
    }
    const pinResult = await verifyPinForAction(userId, pin, 'EDIT_POSTED_PO');
    if (!pinResult.success) {
      throw new Error(pinResult.message);
    }
  }

  return await prisma.$transaction(async (tx) => {
    const totalAmount = data.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));
    
    // Delete old items and create new ones
    await tx.pOItem.deleteMany({ where: { poId: id } });
    
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
        items: {
          create: data.items
        }
      },
      include: {
        items: { include: { item: true } },
        supplier: true
      }
    });
    
    return po;
  });
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
      throw new Error(pinResult.message);
    }
  }

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
    throw new Error(pinResult.message);
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { grns: true }
  });

  if (!po) throw new Error('PO not found');

  if (po.grns.length > 0) {
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

export async function getPOs(filters?: {
  status?: POStatus;
  statusIn?: POStatus[];
  supplierId?: string;
  fromDate?: Date;
  toDate?: Date;
  overdue?: boolean;
  paymentDueFrom?: Date;
  paymentDueTo?: Date;
  paid?: boolean;
}) {
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
  
  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: {
        select: {
          name: true,
          code: true
        }
      },
      items: {
        include: {
          item: {
            select: {
              sku: true,
              nameId: true
            }
          }
        }
      },
      _count: {
        select: {
          grns: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
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
  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { paidAt },
  });
  revalidatePath('/backoffice/purchase-orders');
  revalidatePath('/backoffice/purchase-orders/[id]');
  revalidatePath('/backoffice/supplier-payments');
}
