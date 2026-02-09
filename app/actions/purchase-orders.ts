'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { POStatus } from '@prisma/client';
import { poSchema, poItemSchema } from '@/lib/validations';
import { getETAStatus } from '@/lib/eta-alerts';

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

export async function updatePO(
  id: string, 
  data: POFormData, 
  userId: string
) {
  // Only allow update if status is DRAFT
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true }
  });
  
  if (existing?.status !== 'DRAFT') {
    throw new Error('Only draft POs can be edited');
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
  notes?: string
) {
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

  // Add ETA status to each PO
  return pos.map(po => ({
    ...po,
    etaAlert: getETAStatus(po.etaDate, po.status)
  }));
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
    const etaStatus = getETAStatus(po.etaDate, po.status);
    const totalQty = po.items.reduce((sum, item) => sum + Number(item.qty), 0);
    const receivedQty = po.items.reduce((sum, item) => sum + Number(item.receivedQty), 0);
    const pendingQty = totalQty - receivedQty;
    
    return {
      ...po,
      daysOverdue: Math.abs(etaStatus.daysUntil),
      pendingQty,
      etaAlert: etaStatus
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
