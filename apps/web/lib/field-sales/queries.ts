import { prisma, Prisma } from "@elorae/db";
import { variantDetailForSku } from "@/lib/items/variants";

export type FieldSalesOrderStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export type FieldSalesOrderType = "PUTUS" | "KONSI";

export type FieldSalesOrderListItem = {
  id: string;
  orderNo: string;
  orderType: FieldSalesOrderType;
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
  marginPercent: number | null;
  orderDiscountAmount: number;
  appliedOrderPromoName: string | null;
  lines: Array<{
    id: string;
    productName: string;
    variantSku: string;
    variantLabel: string | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    available: number;
    discountAmount: number;
    appliedPromoName: string | null;
    belowCost: boolean;
  }>;
};

const toNum = (v: Prisma.Decimal | number): number => Number(v);

export function serializeListItem(row: {
  id: string;
  orderNo: string;
  orderType: FieldSalesOrderType;
  status: FieldSalesOrderStatus;
  total: Prisma.Decimal | number;
  createdAt: Date;
  store: { name: string };
  salesman: { name: string | null };
}): FieldSalesOrderListItem {
  return {
    id: row.id,
    orderNo: row.orderNo,
    orderType: row.orderType,
    storeName: row.store.name,
    salesmanName: row.salesman.name ?? "—",
    status: row.status,
    total: toNum(row.total),
    createdAt: row.createdAt,
  };
}

export async function listFieldSalesOrders(
  filter: { status?: FieldSalesOrderStatus; search?: string; orderType?: FieldSalesOrderType },
  paging: { page: number; pageSize: number },
): Promise<{ orders: FieldSalesOrderListItem[]; totalCount: number }> {
  const where: Prisma.FieldSalesOrderWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.orderType) where.orderType = filter.orderType;
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
        id: true, orderNo: true, orderType: true, status: true, total: true, createdAt: true,
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
      id: true, orderNo: true, orderType: true, status: true, total: true, subtotal: true, note: true,
      approvedAt: true, rejectedAt: true, rejectReason: true, createdAt: true,
      orderDiscountAmount: true, appliedOrderPromoId: true,
      store: { select: { name: true, marginPercent: true } },
      salesman: { select: { name: true } },
      lines: {
        select: {
          id: true, itemId: true, productName: true, variantSku: true, qty: true, unitPrice: true, lineTotal: true,
          discountAmount: true, appliedPromoId: true,
          item: { select: { variants: true } },
        },
      },
    },
  });
  if (!row) return null;
  const itemIds = Array.from(new Set(row.lines.map((l) => l.itemId)));
  const invs = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true, avgCost: true },
  });
  // Per-variant keyed (matches per-variant order lines). Variantless rows use null → "".
  const invKey = (itemId: string, variantSku: string | null | undefined) => `${itemId}::${variantSku ?? ""}`;
  const availByKey = new Map<string, number>();
  const avgCostByKey = new Map<string, number>();
  for (const iv of invs) {
    const k = invKey(iv.itemId, iv.variantSku);
    availByKey.set(k, (availByKey.get(k) ?? 0) + (Number(iv.qtyOnHand) - Number(iv.reservedQty)));
    if (!avgCostByKey.has(k)) avgCostByKey.set(k, Number(iv.avgCost));
  }

  const promoIds = Array.from(
    new Set([row.appliedOrderPromoId, ...row.lines.map((l) => l.appliedPromoId)].filter((v): v is string => v !== null)),
  );
  const promos = promoIds.length > 0
    ? await prisma.promo.findMany({ where: { id: { in: promoIds } }, select: { id: true, name: true } })
    : [];
  const promoNameById = new Map(promos.map((p) => [p.id, p.name]));

  return {
    ...serializeListItem(row),
    note: row.note,
    subtotal: toNum(row.subtotal),
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    rejectReason: row.rejectReason,
    marginPercent: row.store.marginPercent === null ? null : Number(row.store.marginPercent),
    orderDiscountAmount: toNum(row.orderDiscountAmount),
    appliedOrderPromoName: row.appliedOrderPromoId ? promoNameById.get(row.appliedOrderPromoId) ?? null : null,
    lines: row.lines.map((l) => {
      const qty = l.qty;
      const discountAmount = toNum(l.discountAmount);
      const netUnit = qty > 0 ? (toNum(l.lineTotal) - discountAmount) / qty : 0;
      const avgCost = avgCostByKey.get(invKey(l.itemId, l.variantSku)) ?? 0;
      return {
        id: l.id, productName: l.productName, variantSku: l.variantSku,
        variantLabel: variantDetailForSku(l.item.variants, l.variantSku),
        qty, unitPrice: toNum(l.unitPrice), lineTotal: toNum(l.lineTotal),
        available: availByKey.get(invKey(l.itemId, l.variantSku)) ?? 0,
        discountAmount,
        appliedPromoName: l.appliedPromoId ? promoNameById.get(l.appliedPromoId) ?? null : null,
        belowCost: row.orderType === "PUTUS" && qty > 0 && netUnit < avgCost,
      };
    }),
  };
}

export type StoreOrderSummaryRow = {
  id: string;
  orderNo: string;
  orderType: FieldSalesOrderType;
  status: "PENDING_APPROVAL" | "APPROVED";
  total: number;
  createdAtIso: string;
};

export async function getStoreOrderSummary(storeId: string): Promise<StoreOrderSummaryRow[]> {
  const rows = await prisma.fieldSalesOrder.findMany({
    where: { storeId, status: { not: "REJECTED" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, orderNo: true, orderType: true, status: true, total: true, createdAt: true },
  });
  return rows.map(r => ({
    id: r.id,
    orderNo: r.orderNo,
    orderType: r.orderType as FieldSalesOrderType,
    status: r.status as "PENDING_APPROVAL" | "APPROVED",
    total: Number(r.total),
    createdAtIso: r.createdAt.toISOString(),
  }));
}

export async function sentItemIds(
  storeId: string,
  tx: { fieldSalesOrderLine: typeof prisma.fieldSalesOrderLine } = prisma,
): Promise<Set<string>> {
  const rows = await tx.fieldSalesOrderLine.findMany({
    where: { order: { storeId, orderType: "KONSI", status: { not: "REJECTED" } } },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  return new Set(rows.map((r) => r.itemId));
}
