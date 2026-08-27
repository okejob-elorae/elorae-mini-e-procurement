import { prisma, type Prisma } from "@elorae/db";
import { daysOverdue, agingBucket, type AgingBucket } from "@/lib/finance/ar/aging";

export type CollectionQueueRow = {
  receivableId: string;
  storeName: string;
  docNo: string;
  outstandingAmount: number;
  dueDate: Date;
  daysOverdue: number;
  bucket: AgingBucket;
  pendingSubmittedAmount: number;
};

export async function listCollectionQueue(collectorId: string, asOf: Date = new Date()): Promise<CollectionQueueRow[]> {
  const receivables = await prisma.receivable.findMany({
    where: { collectorId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      outstandingAmount: true,
      dueDate: true,
      store: { select: { name: true } },
      delivery: { select: { docNo: true } },
      submissions: { where: { status: "PENDING" }, select: { amount: true } },
    },
  });

  return receivables.map((r) => ({
    receivableId: r.id,
    storeName: r.store.name,
    docNo: r.delivery.docNo,
    outstandingAmount: Number(r.outstandingAmount),
    dueDate: r.dueDate,
    daysOverdue: daysOverdue(r.dueDate, asOf),
    bucket: agingBucket(r.dueDate, asOf),
    pendingSubmittedAmount: r.submissions.reduce((s, sub) => s + Number(sub.amount), 0),
  }));
}

export type PendingCollectionFilters = {
  collectorId?: string;
  storeId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
};

export async function listPendingCollections(filters: PendingCollectionFilters): Promise<{ rows: Array<{ id: string; receivableId: string; storeName: string; docNo: string; collectorName: string; amount: number; method: string; paidAt: Date; createdAt: Date }>; total: number }> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const where: Prisma.CollectionSubmissionWhereInput = { status: "PENDING" };
  if (filters.collectorId) where.collectorId = filters.collectorId;
  if (filters.storeId) where.receivable = { storeId: filters.storeId };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
    if (filters.dateTo) where.createdAt.lte = filters.dateTo;
  }

  const [found, total] = await Promise.all([
    prisma.collectionSubmission.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        receivableId: true,
        amount: true,
        method: true,
        paidAt: true,
        createdAt: true,
        collector: { select: { name: true, email: true } },
        receivable: { select: { store: { select: { name: true } }, delivery: { select: { docNo: true } } } },
      },
    }),
    prisma.collectionSubmission.count({ where }),
  ]);

  return {
    rows: found.map((f) => ({
      id: f.id,
      receivableId: f.receivableId,
      storeName: f.receivable.store.name,
      docNo: f.receivable.delivery.docNo,
      collectorName: f.collector.name ?? f.collector.email,
      amount: Number(f.amount),
      method: f.method,
      paidAt: f.paidAt,
      createdAt: f.createdAt,
    })),
    total,
  };
}

export async function getCollectionSubmission(id: string) {
  const s = await prisma.collectionSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      receivableId: true,
      amount: true,
      method: true,
      paidAt: true,
      note: true,
      proofUrl: true,
      status: true,
      rejectReason: true,
      collector: { select: { name: true, email: true } },
      receivable: {
        select: {
          storeId: true,
          outstandingAmount: true,
          store: { select: { name: true } },
          delivery: { select: { docNo: true } },
        },
      },
    },
  });
  if (!s) return null;
  return {
    id: s.id,
    receivableId: s.receivableId,
    amount: Number(s.amount),
    method: s.method,
    paidAt: s.paidAt,
    note: s.note,
    proofUrl: s.proofUrl,
    status: s.status,
    rejectReason: s.rejectReason,
    collectorName: s.collector.name ?? s.collector.email,
    storeId: s.receivable.storeId,
    storeName: s.receivable.store.name,
    docNo: s.receivable.delivery.docNo,
    liveOutstanding: Number(s.receivable.outstandingAmount),
  };
}

export async function listCollectorCandidates(): Promise<Array<{ id: string; name: string }>> {
  const users = await prisma.user.findMany({
    where: { roleDefinition: { permissions: { some: { permission: { code: "collections:collect" } } } } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}

export type CollectionReceivableDetail = {
  receivableId: string;
  storeName: string;
  docNo: string;
  outstandingAmount: number;
  dueDate: Date;
  pendingSubmittedAmount: number;
};

/**
 * Reads a single receivable scoped to a specific assigned collector. Returns `null` both when the
 * receivable does not exist AND when `collectorId` does not match the assignment, so a collector can
 * never even read a receivable that isn't theirs — the same shape as a 404, not a 403, so the caller
 * cannot distinguish "not yours" from "doesn't exist".
 */
export async function getReceivableForCollection(receivableId: string, collectorId: string): Promise<CollectionReceivableDetail | null> {
  const r = await prisma.receivable.findUnique({
    where: { id: receivableId },
    select: {
      id: true,
      collectorId: true,
      outstandingAmount: true,
      dueDate: true,
      store: { select: { name: true } },
      delivery: { select: { docNo: true } },
      submissions: { where: { status: "PENDING" }, select: { amount: true } },
    },
  });
  if (!r || r.collectorId !== collectorId) return null;

  return {
    receivableId: r.id,
    storeName: r.store.name,
    docNo: r.delivery.docNo,
    outstandingAmount: Number(r.outstandingAmount),
    dueDate: r.dueDate,
    pendingSubmittedAmount: r.submissions.reduce((s, sub) => s + Number(sub.amount), 0),
  };
}
