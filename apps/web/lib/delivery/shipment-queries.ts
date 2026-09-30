import { prisma } from "@elorae/db";
import { urlFromKey } from "@/lib/r2";
import { isR2KeyInFolder } from "@/lib/r2-key";

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
    orderType: "PUTUS" | "KONSI";
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
      orderType: row.order.orderType,
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
  orderType: "PUTUS" | "KONSI";
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
    orderType: row.order.orderType,
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

export type ShipmentProofPhoto = {
  url: string | null;
  /** A photo is on file but cannot be shown: its key fails the shape bind, or only a legacy stored URL exists. */
  unavailable: boolean;
};

export type DeliveryShipmentDetail = {
  id: string;
  docNo: string;
  status: string;
  method: string;
  orderType: "PUTUS" | "KONSI";
  orderId: string;
  orderNo: string;
  storeName: string;
  storeLat: number | null;
  storeLng: number | null;
  storeCheckinRadiusMeters: number | null;
  carrierName: string | null;
  resiNumber: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  packedAt: Date;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedOfflineAt: Date | null;
  packedByName: string | null;
  shippedByName: string | null;
  carriedByName: string | null;
  deliveredByName: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsDistanceMeters: number | null;
  signedByName: string | null;
  accountingDocNo: string | null;
  konsiTransferDocNo: string | null;
  goodsPhoto: ShipmentProofPhoto;
  notaPhoto: ShipmentProofPhoto;
  lines: Array<{
    id: string;
    productName: string;
    variantSku: string;
    plannedQty: number;
    deliveredQty: number | null;
  }>;
};

/**
 * Photo display URL derived from the stored R2 KEY, never from `proofPhotoUrl`/`signatureUrl`:
 * those columns are caller-supplied at completion and were never validated, so rendering them
 * would show whatever a raw caller wrote. The key is bound to this shipment's folder at
 * completion, so it is re-checked here (rows written before the bind may fail it) and the URL
 * is rebuilt from it. A stored URL with no key at all is a legacy row: reported as unavailable
 * instead of silently trusted or silently dropped.
 */
export function deriveProofPhoto(
  key: string | null,
  storedUrl: string | null,
  folder: string,
): ShipmentProofPhoto {
  if (key) {
    return isR2KeyInFolder(key, folder)
      ? { url: urlFromKey(key), unavailable: false }
      : { url: null, unavailable: true };
  }
  return { url: null, unavailable: !!storedUrl };
}

/**
 * Read-only audit view of one shipment. Users and the store are looked up by id rather than
 * `include`d: under `relationMode = "prisma"` there is no FK behind them, and an `include` of a
 * dangling REQUIRED relation throws instead of returning null. A missing user renders as null; a
 * missing order or store returns null overall (same `NOT_FOUND` reading the writer uses).
 */
