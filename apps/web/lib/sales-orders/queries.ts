import { prisma } from "@elorae/db";
import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";

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
