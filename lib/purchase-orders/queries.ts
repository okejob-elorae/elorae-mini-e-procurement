import { prisma } from '@/lib/prisma';
import { getETAStatus } from '@/lib/eta-alerts';
import type { POStatus } from '@prisma/client';
import { serializePODetail, serializePOListRow } from '@/lib/purchase-orders/serialize';

export type ListPOsFilters = {
  status?: POStatus;
  statusIn?: POStatus[];
  supplierId?: string;
  fromDate?: Date;
  toDate?: Date;
  overdue?: boolean;
  paymentDueFrom?: Date;
  paymentDueTo?: Date;
  paid?: boolean;
};

export type ListPOsOpts = { page: number; pageSize: number };

function buildPOsWhere(filters?: ListPOsFilters) {
  const where: Record<string, unknown> = {};

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
      (where.createdAt as Record<string, Date>).gte = filters.fromDate;
    }
    if (filters.toDate) {
      (where.createdAt as Record<string, Date>).lte = filters.toDate;
    }
  }
  if (filters?.paymentDueFrom || filters?.paymentDueTo) {
    where.paymentDueDate = {};
    if (filters.paymentDueFrom) {
      (where.paymentDueDate as Record<string, Date>).gte = filters.paymentDueFrom;
    }
    if (filters.paymentDueTo) {
      (where.paymentDueDate as Record<string, Date>).lte = filters.paymentDueTo;
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

  return where;
}

const poListInclude = {
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
} as const;

/** Serialized PO rows safe for RSC → client props and server action responses. */
export async function listPOs(filters?: ListPOsFilters, opts?: ListPOsOpts) {
  const where = buildPOsWhere(filters);

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [pos, totalCount] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: poListInclude,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return { items: pos.map((po) => serializePOListRow(po)), totalCount };
  }

  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: poListInclude,
    orderBy: { createdAt: 'desc' },
  });

  return pos.map((po) => serializePOListRow(po));
}

export async function getPOById(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: {
          item: {
            select: {
              id: true,
              sku: true,
              nameId: true,
              nameEn: true,
              type: true,
              variants: true,
              uom: true,
            },
          },
        },
      },
      grns: true,
      statusHistory: {
        include: {
          changedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!po) return null;
  return serializePODetail({
    ...po,
    items: po.items.map((line) => ({
      ...line,
      item: line.item
        ? {
            ...line.item,
            uom: line.item.uom
              ? {
                  id: line.item.uom.id,
                  code: line.item.uom.code,
                  nameId: line.item.uom.nameId,
                  nameEn: line.item.uom.nameEn,
                }
              : null,
          }
        : null,
    })),
  });
}

export async function getOverduePOs() {
  const today = new Date();

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      etaDate: { lt: today },
      status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] },
    },
    include: {
      supplier: {
        select: {
          name: true,
          code: true,
        },
      },
      items: {
        select: {
          qty: true,
          receivedQty: true,
        },
      },
    },
    orderBy: { etaDate: 'asc' },
  });

  return pos.map((po) => {
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
