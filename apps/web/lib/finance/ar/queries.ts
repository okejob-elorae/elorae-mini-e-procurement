import { prisma, type Prisma } from "@elorae/db";
import { agingBucket, AGING_BUCKETS, daysOverdue, type AgingBucket } from "./aging";

export type ReceivableFilters = {
  storeId?: string;
  salesmanId?: string;
  status?: "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF";
  bucket?: AgingBucket;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
  /** Injected so specs are deterministic; production leaves it out. */
  asOf?: Date;
};

export type ReceivableRow = {
  id: string;
  storeId: string;
  storeName: string;
  docNo: string;
  salesmanName: string;
  invoiceDate: Date;
  dueDate: Date;
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  daysOverdue: number;
  bucket: AgingBucket;
};

const emptyBucketTotals = (): Record<AgingBucket, number> =>
  AGING_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: 0 }), {} as Record<AgingBucket, number>);

function whereFor(f: ReceivableFilters): Prisma.ReceivableWhereInput {
  const where: Prisma.ReceivableWhereInput = {};
  if (f.storeId) where.storeId = f.storeId;
  if (f.status) where.status = f.status;
  if (f.salesmanId) where.delivery = { order: { salesmanId: f.salesmanId } };
  if (f.dateFrom || f.dateTo) {
    where.invoiceDate = {};
    if (f.dateFrom) where.invoiceDate.gte = f.dateFrom;
    if (f.dateTo) where.invoiceDate.lte = f.dateTo;
  }
  const search = f.search?.trim();
  if (search) {
    /*
     * AND-wrapped so this cannot collide with the `delivery` key the salesman filter already uses:
     * two sibling `delivery` properties on the same object would overwrite each other.
     */
    where.AND = [
      {
        OR: [
          { store: { name: { contains: search } } },
          { delivery: { docNo: { contains: search } } },
        ],
      },
    ];
  }
  return where;
}

/**
 * `asOf` is read ONCE per invocation and threaded everywhere. Calling `new Date()` per row would let
 * a row's bucket be computed against a different instant than the total it feeds, so the summary
 * strip could disagree with the table it sits above.
 */
export async function listReceivables(filters: ReceivableFilters): Promise<{
  rows: ReceivableRow[];
  total: number;
  bucketTotals: Record<AgingBucket, number>;
  grandOutstanding: number;
}> {
  const asOf = filters.asOf ?? new Date();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const where = whereFor(filters);

  /*
   * Two queries on purpose. The aging summary must total EVERY matching row, not the current page —
   * a summary that only adds up one page is simply wrong. This one stays `select`-narrow so folding
   * the whole book is cheap.
   */
  const allForTotals = await prisma.receivable.findMany({
    where,
    select: { dueDate: true, outstandingAmount: true },
  });

  const bucketTotals = emptyBucketTotals();
  let grandOutstanding = 0;
  for (const r of allForTotals) {
    const bucket = agingBucket(r.dueDate, asOf);
    /* The bucket filter is applied here too, so the strip always agrees with the table. */
    if (filters.bucket && bucket !== filters.bucket) continue;
    const outstanding = Number(r.outstandingAmount);
    bucketTotals[bucket] += outstanding;
    grandOutstanding += outstanding;
  }

  /*
   * `bucket` is derived, never stored, so it cannot be a SQL filter. When it is set, the page has to
   * be cut in JS after the fold — which means fetching the matching set rather than a SQL page.
   * Sorted by dueDate then id so pagination is stable either way.
   */
  const paginate = filters.bucket === undefined;
  const found = await prisma.receivable.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    ...(paginate ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    select: {
      id: true,
      storeId: true,
      invoiceDate: true,
      dueDate: true,
      originalAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      status: true,
      store: { select: { name: true } },
      delivery: {
        select: { docNo: true, order: { select: { salesman: { select: { name: true } } } } },
      },
    },
  });

  const mapped: ReceivableRow[] = found.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    storeName: r.store.name,
    docNo: r.delivery.docNo,
    salesmanName: r.delivery.order.salesman.name ?? "",
    invoiceDate: r.invoiceDate,
    dueDate: r.dueDate,
    originalAmount: Number(r.originalAmount),
    paidAmount: Number(r.paidAmount),
    outstandingAmount: Number(r.outstandingAmount),
    status: r.status,
    daysOverdue: daysOverdue(r.dueDate, asOf),
    bucket: agingBucket(r.dueDate, asOf),
  }));

  if (filters.bucket === undefined) {
    const total = await prisma.receivable.count({ where });
    return { rows: mapped, total, bucketTotals, grandOutstanding };
  }

  const filtered = mapped.filter((r) => r.bucket === filters.bucket);
  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    bucketTotals,
    grandOutstanding,
  };
}

