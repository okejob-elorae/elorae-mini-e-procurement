import { prisma } from "@elorae/db";
import type { SalesChannel, SalesOrderStatus, SalesOrderFulfillmentStatus } from "@/lib/constants/enums";

export type SalesOrderListFilter = {
  search?: string;
  channel?: SalesChannel;
  status?: SalesOrderStatus;
  dateFrom?: Date;
  dateTo?: Date;
};

export type Pagination = { page: number; pageSize: number };

export type SalesOrderListRow = {
  id: string;
  salesorderNo: string;
  channel: SalesChannel;
  status: SalesOrderStatus;
  customerName: string | null;
  grandTotal: string;
  transactionDate: Date;
};

export type SalesOrderDetail = {
  id: string;
  salesorderId: number;
  salesorderNo: string;
  channel: SalesChannel;
  sourceName: string;
  status: SalesOrderStatus;
  channelStatus: string | null;
  internalStatus: string | null;
  wmsStatus: string | null;
  isCanceled: boolean;
  isPaid: boolean;
  markedAsComplete: boolean;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingProvince: string | null;
  shippingCity: string | null;
  shippingAddress: Record<string, string | null> | null;
  subTotal: string;
  totalDisc: string;
  totalTax: string;
  shippingCost: string;
  grandTotal: string;
  feeBreakdown: Record<string, string> | null;
  paymentMethod: string | null;
  paymentDate: Date | null;
  transactionDate: Date;
  createdDateJubelio: Date | null;
  completedDate: Date | null;
  cancelDate: Date | null;
  lastModifiedJubelio: Date | null;
  trackingNumber: string | null;
  courier: string | null;
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  pickedAt: Date | null;
  pickedById: string | null;
  pickedByName: string | null;
  packedAt: Date | null;
  packedById: string | null;
  packedByName: string | null;
  shippedAt: Date | null;
  shippedById: string | null;
  shippedByName: string | null;
  courierId: number | null;
  courierName: string | null;
  shipmentJubelioId: number | null;
  revenueJournalId: string | null;
  cogsJournalId: string | null;
};

export type SalesOrderItemRow = {
  id: string;
  salesorderDetailId: number;
  jubelioItemId: number;
  jubelioItemCode: string;
  itemId: string | null;
  productName: string;
  qty: string;
  qtyInBase: string;
  returnedQty: string;
  isCanceledItem: boolean;
  unitPrice: string;
  pricePaid: string;
  discAmount: string;
  taxAmount: string;
  lineTotal: string;
  discMarketplace: string;
  weightInGram: string;
};

function buildWhere(f: SalesOrderListFilter) {
  const where: Record<string, unknown> = {};
  if (f.channel) where.channel = f.channel;
  if (f.status) where.status = f.status;
  if (f.dateFrom || f.dateTo) {
    where.transactionDate = {
      ...(f.dateFrom ? { gte: f.dateFrom } : {}),
      ...(f.dateTo ? { lte: f.dateTo } : {}),
    };
  }
  if (f.search && f.search.trim().length > 0) {
    const s = f.search.trim();
    where.OR = [
      { salesorderNo: { contains: s } },
      { customerName: { contains: s } },
    ];
  }
  return where;
}

export async function listSalesOrders(
  filter: SalesOrderListFilter,
  pagination: Pagination,
): Promise<{ orders: SalesOrderListRow[]; totalCount: number }> {
  const where = buildWhere(filter);
  const [rows, totalCount] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      orderBy: { transactionDate: "desc" },
      select: {
        id: true,
        salesorderNo: true,
        channel: true,
        status: true,
        customerName: true,
        grandTotal: true,
        transactionDate: true,
      },
    }),
    prisma.salesOrder.count({ where }),
  ]);

  const orders: SalesOrderListRow[] = rows.map((r) => ({
    id: r.id,
    salesorderNo: r.salesorderNo,
    channel: r.channel as SalesChannel,
    status: r.status as SalesOrderStatus,
    customerName: r.customerName,
    grandTotal: r.grandTotal.toString(),
    transactionDate: r.transactionDate,
  }));

  return { orders, totalCount };
}

