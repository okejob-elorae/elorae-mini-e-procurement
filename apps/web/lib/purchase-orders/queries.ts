import { prisma } from '@elorae/db';
import { getETAStatus } from '@/lib/eta-alerts';
import type { POStatus } from '@elorae/db';
import { serializePODetail, serializePOListRow } from '@/lib/purchase-orders/serialize';
import {
  hasStandingPaymentJournalWhileUnpaid,
  poIdsWithStandingPaymentJournalWhileUnpaid,
} from '@/lib/purchasing/supplier-payment-journal';

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

/**
 * Per-row facts a list caller can ask for that are NOT columns on
 * `PurchaseOrder` and cost their own queries, so no page pays for one it does
 * not render.
 */
export type ListPOsExtras = {
  /**
   * Adds `paymentJournalStandingWhileUnpaid` to every returned row. Asked for by
   * the surfaces that offer a paid toggle — the supplier-payments register — so
   * they can withhold the mark on exactly the POs the PO detail page withholds it
   * on. Costs a fixed three queries for the whole page (see
   * `poIdsWithStandingPaymentJournalWhileUnpaid`), never three per row, and the
   * id count reaches that detector as predicate width — which is why this is
   * opt-in for a PAGINATED caller rather than always-on for the unpaginated ones.
   */
  withStandingPaymentJournal?: boolean;
};

/**
 * A serialized list row, plus the opt-in flag. Optional because a caller that
 * did not ask for it must not be handed `false` — that would read as "this PO is
 * fine to mark paid" on a page that never checked.
 */
type POListRow = ReturnType<typeof serializePOListRow> & {
  paymentJournalStandingWhileUnpaid?: boolean;
};

/**
 * Stamps the standing-payment flag onto rows when it was asked for. Scoped to the
 * rows that are actually UNPAID: a paid PO can never be in this state, so the
 * detector is never asked about one.
 */
async function withStandingPaymentFlag(
  rows: POListRow[],
  extras?: ListPOsExtras
): Promise<POListRow[]> {
  if (!extras?.withStandingPaymentJournal) return rows;

  const unpaidIds = rows.filter((row) => row.paidAt == null).map((row) => row.id);
  const flagged = await poIdsWithStandingPaymentJournalWhileUnpaid(unpaidIds);

  return rows.map((row) => ({
    ...row,
    paymentJournalStandingWhileUnpaid: flagged.has(row.id),
  }));
}

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
export async function listPOs(
  filters?: ListPOsFilters,
  opts?: ListPOsOpts,
  extras?: ListPOsExtras
) {
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
    const items = await withStandingPaymentFlag(
      pos.map((po) => serializePOListRow(po)),
      extras
    );
    return { items, totalCount };
  }

  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: poListInclude,
    orderBy: { createdAt: 'desc' },
  });

  return withStandingPaymentFlag(
    pos.map((po) => serializePOListRow(po)),
    extras
  );
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

  /*
   * Read here rather than in a parallel fetch from the detail page: the page
   * takes its whole payload from this one query, and a second round trip for a
   * warning banner would let the banner disagree with the paid badge beside it.
   * Only asked for an unpaid PO — the detector answers false for a paid one
   * anyway, this just skips two queries for the common case.
   */
  const paymentJournalStandingWhileUnpaid =
    po.paidAt == null ? await hasStandingPaymentJournalWhileUnpaid(id) : false;

  return serializePODetail({
    ...po,
    paymentJournalStandingWhileUnpaid,
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
