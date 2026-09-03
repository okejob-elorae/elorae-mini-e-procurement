import { prisma, type Prisma } from "@elorae/db";
import { agingBucket, AGING_BUCKETS, daysOverdue, type AgingBucket } from "./aging";

export type ReceivableFilters = {
  storeId?: string;
  salesmanId?: string;
  collectorId?: string;
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
  collectorName: string | null;
};

const emptyBucketTotals = (): Record<AgingBucket, number> =>
  AGING_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: 0 }), {} as Record<AgingBucket, number>);

export function whereFor(f: ReceivableFilters): Prisma.ReceivableWhereInput {
  const where: Prisma.ReceivableWhereInput = {};
  if (f.storeId) where.storeId = f.storeId;
  if (f.collectorId) where.collectorId = f.collectorId;
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

  /*
   * `bucketTotals` and `grandOutstanding` deliberately disagree when a bucket filter is set, and the
   * asymmetry is the point.
   *
   * The tiles are a numeric readout of WHERE the debt sits, so every one of them always folds the
   * whole matching set — the bucket filter is never applied to them. Folding only the selected
   * bucket made the other five tiles render `Rp 0`, which `AgingSummary` then greys out as an empty
   * bucket: click the D1_30 tile on a book holding 5.000.000 in D1_30 and 50.000.000 in D120_PLUS
   * and the strip claimed there was no debt over 120 days. A tile that hides 50M of exposure is
   * worse than a strip that does not match the table beneath it.
   *
   * `grandOutstanding` stays filtered because it describes the CURRENT VIEW, and its label switches
   * to say so when a bucket is selected.
   */
  const bucketTotals = emptyBucketTotals();
  let grandOutstanding = 0;
  for (const r of allForTotals) {
    const bucket = agingBucket(r.dueDate, asOf);
    const outstanding = Number(r.outstandingAmount);
    bucketTotals[bucket] += outstanding;
    if (filters.bucket && bucket !== filters.bucket) continue;
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
      collector: { select: { name: true } },
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
    collectorName: r.collector?.name ?? null,
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
      collectorId: true,
      store: { select: { name: true, code: true } },
      delivery: {
        select: {
          docNo: true,
          order: { select: { id: true, orderNo: true, salesman: { select: { name: true } } } },
        },
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
      collector: { select: { name: true } },
      submissions: {
        select: {
          id: true,
          amount: true,
          method: true,
          paidAt: true,
          status: true,
          rejectReason: true,
          collector: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
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
    collectorName: r.collector?.name ?? null,
    submissions: r.submissions.map((s) => ({
      ...s,
      amount: Number(s.amount),
      collectorName: s.collector.name,
    })),
  };
}

export type AllocationCandidate = {
  id: string;
  docNo: string;
  dueDate: Date;
  outstandingAmount: number;
};

/**
 * `listReceivables` takes a single `status`, so a store's full set of allocation candidates
 * (OUTSTANDING + PARTIAL) needs two calls merged rather than one. Each call is already scoped to
 * this one store, so it stays well clear of the "unpaginated fetch of the whole book" a payment
 * sheet must never do — `pageSize` is a generous ceiling on one store's own open invoices, not a
 * page cursor. Shared by the piutang receivable-detail sheet and the field-return offset sheet —
 * both need the same store-scoped candidate set.
 */
const CANDIDATE_PAGE_SIZE = 500;

export async function listAllocationCandidatesForStore(storeId: string): Promise<AllocationCandidate[]> {
  const [outstanding, partial] = await Promise.all([
    listReceivables({ storeId, status: "OUTSTANDING", pageSize: CANDIDATE_PAGE_SIZE }),
    listReceivables({ storeId, status: "PARTIAL", pageSize: CANDIDATE_PAGE_SIZE }),
  ]);
  return [...outstanding.rows, ...partial.rows]
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map((r) => ({ id: r.id, docNo: r.docNo, dueDate: r.dueDate, outstandingAmount: r.outstandingAmount }));
}

export type StorePiutangRow = {
  id: string;
  docNo: string;
  dueDateIso: string;
  outstandingAmount: number;
  bucket: AgingBucket;
  daysOverdue: number;
};

export type StorePiutangSummary = {
  grandOutstanding: number;
  bucketTotals: Record<AgingBucket, number>;
  openCount: number;
  rows: StorePiutangRow[];
};

/**
 * `bucketTotals`/`grandOutstanding` come from an unfiltered call because PAID/WRITTEN_OFF rows
 * always carry outstandingAmount 0 and so contribute nothing to either fold — filtering by status
 * for the totals call would be redundant, not more correct. `rows`/`total` from that call are
 * discarded (they'd include zero-balance historical docs); the display rows come from the same
 * OUTSTANDING+PARTIAL merge `listAllocationCandidatesForStore` already uses above.
 */
export async function getStorePiutangSummary(
  storeId: string,
  asOf: Date = new Date(),
  take = 5,
): Promise<StorePiutangSummary> {
  const [totals, outstanding, partial] = await Promise.all([
    listReceivables({ storeId, asOf, pageSize: 1 }),
    listReceivables({ storeId, status: "OUTSTANDING", asOf, pageSize: CANDIDATE_PAGE_SIZE }),
    listReceivables({ storeId, status: "PARTIAL", asOf, pageSize: CANDIDATE_PAGE_SIZE }),
  ]);
  const merged = [...outstanding.rows, ...partial.rows].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  );
  return {
    grandOutstanding: totals.grandOutstanding,
    bucketTotals: totals.bucketTotals,
    openCount: merged.length,
    rows: merged.slice(0, take).map((r) => ({
      id: r.id,
      docNo: r.docNo,
      dueDateIso: r.dueDate.toISOString(),
      outstandingAmount: r.outstandingAmount,
      bucket: r.bucket,
      daysOverdue: r.daysOverdue,
    })),
  };
}

export type PaymentFilters = {
  storeId?: string;
  method?: "CASH" | "TRANSFER" | "RETUR_OFFSET";
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
      returOffsetFor: { select: { id: true, docNo: true } },
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
    returOffsetFor: p.returOffsetFor ? { id: p.returOffsetFor.id, docNo: p.returOffsetFor.docNo } : null,
    allocations: p.allocations.map((a) => ({
      amount: Number(a.amount),
      receivableId: a.receivable.id,
      docNo: a.receivable.delivery.docNo,
      outstandingAmount: Number(a.receivable.outstandingAmount),
    })),
  };
}

export type ReceivableExportRow = {
  storeName: string;
  docNo: string;
  invoiceDate: Date;
  dueDate: Date;
  daysOverdue: number;
  bucket: AgingBucket;
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  collectorName: string | null;
  salesmanName: string;
};

/**
 * Hard cap, not a page size — this is a full-book export, not a paginated list. Truncation is
 * reported to the caller (`truncated`, `totalRows`) rather than applied silently: a silent cutoff
 * on a finance export is how a number gets reported wrong. `listReceivables`'s own `pageSize: 25`
 * default already carries a logged follow-up about a DIFFERENT silent-truncation shape — that
 * mistake is not repeated here.
 */
export const EXPORT_ROW_CAP = 10_000;

/**
 * Shares `whereFor` with `listReceivables` so the export always matches exactly what the
 * operator sees on `/backoffice/finance/piutang` with the same filters applied. Unpaginated
 * (aside from the hard cap) — this produces the whole matching book in one call, unlike
 * `listReceivables`'s page-at-a-time shape.
 *
 * When `filters.bucket` is set, the cap is applied BEFORE the JS bucket filter (bucket is
 * derived from `dueDate`+`asOf`, never a stored column, so it cannot be a SQL `where`) — the same
 * ordering constraint `listReceivables` has. `truncated` therefore reflects whether the
 * PRE-bucket-filter matching set exceeded the cap, which can be true even when the final
 * bucket-filtered row count is small. This is a deliberate over-report, not an under-report: it
 * warns the operator whenever the underlying result set was already large, which is the safer
 * direction to be wrong in on a finance export.
 */
export async function listReceivablesForExport(
  filters: ReceivableFilters,
  options?: { cap?: number },
): Promise<{ rows: ReceivableExportRow[]; truncated: boolean; totalRows: number }> {
  const asOf = filters.asOf ?? new Date();
  const cap = options?.cap ?? EXPORT_ROW_CAP;
  const where = whereFor(filters);

  const totalRows = await prisma.receivable.count({ where });

  const found = await prisma.receivable.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: cap,
    select: {
      invoiceDate: true,
      dueDate: true,
      originalAmount: true,
      paidAmount: true,
      outstandingAmount: true,
      status: true,
      store: { select: { name: true } },
      delivery: { select: { docNo: true, order: { select: { salesman: { select: { name: true } } } } } },
      collector: { select: { name: true } },
    },
  });

  let rows: ReceivableExportRow[] = found.map((r) => ({
    storeName: r.store.name,
    docNo: r.delivery.docNo,
    invoiceDate: r.invoiceDate,
    dueDate: r.dueDate,
    daysOverdue: daysOverdue(r.dueDate, asOf),
    bucket: agingBucket(r.dueDate, asOf),
    originalAmount: Number(r.originalAmount),
    paidAmount: Number(r.paidAmount),
    outstandingAmount: Number(r.outstandingAmount),
    status: r.status,
    collectorName: r.collector?.name ?? null,
    salesmanName: r.delivery.order.salesman.name ?? "",
  }));

  if (filters.bucket !== undefined) {
    rows = rows.filter((r) => r.bucket === filters.bucket);
  }

  return { rows, truncated: totalRows > cap, totalRows };
}