export async function getDeliveryShipmentDetail(id: string): Promise<DeliveryShipmentDetail | null> {
  const row = await prisma.deliveryShipment.findUnique({
    where: { id },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  if (!row) return null;

  const order = await prisma.fieldSalesOrder.findUnique({
    where: { id: row.orderId },
    select: { orderNo: true, orderType: true, storeId: true },
  });
  if (!order) return null;
  const store = await prisma.store.findUnique({
    where: { id: order.storeId },
    select: { name: true, lat: true, lng: true, checkinRadiusMeters: true },
  });
  if (!store) return null;

  const userIds = [row.packedById, row.shippedById, row.carriedById, row.deliveredById].filter(
    (v): v is string => !!v,
  );
  const [users, orderLines, delivery, konsiTransfer] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    }),
    prisma.fieldSalesOrderLine.findMany({
      where: { id: { in: row.lines.map((l) => l.orderLineId) } },
      select: { id: true, productName: true },
    }),
    row.deliveryId
      ? prisma.fieldSalesDelivery.findUnique({ where: { id: row.deliveryId }, select: { docNo: true } })
      : Promise.resolve(null),
    prisma.konsiTransfer.findUnique({ where: { shipmentId: row.id }, select: { docNo: true } }),
  ]);
  const userNameById = new Map(users.map((u) => [u.id, u.name || u.email]));
  const nameOf = (userId: string | null): string | null => (userId ? userNameById.get(userId) ?? null : null);
  const productNameByOrderLineId = new Map(orderLines.map((l) => [l.id, l.productName]));

  const goodsFolder =
    row.method === "SALESMAN_CARRY" ? `delivery-pod-proofs/${row.id}` : `delivery-proofs/${row.id}`;

  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status,
    method: row.method,
    orderType: order.orderType,
    orderId: row.orderId,
    orderNo: order.orderNo,
    storeName: store.name,
    storeLat: store.lat ? store.lat.toNumber() : null,
    storeLng: store.lng ? store.lng.toNumber() : null,
    storeCheckinRadiusMeters: store.checkinRadiusMeters,
    carrierName: row.carrierName,
    resiNumber: row.resiNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    packedAt: row.packedAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    completedOfflineAt: row.completedOfflineAt,
    packedByName: nameOf(row.packedById),
    shippedByName: nameOf(row.shippedById),
    carriedByName: nameOf(row.carriedById),
    deliveredByName: nameOf(row.deliveredById),
    gpsLat: row.gpsLat ? row.gpsLat.toNumber() : null,
    gpsLng: row.gpsLng ? row.gpsLng.toNumber() : null,
    gpsDistanceMeters: row.gpsDistanceMeters,
    signedByName: row.signedByName,
    accountingDocNo: delivery?.docNo ?? null,
    konsiTransferDocNo: konsiTransfer?.docNo ?? null,
    goodsPhoto: deriveProofPhoto(row.proofPhotoR2Key, row.proofPhotoUrl, goodsFolder),
    notaPhoto: deriveProofPhoto(
      row.signatureR2Key,
      row.signatureUrl,
      `delivery-pod-proofs/${row.id}`,
    ),
    lines: row.lines.map((line) => ({
      id: line.id,
      productName: productNameByOrderLineId.get(line.orderLineId) ?? "",
      variantSku: line.variantSku,
      plannedQty: line.plannedQty,
      deliveredQty: line.deliveredQty,
    })),
  };
}

export type OrderShipmentSummary = {
  id: string;
  docNo: string;
  status: "PACKED" | "IN_TRANSIT" | "DELIVERED" | "PARTIALLY_DELIVERED" | "CANCELLED";
  method: "EXPEDITION" | "SALESMAN_CARRY";
  packedAt: Date;
  carrierName: string | null;
  resiNumber: string | null;
  lines: Array<{ id: string; orderLineId: string; productName: string; variantSku: string; plannedQty: number; deliveredQty: number | null }>;
};

export async function listShipmentsForOrder(orderId: string): Promise<OrderShipmentSummary[]> {
  const rows = await prisma.deliveryShipment.findMany({
    where: { orderId },
    orderBy: { packedAt: "desc" },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  if (rows.length === 0) return [];
  const orderLines = await prisma.fieldSalesOrderLine.findMany({
    where: { orderId },
    select: { id: true, productName: true },
  });
  const productNameById = new Map(orderLines.map((l) => [l.id, l.productName]));
  return rows.map((row) => ({
    id: row.id,
    docNo: row.docNo,
    status: row.status,
    method: row.method,
    packedAt: row.packedAt,
    carrierName: row.carrierName,
    resiNumber: row.resiNumber,
    lines: row.lines.map((line) => ({
      id: line.id,
      orderLineId: line.orderLineId,
      productName: productNameById.get(line.orderLineId) ?? "",
      variantSku: line.variantSku,
      plannedQty: line.plannedQty,
      deliveredQty: line.deliveredQty,
    })),
  }));
}

export async function listMyDeliveries(carriedById: string): Promise<Array<{
  id: string;
  docNo: string;
  storeName: string;
  orderNo: string;
  plannedTotalQty: number;
}>> {
  const rows = await prisma.deliveryShipment.findMany({
    where: { carriedById, status: "IN_TRANSIT", method: "SALESMAN_CARRY" },
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
