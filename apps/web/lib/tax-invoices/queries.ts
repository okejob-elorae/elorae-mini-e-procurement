import { prisma, Prisma } from "@elorae/db";

export type TaxInvoiceRow = {
  id: string;
  status: string;
  invoiceNo: string | null;
  notaPrintedAt: Date | null;
  docNo: string;
  storeName: string;
  orderId: string;
  invoiceDate: Date;
  dueDate: Date;
  total: number;
};

export type TaxInvoiceStatusFilter = "PENDING" | "CREATED" | "NOT_REQUIRED";

/**
 * `counts` deliberately drops the `status` term (kept applying `q`) so the queue's status tabs
 * always show every bucket's total for the current search, never collapsing onto the count of
 * whichever tab is active.
 */
export async function listTaxInvoices(params: {
  status?: TaxInvoiceStatusFilter;
  q?: string;
  page: number;
  perPage: number;
}): Promise<{ rows: TaxInvoiceRow[]; total: number; counts: Record<TaxInvoiceStatusFilter, number> }> {
  const baseWhere: Prisma.TaxInvoiceWhereInput = {};
  const q = params.q?.trim();
  if (q) {
    baseWhere.OR = [
      { invoiceNo: { contains: q } },
      { delivery: { OR: [{ docNo: { contains: q } }, { order: { store: { name: { contains: q } } } }] } },
    ];
  }
  const where: Prisma.TaxInvoiceWhereInput = params.status ? { ...baseWhere, status: params.status } : baseWhere;

  const [rows, total, countRows] = await Promise.all([
    prisma.taxInvoice.findMany({
      where,
      orderBy: { delivery: { invoiceDate: "desc" } },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      select: {
        id: true,
        status: true,
        invoiceNo: true,
        notaPrintedAt: true,
        delivery: {
          select: {
            docNo: true,
            invoiceDate: true,
            dueDate: true,
            total: true,
            orderId: true,
            order: { select: { store: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.taxInvoice.count({ where }),
    prisma.taxInvoice.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const counts: Record<TaxInvoiceStatusFilter, number> = { PENDING: 0, CREATED: 0, NOT_REQUIRED: 0 };
  for (const c of countRows) {
    counts[c.status as TaxInvoiceStatusFilter] = c._count._all;
  }

  /**
   * The migration declares no foreign key (`relationMode = "prisma"`), so a `TaxInvoice` can
   * outlive its delivery. Prisma types the relation as always present, but a dangling row comes
   * back with `delivery` null at runtime, and dereferencing it would reject the whole query — one
   * orphan would blank the entire queue page, with no way to fix it from any UI. Orphans are
   * skipped instead; `total` and `counts` still include them, which is a deliberately visible
   * discrepancy rather than a silently smaller page.
   */
  const mapped = rows.map((r): TaxInvoiceRow | null => {
    const delivery: (typeof r)["delivery"] | null = r.delivery;
    if (!delivery) return null;
    return {
      id: r.id,
      status: r.status,
      invoiceNo: r.invoiceNo,
      notaPrintedAt: r.notaPrintedAt,
      docNo: delivery.docNo,
      storeName: delivery.order.store.name,
      orderId: delivery.orderId,
      invoiceDate: delivery.invoiceDate,
      dueDate: delivery.dueDate,
      total: Number(delivery.total),
    };
  });

  return {
    rows: mapped.filter((r): r is TaxInvoiceRow => r !== null),
    total,
    counts,
  };
}