export async function getSalesOrderById(
  id: string,
): Promise<{ order: SalesOrderDetail; items: SalesOrderItemRow[] } | null> {
  const row = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!row) return null;

  const userIds = [row.pickedById, row.packedById, row.shippedById].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const distinctUserIds = Array.from(new Set(userIds));

  const [users, courier] = await Promise.all([
    distinctUserIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: distinctUserIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string | null }>),
    row.courierId !== null && row.courierId !== undefined
      ? prisma.jubelioCourier.findUnique({ where: { id: row.courierId } })
      : Promise.resolve(null),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name ?? null]));

  const journals = await prisma.journal.findMany({
    where: { sourceType: { in: ["SALESORDER_REVENUE", "SALESORDER_COGS"] }, sourceId: row.id },
    select: { id: true, sourceType: true },
  });
  const revenueJournalId = journals.find((j) => j.sourceType === "SALESORDER_REVENUE")?.id ?? null;
  const cogsJournalId = journals.find((j) => j.sourceType === "SALESORDER_COGS")?.id ?? null;

  const order: SalesOrderDetail = {
    id: row.id,
    salesorderId: row.salesorderId,
    salesorderNo: row.salesorderNo,
    channel: row.channel as SalesChannel,
    sourceName: row.sourceName,
    status: row.status as SalesOrderStatus,
    channelStatus: row.channelStatus,
    internalStatus: row.internalStatus,
    wmsStatus: row.wmsStatus,
    isCanceled: row.isCanceled,
    isPaid: row.isPaid,
    markedAsComplete: row.markedAsComplete,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    shippingProvince: row.shippingProvince,
    shippingCity: row.shippingCity,
    shippingAddress: row.shippingAddress as Record<string, string | null> | null,
    subTotal: row.subTotal.toString(),
    totalDisc: row.totalDisc.toString(),
    totalTax: row.totalTax.toString(),
    shippingCost: row.shippingCost.toString(),
    grandTotal: row.grandTotal.toString(),
    feeBreakdown: row.feeBreakdown as Record<string, string> | null,
    paymentMethod: row.paymentMethod,
    paymentDate: row.paymentDate,
    transactionDate: row.transactionDate,
    createdDateJubelio: row.createdDateJubelio,
    completedDate: row.completedDate,
    cancelDate: row.cancelDate,
    lastModifiedJubelio: row.lastModifiedJubelio,
    trackingNumber: row.trackingNumber,
    courier: row.courier,
    fulfillmentStatus: row.fulfillmentStatus as SalesOrderFulfillmentStatus,
    pickedAt: row.pickedAt,
    pickedById: row.pickedById,
    pickedByName: row.pickedById ? nameById.get(row.pickedById) ?? null : null,
    packedAt: row.packedAt,
    packedById: row.packedById,
    packedByName: row.packedById ? nameById.get(row.packedById) ?? null : null,
    shippedAt: row.shippedAt,
    shippedById: row.shippedById,
    shippedByName: row.shippedById ? nameById.get(row.shippedById) ?? null : null,
    courierId: row.courierId,
    courierName: courier?.name ?? null,
    shipmentJubelioId: row.shipmentJubelioId,
    revenueJournalId,
    cogsJournalId,
  };

  const items: SalesOrderItemRow[] = row.items.map((it: any) => ({
    id: it.id,
    salesorderDetailId: it.salesorderDetailId,
    jubelioItemId: it.jubelioItemId,
    jubelioItemCode: it.jubelioItemCode,
    itemId: it.itemId,
    productName: it.productName,
    qty: it.qty.toString(),
    qtyInBase: it.qtyInBase.toString(),
    returnedQty: it.returnedQty.toString(),
    isCanceledItem: it.isCanceledItem,
    unitPrice: it.unitPrice.toString(),
    pricePaid: it.pricePaid.toString(),
    discAmount: it.discAmount.toString(),
    taxAmount: it.taxAmount.toString(),
    lineTotal: it.lineTotal.toString(),
    discMarketplace: it.discMarketplace.toString(),
    weightInGram: it.weightInGram.toString(),
  }));

  return { order, items };
}

