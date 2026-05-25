import { prisma } from '@elorae/db';

export type ListWorkOrdersFilters = {
  status?: string;
  vendorId?: string;
  fromDate?: Date;
  toDate?: Date;
};

export type ListWorkOrdersOpts = {
  page: number;
  pageSize: number;
};

const workOrderListInclude = {
  vendor: {
    select: {
      name: true,
      code: true,
    },
  },
  finishedGood: {
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
    },
  },
  _count: {
    select: {
      issues: true,
      receipts: true,
    },
  },
} as const;

function serializeWorkOrderRow(wo: {
  id: string;
  docNumber: string;
  vendorId: string;
  finishedGoodId: string;
  outputMode: string;
  plannedQty: unknown;
  actualQty: unknown;
  targetDate: Date | null;
  status: string;
  issuedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  canceledReason: string | null;
  notes: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  vendor: { name: string; code: string };
  finishedGood: { id: string; sku: string; nameId: string; nameEn: string };
  _count: { issues: number; receipts: number };
}) {
  return {
    id: wo.id,
    docNumber: wo.docNumber,
    vendorId: wo.vendorId,
    finishedGoodId: wo.finishedGoodId,
    outputMode: wo.outputMode,
    plannedQty: Number(wo.plannedQty),
    actualQty: wo.actualQty != null ? Number(wo.actualQty) : null,
    targetDate: wo.targetDate,
    status: wo.status,
    issuedAt: wo.issuedAt,
    completedAt: wo.completedAt,
    canceledAt: wo.canceledAt,
    canceledReason: wo.canceledReason,
    notes: wo.notes,
    createdById: wo.createdById,
    createdAt: wo.createdAt,
    updatedAt: wo.updatedAt,
    vendor: wo.vendor,
    finishedGood: wo.finishedGood,
    _count: wo._count,
  };
}

export async function listWorkOrders(
  filters?: ListWorkOrdersFilters,
  opts?: ListWorkOrdersOpts
) {
  const where: Record<string, unknown> = {};

  if (filters?.status) {
    where.status = filters.status;
  }
  if (filters?.vendorId) {
    where.vendorId = filters.vendorId;
  }
  if (filters?.fromDate || filters?.toDate) {
    where.createdAt = {};
    if (filters.fromDate) {
      (where.createdAt as { gte?: Date }).gte = filters.fromDate;
    }
    if (filters.toDate) {
      (where.createdAt as { lte?: Date }).lte = filters.toDate;
    }
  }

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: workOrderListInclude,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workOrder.count({ where }),
    ]);
    return {
      items: rows.map(serializeWorkOrderRow),
      totalCount,
    };
  }

  const rows = await prisma.workOrder.findMany({
    where,
    include: workOrderListInclude,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeWorkOrderRow);
}

/** Normalize list rows for client props (listWorkOrders already serializes; safe to re-run). */
export function serializeWorkOrderListRows(
  rows: Array<Parameters<typeof serializeWorkOrderRow>[0]>
) {
  return rows.map(serializeWorkOrderRow);
}
