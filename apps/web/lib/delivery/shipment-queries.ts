import { prisma } from "@elorae/db";

export async function listDeliveryShipments(input: {
  status?: "PACKED" | "IN_TRANSIT" | "DELIVERED" | "PARTIALLY_DELIVERED" | "CANCELLED";
  method?: "EXPEDITION" | "SALESMAN_CARRY";
  storeId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}): Promise<{
  items: Array<{
    id: string;
    docNo: string;
    status: string;
    method: string;
    storeName: string;
    orderNo: string;
    carrierName: string | null;
    resiNumber: string | null;
    packedAt: Date;
  }>;
  total: number;
}> {
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.method ? { method: input.method } : {}),
    ...(input.storeId ? { order: { storeId: input.storeId } } : {}),
    ...(input.dateFrom || input.dateTo
      ? {
          packedAt: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.deliveryShipment.findMany({
      where,
      include: { order: { include: { store: { select: { name: true } } } } },
      orderBy: { packedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.deliveryShipment.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      docNo: row.docNo,
      status: row.status,
      method: row.method,
      storeName: row.order.store.name,
      orderNo: row.order.orderNo,
      carrierName: row.carrierName,
      resiNumber: row.resiNumber,
      packedAt: row.packedAt,
    })),
    total,
  };
}

export async function getDeliveryShipment(id: string): Promise<{
  id: string;
  docNo: string;
  status: string;
  method: string;
  carrierName: string | null;
  resiNumber: string | null;
  carriedById: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  proofPhotoUrl: string | null;
  orderId: string;
  storeName: string;
  storeLat: number | null;
  storeLng: number | null;
  storeCheckinRadiusMeters: number | null;
  orderNo: string;
  deliveryId: string | null;
  lines: Array<{
    id: string;
    orderLineId: string;
    itemId: string;
    variantSku: string;
    productName: string;
    plannedQty: number;
    deliveredQty: number | null;
  }>;
} | null> {
  const row = await prisma.deliveryShipment.findUnique({
    where: { id },
    include: {
      order: { include: { store: { select: { name: true, lat: true, lng: true, checkinRadiusMeters: true } } } },
      lines: { include: { } },
    },
  });
  if (!row) return null;

  const orderLines = await prisma.fieldSalesOrderLine.findMany({
    where: { id: { in: row.lines.map((l) => l.orderLineId) } },
    select: { id: true, productName: true },
  });
  const productNameByOrderLineId = new Map(orderLines.map((l) => [l.id, l.productName]));

  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status,
    method: row.method,
    carrierName: row.carrierName,
    resiNumber: row.resiNumber,
    carriedById: row.carriedById,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    proofPhotoUrl: row.proofPhotoUrl,
    orderId: row.orderId,
    storeName: row.order.store.name,
    storeLat: row.order.store.lat ? row.order.store.lat.toNumber() : null,
    storeLng: row.order.store.lng ? row.order.store.lng.toNumber() : null,
    storeCheckinRadiusMeters: row.order.store.checkinRadiusMeters,
    orderNo: row.order.orderNo,
    deliveryId: row.deliveryId,
    lines: row.lines.map((line) => ({
      id: line.id,
      orderLineId: line.orderLineId,
      itemId: line.itemId,
      variantSku: line.variantSku,
      productName: productNameByOrderLineId.get(line.orderLineId) ?? "",
      plannedQty: line.plannedQty,
      deliveredQty: line.deliveredQty,
    })),
  };
}

export async function listMyDeliveries(carriedById: string): Promise<Array<{
  id: string;
  docNo: string;
  storeName: string;
  orderNo: string;
  plannedTotalQty: number;
}>> {
  const rows = await prisma.deliveryShipment.findMany({
    where: { carriedById, status: "IN_TRANSIT" },
    include: { order: { include: { store: { select: { name: true } } } }, lines: true },
    orderBy: { shippedAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    docNo: row.docNo,
    storeName: row.order.store.name,
    orderNo: row.order.orderNo,
    plannedTotalQty: row.lines.reduce((sum, l) => sum + l.plannedQty, 0),
  }));
}