export async function getReceivable(id: string, asOf: Date = new Date()) {
  const r = await prisma.receivable.findUnique({
    where: { id },
    select: {
      id: true,
      storeId: true,
      deliveryId: true,
      invoiceDate: true,
      dueDate: true,
      originalAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      status: true,
      store: { select: { name: true, code: true } },
      delivery: {
        select: { docNo: true, order: { select: { orderNo: true, salesman: { select: { name: true } } } } },
      },
      /*
       * VOIDED payments stay in the history. Hiding them makes the arithmetic unexplainable — the
       * balance moved twice and the ledger would show neither move. `status` is exposed so the UI can
       * strike the row through instead of dropping it.
       */
      allocations: {
        select: {
          amount: true,
          payment: {
            select: { id: true, docNo: true, paidAt: true, method: true, status: true },
          },
        },
      },
    },
  });
  if (!r) return null;
  return {
    ...r,
    originalAmount: Number(r.originalAmount),
    paidAmount: Number(r.paidAmount),
    outstandingAmount: Number(r.outstandingAmount),
    daysOverdue: daysOverdue(r.dueDate, asOf),
    bucket: agingBucket(r.dueDate, asOf),
    allocations: r.allocations.map((a) => ({ ...a, amount: Number(a.amount) })),
  };
}

export type PaymentFilters = {
  storeId?: string;
  method?: "CASH" | "TRANSFER";
  status?: "POSTED" | "VOIDED";
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
};

export async function listPayments(filters: PaymentFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const where: Prisma.PaymentWhereInput = {};
  if (filters.storeId) where.storeId = filters.storeId;
  if (filters.method) where.method = filters.method;
  if (filters.status) where.status = filters.status;
  if (filters.dateFrom || filters.dateTo) {
    where.paidAt = {};
    if (filters.dateFrom) where.paidAt.gte = filters.dateFrom;
    if (filters.dateTo) where.paidAt.lte = filters.dateTo;
  }

  const [found, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        docNo: true,
        paidAt: true,
        method: true,
        amount: true,
        status: true,
        store: { select: { name: true } },
        _count: { select: { allocations: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    rows: found.map((p) => ({
      id: p.id,
      docNo: p.docNo,
      paidAt: p.paidAt,
      method: p.method,
      amount: Number(p.amount),
      status: p.status,
      storeName: p.store.name,
      allocationCount: p._count.allocations,
    })),
    total,
  };
}

export async function getPayment(id: string) {
  const p = await prisma.payment.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      paidAt: true,
      method: true,
      amount: true,
      reference: true,
      proofUrl: true,
      note: true,
      status: true,
      voidedAt: true,
      voidReason: true,
      store: { select: { id: true, name: true, code: true } },
      recordedBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
      allocations: {
        select: {
          amount: true,
          receivable: {
            select: { id: true, outstandingAmount: true, delivery: { select: { docNo: true } } },
          },
        },
      },
    },
  });
  if (!p) return null;
  return {
    ...p,
    amount: Number(p.amount),
    allocations: p.allocations.map((a) => ({
      amount: Number(a.amount),
      receivableId: a.receivable.id,
      docNo: a.receivable.delivery.docNo,
      outstandingAmount: Number(a.receivable.outstandingAmount),
    })),
  };
}
