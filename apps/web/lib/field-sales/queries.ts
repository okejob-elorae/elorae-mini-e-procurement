import { prisma, Prisma } from "@elorae/db";

export type FieldSalesOrderStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export type FieldSalesOrderListItem = {
  id: string;
  orderNo: string;
  storeName: string;
  salesmanName: string;
  status: FieldSalesOrderStatus;
  total: number;
  createdAt: Date;
};

export type FieldSalesOrderDetail = FieldSalesOrderListItem & {
  note: string | null;
  subtotal: number;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  lines: Array<{ id: string; productName: string; variantSku: string; qty: number; unitPrice: number; lineTotal: number }>;
};

const toNum = (v: Prisma.Decimal | number): number => Number(v);

export function serializeListItem(row: {
  id: string;
  orderNo: string;
  status: FieldSalesOrderStatus;
  total: Prisma.Decimal | number;
  createdAt: Date;
  store: { name: string };
  salesman: { name: string | null };
}): FieldSalesOrderListItem {
  return {
    id: row.id,
    orderNo: row.orderNo,
    storeName: row.store.name,
    salesmanName: row.salesman.name ?? "—",
    status: row.status,
    total: toNum(row.total),
    createdAt: row.createdAt,
  };
}

export async function listFieldSalesOrders(
  filter: { status?: FieldSalesOrderStatus; search?: string },
  paging: { page: number; pageSize: number },
): Promise<{ orders: FieldSalesOrderListItem[]; totalCount: number }> {
  const where: Prisma.FieldSalesOrderWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.search && filter.search.trim()) {
    const s = filter.search.trim();
    where.OR = [{ orderNo: { contains: s } }, { store: { name: { contains: s } } }];
  }
  const [rows, totalCount] = await Promise.all([
    prisma.fieldSalesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (paging.page - 1) * paging.pageSize,
      take: paging.pageSize,
      select: {
        id: true, orderNo: true, status: true, total: true, createdAt: true,
        store: { select: { name: true } },
        salesman: { select: { name: true } },
      },
    }),
    prisma.fieldSalesOrder.count({ where }),
  ]);
  return { orders: rows.map(serializeListItem), totalCount };
}

export async function getFieldSalesOrderById(id: string): Promise<FieldSalesOrderDetail | null> {
  const row = await prisma.fieldSalesOrder.findUnique({
    where: { id },
    select: {
      id: true, orderNo: true, status: true, total: true, subtotal: true, note: true,
      approvedAt: true, rejectedAt: true, rejectReason: true, createdAt: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      lines: { select: { id: true, productName: true, variantSku: true, qty: true, unitPrice: true, lineTotal: true } },
    },
  });
  if (!row) return null;
  return {
    ...serializeListItem(row),
    note: row.note,
    subtotal: toNum(row.subtotal),
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    rejectReason: row.rejectReason,
    lines: row.lines.map((l) => ({
      id: l.id, productName: l.productName, variantSku: l.variantSku,
      qty: l.qty, unitPrice: toNum(l.unitPrice), lineTotal: toNum(l.lineTotal),
    })),
  };
}
