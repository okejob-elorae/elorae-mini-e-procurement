import { prisma, Prisma } from "@elorae/db";
import { TAX_INVOICE_SOURCE_SELECT, resolveTaxInvoiceSource } from "@/lib/finance/ar/receivable-source";

export type TaxInvoiceRow = {
  id: string;
  status: string;
  invoiceNo: string | null;
  buyerNpwp: string | null;
  taxableAmount: number | null;
  ppnAmount: number | null;
  notaPrintedAt: Date | null;
  docNo: string;
  storeId: string;
  storeName: string;
  storeNpwp: string | null;
  orderId: string | null;
  sourceKind: "DELIVERY" | "SELL_THROUGH";
  sellThroughId: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  total: number | null;
};

export type TaxInvoiceStatusFilter = "PENDING" | "CREATED" | "SENT_TO_STORE" | "NOT_REQUIRED" | "CANCELLED";

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
      { sellThrough: { OR: [{ docNo: { contains: q } }, { store: { name: { contains: q } } }] } },
    ];
  }
  const where: Prisma.TaxInvoiceWhereInput = params.status ? { ...baseWhere, status: params.status } : baseWhere;

  const [rows, total, countRows] = await Promise.all([
    prisma.taxInvoice.findMany({
      where,
      /* Issue order for both sources — delivery completion for putus, invoicing for konsi. */
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      select: {
        id: true,
        status: true,
        invoiceNo: true,
        buyerNpwp: true,
        taxableAmount: true,
        ppnAmount: true,
        notaPrintedAt: true,
        ...TAX_INVOICE_SOURCE_SELECT,
      },
    }),
    prisma.taxInvoice.count({ where }),
    prisma.taxInvoice.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const counts: Record<TaxInvoiceStatusFilter, number> = {
    PENDING: 0,
    CREATED: 0,
    SENT_TO_STORE: 0,
    NOT_REQUIRED: 0,
    CANCELLED: 0,
  };
  for (const c of countRows) {
    counts[c.status as TaxInvoiceStatusFilter] = c._count._all;
  }

  /**
   * The migration declares no foreign key (`relationMode = "prisma"`), so a `TaxInvoice` can
   * outlive its delivery or sell-through report. Prisma types both relations as optional, and a
   * row carrying neither is an orphan whose backing document was deleted out from under it —
   * dereferencing it would reject the whole query, so one orphan would blank the entire queue
   * page with no way to fix it from any UI. Orphans are skipped instead; `total` and `counts`
   * still include them, which is a deliberately visible discrepancy rather than a silently
   * smaller page.
   */
  const mapped = rows.map((r): TaxInvoiceRow | null => {
    if (!r.delivery && !r.sellThrough) return null;
    const source = resolveTaxInvoiceSource(r);
    return {
      id: r.id,
      status: r.status,
      invoiceNo: r.invoiceNo,
      buyerNpwp: r.buyerNpwp,
      taxableAmount: r.taxableAmount !== null ? Number(r.taxableAmount) : null,
      ppnAmount: r.ppnAmount !== null ? Number(r.ppnAmount) : null,
      notaPrintedAt: r.notaPrintedAt,
      docNo: source.docNo,
      storeId: source.storeId,
      storeName: source.storeName,
      storeNpwp: source.storeNpwp,
      orderId: source.kind === "DELIVERY" ? source.orderId : null,
      sourceKind: source.kind,
      sellThroughId: source.kind === "SELL_THROUGH" ? source.sellThroughId : null,
      invoiceDate: source.invoiceDate,
      dueDate: source.dueDate,
      total: source.total,
    };
  });

  return {
    rows: mapped.filter((r): r is TaxInvoiceRow => r !== null),
    total,
    counts,
  };
}
