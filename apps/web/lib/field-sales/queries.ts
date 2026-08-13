import { prisma, Prisma } from "@elorae/db";
import { aggregateInventoryValues } from "@/lib/items/queries";
import { variantDetailForSku } from "@/lib/items/variants";
import { outstandingQty } from "./delivery/plan";
import type { PlanHistory } from "./smart-request/plan";

export type FieldSalesOrderStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export type FieldSalesOrderType = "PUTUS" | "KONSI";

export type FieldSalesDeliveryStatus = "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";

export type FieldSalesDeliveryLineSummary = {
  id: string;
  orderLineId: string;
  productName: string;
  variantSku: string;
  qty: number;
  unitPrice: number | null;
  discountAmount: number;
  lineTotal: number | null;
};

export type FieldSalesDeliverySummary = {
  id: string;
  docNo: string;
  deliveredAt: Date;
  invoiceDate: Date;
  dueDate: Date;
  subtotal: number;
  discountAmount: number;
  total: number;
  deliveredByName: string;
  lines: FieldSalesDeliveryLineSummary[];
};

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
  closedAt: Date | null;
  closeReason: string | null;
  marginPercent: number | null;
  paymentTempo: number;
  orderDiscountAmount: number;
  appliedOrderPromoName: string | null;
  deliveryStatus: FieldSalesDeliveryStatus;
  deliveries: FieldSalesDeliverySummary[];
  lines: Array<{
    id: string;
    itemId: string;
    productName: string;
    variantSku: string;
    variantLabel: string | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    available: number;
    onHand: number;
    outstanding: number;
    discountAmount: number;
    appliedPromoName: string | null;
    belowCost: boolean;
    requestedUnitPrice: number | null;
    appealReason: string | null;
    addedById: string | null;
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
  filter: { status?: FieldSalesOrderStatus; search?: string; orderType?: FieldSalesOrderType; storeId?: string },
  paging: { page: number; pageSize: number },
): Promise<{ orders: FieldSalesOrderListItem[]; totalCount: number }> {
  const where: Prisma.FieldSalesOrderWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.orderType) where.orderType = filter.orderType;
  if (filter.storeId) where.storeId = filter.storeId;
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
      closedAt: true, closeReason: true,
      orderDiscountAmount: true, appliedOrderPromoId: true, deliveryStatus: true,
      store: { select: { name: true, marginPercent: true, paymentTempo: true } },
      salesman: { select: { name: true } },
      lines: {
        select: {
          id: true, itemId: true, productName: true, variantSku: true, qty: true, unitPrice: true, lineTotal: true,
          discountAmount: true, appliedPromoId: true, requestedUnitPrice: true, appealReason: true,
          deliveredQty: true, cancelledQty: true, addedById: true,
          item: { select: { variants: true } },
        },
      },
      deliveries: {
        orderBy: { deliveredAt: "asc" },
        select: {
          id: true, docNo: true, deliveredAt: true, invoiceDate: true, dueDate: true,
          subtotal: true, discountAmount: true, total: true,
          deliveredBy: { select: { name: true } },
          lines: {
            select: {
              id: true, orderLineId: true, productName: true, variantSku: true, qty: true,
              unitPrice: true, discountAmount: true, lineTotal: true,
            },
          },
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
  /**
   * Parallel to availByKey but holds raw qtyOnHand, not qtyOnHand - reservedQty. The delivery
   * form caps on-hand, and this order's own reservation already sits inside reservedQty, so
   * netting it again here would under-deliver.
   */
  const onHandByKey = new Map<string, number>();
  const avgCostByKey = new Map<string, number>();
  for (const iv of invs) {
    const k = invKey(iv.itemId, iv.variantSku);
    availByKey.set(k, (availByKey.get(k) ?? 0) + (Number(iv.qtyOnHand) - Number(iv.reservedQty)));
    onHandByKey.set(k, (onHandByKey.get(k) ?? 0) + Number(iv.qtyOnHand));
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
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    marginPercent: row.store.marginPercent === null ? null : Number(row.store.marginPercent),
    paymentTempo: row.store.paymentTempo,
    orderDiscountAmount: toNum(row.orderDiscountAmount),
    appliedOrderPromoName: row.appliedOrderPromoId ? promoNameById.get(row.appliedOrderPromoId) ?? null : null,
    deliveryStatus: row.deliveryStatus,
    deliveries: row.deliveries.map((d) => ({
      id: d.id,
      docNo: d.docNo,
      deliveredAt: d.deliveredAt,
      invoiceDate: d.invoiceDate,
      dueDate: d.dueDate,
      subtotal: toNum(d.subtotal),
      discountAmount: toNum(d.discountAmount),
      total: toNum(d.total),
      deliveredByName: d.deliveredBy.name ?? "—",
      lines: d.lines.map((dl) => ({
        id: dl.id,
        orderLineId: dl.orderLineId,
        productName: dl.productName,
        variantSku: dl.variantSku,
        qty: dl.qty,
        unitPrice: dl.unitPrice === null ? null : toNum(dl.unitPrice),
        discountAmount: toNum(dl.discountAmount),
        lineTotal: dl.lineTotal === null ? null : toNum(dl.lineTotal),
      })),
    })),
    lines: row.lines.map((l) => {
      const qty = l.qty;
      const discountAmount = toNum(l.discountAmount);
      const netUnit = qty > 0 ? (toNum(l.lineTotal) - discountAmount) / qty : 0;
      const avgCost = avgCostByKey.get(invKey(l.itemId, l.variantSku)) ?? 0;
      return {
        id: l.id, itemId: l.itemId, productName: l.productName, variantSku: l.variantSku,
        variantLabel: variantDetailForSku(l.item.variants, l.variantSku),
        qty, unitPrice: toNum(l.unitPrice), lineTotal: toNum(l.lineTotal),
        available: availByKey.get(invKey(l.itemId, l.variantSku)) ?? 0,
        onHand: onHandByKey.get(invKey(l.itemId, l.variantSku)) ?? 0,
        outstanding: outstandingQty({ qty: l.qty, deliveredQty: l.deliveredQty, cancelledQty: l.cancelledQty }),
        discountAmount,
        appliedPromoName: l.appliedPromoId ? promoNameById.get(l.appliedPromoId) ?? null : null,
        belowCost: row.orderType === "PUTUS" && qty > 0 && netUnit < avgCost,
        requestedUnitPrice: l.requestedUnitPrice === null ? null : toNum(l.requestedUnitPrice),
        appealReason: l.appealReason,
        addedById: l.addedById,
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

export type StoreSentItemRow = {
  itemId: string;
  articleSku: string;
  articleName: string;
  variantSku: string;
  totalQty: number;
};

/**
 * Putus counts what actually SHIPPED — the delivery lines — not what was approved. Approval became
 * paperwork when delivery got its own document: an approved order can sit undelivered, or be
 * partly delivered and have its remainder closed, and neither leaves the warehouse. Konsi has no
 * delivery document (the transfer is recorded at approve and nothing ships afterwards), so its
 * approved lines stay the only signal there.
 */
export async function getStoreSentItems(storeId: string): Promise<StoreSentItemRow[]> {
  const [deliveredPutus, approvedKonsi] = await Promise.all([
    prisma.fieldSalesDeliveryLine.groupBy({
      by: ["itemId", "variantSku"],
      where: { delivery: { order: { storeId } } },
      _sum: { qty: true },
    }),
    prisma.fieldSalesOrderLine.groupBy({
      by: ["itemId", "variantSku"],
      where: { order: { storeId, status: "APPROVED", orderType: "KONSI" } },
      _sum: { qty: true },
    }),
  ]);

  const byKey = new Map<string, { itemId: string; variantSku: string; totalQty: number }>();
  for (const g of [...deliveredPutus, ...approvedKonsi]) {
    const key = `${g.itemId}::${g.variantSku}`;
    const existing = byKey.get(key);
    if (existing) existing.totalQty += g._sum.qty ?? 0;
    else byKey.set(key, { itemId: g.itemId, variantSku: g.variantSku, totalQty: g._sum.qty ?? 0 });
  }
  const grouped = Array.from(byKey.values());
  if (grouped.length === 0) return [];

  const itemIds = Array.from(new Set(grouped.map((g) => g.itemId)));
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, sku: true, nameId: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  return grouped
    .map((g) => {
      const item = itemById.get(g.itemId);
      return {
        itemId: g.itemId,
        articleSku: item?.sku ?? "—",
        articleName: item?.nameId ?? "—",
        variantSku: g.variantSku && g.variantSku.trim() !== "" ? g.variantSku : "—",
        totalQty: g.totalQty,
      };
    })
    .sort((a, b) => a.articleSku.localeCompare(b.articleSku) || a.variantSku.localeCompare(b.variantSku));
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

export async function getSmartRequestHistory(storeId: string, candidateItemIds: string[]): Promise<PlanHistory> {
  const orderedRows = await prisma.fieldSalesOrderLine.findMany({
    where: { order: { storeId, status: { not: "REJECTED" } } },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  const ordered = new Set(orderedRows.map((r) => r.itemId));
  const neverOrdered = new Set(candidateItemIds.filter((id) => !ordered.has(id)));

  const grouped = await prisma.fieldSalesOrderLine.groupBy({
    by: ["itemId"],
    where: { order: { storeId, status: "APPROVED" } },
    _sum: { qty: true },
  });
  const qtyByItem = new Map<string, number>(grouped.map((g) => [g.itemId, g._sum.qty ?? 0]));
  return { neverOrdered, qtyByItem };
}

export type KonsiSuggestion = {
  itemId: string;
  variantSku: string;
  sku: string;
  name: string;
  variantLabel: string | null;
  available: number;
};

/**
 * Goods never sent to this store, for the admin to add while approving a konsi order.
 * "Never sent" is ITEM-level (matches `sentItemIds` and the writer's ALREADY_SENT check): if any
 * variant of an item was ever sent to this store, the whole item is excluded. Each surviving item
 * is then expanded into one row per variant (real InventoryValue row), because availability and
 * the writer's `addedLines` are both per-variant.
 */
export async function listKonsiSuggestions(orderId: string): Promise<KonsiSuggestion[]> {
  const order = await prisma.fieldSalesOrder.findUnique({
    where: { id: orderId },
    select: { storeId: true, orderType: true, lines: { select: { itemId: true } } },
  });
  if (!order || order.orderType !== "KONSI") return [];

  const sent = await sentItemIds(order.storeId);
  const onOrder = new Set(order.lines.map((l) => l.itemId));
  const exclude = new Set<string>([...sent, ...onOrder]);

  const where: Prisma.ItemWhereInput = { isActive: true, type: "FINISHED_GOOD" };
  /* Prisma's notIn with an empty array is untrustworthy to lean on — skip the filter entirely. */
  if (exclude.size > 0) where.id = { notIn: [...exclude] };

  const items = await prisma.item.findMany({
    where,
    select: {
      id: true,
      sku: true,
      nameId: true,
      variants: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true } },
    },
    orderBy: { sku: "asc" },
  });

  /*
   * `InventoryValue` is unique on (itemId, variantSku), but MariaDB permits multiple NULLs, so an
   * item can carry both a `null` and an `""` row (e.g. a variant item restocked via ERP GRN/production
   * writes a `null` pooled row the per-variant sale won't see — see CLAUDE.md). Both normalize to the
   * same suggestion key. Dedupe by (itemId, normalized variantSku) rather than emitting one row per
   * raw InventoryValue row, so a collision can't render two indistinguishable suggestions.
   */
  const byKey = new Map<string, { item: (typeof items)[number]; variantSku: string; available: number }>();
  for (const item of items) {
    for (const iv of item.inventoryValues) {
      const variantSku = iv.variantSku ?? "";
      /* Availability is derived, never stored: qtyOnHand - reservedQty. */
      const available = aggregateInventoryValues([iv])!.available;
      const key = `${item.id}::${variantSku}`;
      const existing = byKey.get(key);
      if (existing) {
        /*
         * On a collision, keep the MINIMUM available rather than summing. The writer reserves
         * against a single row chosen by `findFieldSalesInventory`'s findFirst, so the minimum is
         * the only figure guaranteed not to exceed what that reservation can actually satisfy.
         * Summing (as getFieldSalesOrderById does) would offer more than the writer can honor and
         * fail the approval; under-offering only hides a little stock. Fail-safe direction wins.
         */
        existing.available = Math.min(existing.available, available);
      } else {
        byKey.set(key, { item, variantSku, available });
      }
    }
  }

  const rows: KonsiSuggestion[] = Array.from(byKey.values()).map(({ item, variantSku, available }) => ({
    itemId: item.id,
    variantSku,
    sku: item.sku,
    name: item.nameId,
    variantLabel: variantDetailForSku(item.variants, variantSku),
    available,
  }));
  return rows.sort((a, b) => a.sku.localeCompare(b.sku) || a.variantSku.localeCompare(b.variantSku));
}
