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
    baseWhere.delivery = {
      OR: [{ docNo: { contains: q } }, { order: { store: { name: { contains: q } } } }],
    };
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

  return {
    rows: rows.map((r) => ({
      id: r.id,
      status: r.status,
      invoiceNo: r.invoiceNo,
      notaPrintedAt: r.notaPrintedAt,
      docNo: r.delivery.docNo,
      storeName: r.delivery.order.store.name,
      orderId: r.delivery.orderId,
      invoiceDate: r.delivery.invoiceDate,
      dueDate: r.delivery.dueDate,
      total: Number(r.delivery.total),
    })),
    total,
    counts,
  };
}
