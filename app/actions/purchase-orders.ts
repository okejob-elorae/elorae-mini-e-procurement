'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { POStatus } from '@prisma/client';

const poItemSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().positive(),
  price: z.number().positive(),
  uomId: z.string(),
  notes: z.string().optional()
});

const poSchema = z.object({
  supplierId: z.string().uuid(),
  etaDate: z.date().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  items: z.array(poItemSchema).min(1, 'At least one item is required')
});

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

export async function submitPO(id: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'SUBMITTED' }
    });
    
    await tx.pOStatusHistory.create({
      data: {
        poId: id,
        status: 'SUBMITTED',
        changedById: userId,
        notes: 'PO Submitted to supplier'
      }
    });
  });
  
  revalidatePath('/backoffice/purchase-orders');
}

export async function cancelPO(id: string, userId: string, reason?: string) {
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
  supplierId?: string;
  fromDate?: Date;
  toDate?: Date;
  overdue?: boolean;
}) {
  const where: any = {};
  
  if (filters?.status) {
    where.status = filters.status;
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
  
  if (filters?.overdue) {
    where.etaDate = { lt: new Date() };
    where.status = { notIn: ['CLOSED', 'CANCELLED'] };
  }
  
  return await prisma.purchaseOrder.findMany({
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
}

export async function getPOById(id: string) {
  return await prisma.purchaseOrder.findUnique({
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
        orderBy: { createdAt: 'desc' }
      }
    }
  });
}

// Get overdue POs with alert status
export async function getOverduePOs() {
  const today = new Date();
  
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      etaDate: { lt: today },
      status: { notIn: ['CLOSED', 'CANCELLED'] }
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
    const daysOverdue = Math.floor((today.getTime() - po.etaDate!.getTime()) / (1000 * 60 * 60 * 24));
    const totalQty = po.items.reduce((sum, item) => sum + Number(item.qty), 0);
    const receivedQty = po.items.reduce((sum, item) => sum + Number(item.receivedQty), 0);
    const pendingQty = totalQty - receivedQty;
    
    return {
      ...po,
      daysOverdue,
      pendingQty,
      alertStatus: daysOverdue > 7 ? 'danger' : daysOverdue > 3 ? 'warning' : 'info'
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
        status: { notIn: ['CLOSED', 'CANCELLED'] }
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
    totalValue: totalValue._sum.grandTotal || 0
  };
}