export type MarketplaceKpi = {
  pendingFulfillmentCount: number;
  todaySalesCount: number;
  todaySalesTotal: string;
};

export type SalesOrdersListKpi = {
  totalCount: number;
  totalValue: string;
  byChannel: Array<{ channel: SalesChannel; count: number; totalValue: string }>;
  byStatus: Array<{ status: SalesOrderStatus; count: number }>;
  averageDailySales: string;
  averageDailyCount: number;
  dayCount: number;
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Inclusive calendar-day span in Asia/Jakarta between two instants. */
export function inclusiveWibDayCount(from: Date, to: Date): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [ay, am, ad] = fmt.format(from).split("-").map(Number);
  const [by, bm, bd] = fmt.format(to).split("-").map(Number);
  const start = Date.UTC(ay, am - 1, ad);
  const end = Date.UTC(by, bm - 1, bd);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export async function getMarketplaceKpi(): Promise<MarketplaceKpi> {
  const [pendingCount, todayAgg] = await Promise.all([
    prisma.salesOrder.count({
      where: { status: { in: ["NEW", "PROCESSING"] } },
    }),
    prisma.salesOrder.aggregate({
      where: {
        transactionDate: { gte: startOfToday(), lte: endOfToday() },
        status: { notIn: ["CANCELLED", "RETURNED"] },
      },
      _count: { _all: true },
      _sum: { grandTotal: true },
    }),
  ]);

  const sum = todayAgg._sum?.grandTotal;
  return {
    pendingFulfillmentCount: pendingCount,
    todaySalesCount: todayAgg._count._all,
    todaySalesTotal: sum ? sum.toString() : "0",
  };
}

/** KPI for the sales-orders list — respects the same filters as the table. */
export async function getSalesOrdersListKpi(
  filter: SalesOrderListFilter,
): Promise<SalesOrdersListKpi> {
  const where = buildWhere(filter);

  const [agg, byChannelRows, byStatusRows] = await Promise.all([
    prisma.salesOrder.aggregate({
      where,
      _count: { _all: true },
      _sum: { grandTotal: true },
      _min: { transactionDate: true },
      _max: { transactionDate: true },
    }),
    prisma.salesOrder.groupBy({
      by: ["channel"],
      where,
      _count: { _all: true },
      _sum: { grandTotal: true },
    }),
    prisma.salesOrder.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);

  const totalCount = agg._count._all;
  const totalValueNum = Number(agg._sum.grandTotal ?? 0);

  const rangeStart = filter.dateFrom ?? agg._min.transactionDate;
  const rangeEnd = filter.dateTo ?? agg._max.transactionDate;
  const dayCount =
    rangeStart && rangeEnd ? inclusiveWibDayCount(rangeStart, rangeEnd) : 1;
  const averageDailySales = totalCount === 0 ? 0 : totalValueNum / dayCount;
  const averageDailyCount = totalCount === 0 ? 0 : totalCount / dayCount;

  const byChannel = byChannelRows
    .map((r) => ({
      channel: r.channel as SalesChannel,
      count: r._count._all,
      totalValue: String(Number(r._sum.grandTotal ?? 0)),
    }))
    .sort((a, b) => b.count - a.count);

  const byStatus = byStatusRows
    .map((r) => ({
      status: r.status as SalesOrderStatus,
      count: r._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalCount,
    totalValue: String(totalValueNum),
    byChannel,
    byStatus,
    averageDailySales: String(averageDailySales),
    averageDailyCount,
    dayCount,
  };
}
