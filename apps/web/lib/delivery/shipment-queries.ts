import { penerimaPod, type PenerimaPod } from "@/lib/spg/kiriman";
import { prisma, type DeliveryShipmentStatus } from "@elorae/db";
import { SHIPMENT_STATUS_LABEL_KEY, type ShipmentStatusLabelKey } from "@/lib/delivery/shipment-status-display";
import { urlFromKey } from "@/lib/r2";
import { isR2KeyInFolder } from "@/lib/r2-key";

/* Compile-time pin: a Prisma `DeliveryShipmentStatus` member missing from the client-safe display maps is a type error here. */
const SHIPMENT_STATUS_COVERS_PRISMA: Record<DeliveryShipmentStatus, ShipmentStatusLabelKey> = SHIPMENT_STATUS_LABEL_KEY;
void SHIPMENT_STATUS_COVERS_PRISMA;

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
    /** The putus nota issued with the shipment; null for konsi and for a shipment of the old rule. */
    deliveryId: string | null;
    shippedAt: Date | null;
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
      deliveryId: row.deliveryId,
      shippedAt: row.shippedAt,
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
  storePaymentTempo: number;
  orderNo: string;
  deliveryId: string | null;
  /** Kg, recorded before an expedition shipment leaves (P35). */
  weightKg: number | null;
  /** The handover-to-courier photo (showing the weight) is on file (P43). */
  adaFotoSerah: boolean;
  shippedAt: Date | null;
  /**
   * Who records the store's receipt (`penerimaPod`, the writer's own rule): `SPG` — the store has an
   * SPG now, the POD is the handover only; `PEMEGANG` — its SPG stopped while these goods were on
   * the road, the holder salesman records the PIC's receipt (P45a), and the POD becomes the receipt
   * only when it records a door refusal; `KURIR` — the POD is the store's receipt.
   */
  penerimaPod: PenerimaPod;
  /** The store's receipt of this shipment's document exists (`StoreReceipt`). */
  sudahDiterimaToko: boolean;
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
      order: { include: { store: { select: { name: true, lat: true, lng: true, checkinRadiusMeters: true, paymentTempo: true } } } },
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!row) return null;

  const orderLines = await prisma.fieldSalesOrderLine.findMany({
    where: { id: { in: row.lines.map((l) => l.orderLineId) } },
    select: { id: true, productName: true },
  });
  const productNameByOrderLineId = new Map(orderLines.map((l) => [l.id, l.productName]));
  const transfer = await prisma.konsiTransfer.findUnique({ where: { shipmentId: row.id }, select: { id: true } });
  const sumber = transfer
    ? { sourceType: "KONSI_TRANSFER", sourceId: transfer.id }
    : row.deliveryId
      ? { sourceType: "PUTUS_DELIVERY", sourceId: row.deliveryId }
      : null;
  const [penerima, diterima] = await Promise.all([
    penerimaPod(prisma, row.order.storeId, row.createdAt),
    sumber ? prisma.storeReceipt.findUnique({ where: { sourceType_sourceId: sumber }, select: { id: true } }) : null,
  ]);

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
    storePaymentTempo: row.order.store.paymentTempo,
    orderNo: row.order.orderNo,
    deliveryId: row.deliveryId,
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    adaFotoSerah: Boolean(row.handoverPhotoR2Key && row.handoverPhotoUrl),
    shippedAt: row.shippedAt,
    penerimaPod: penerima,
    sudahDiterimaToko: diterima !== null,
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
  /** Kg recorded before an expedition shipment leaves (P35). */
  weightKg: number | null;
  /** The handover-to-courier photo showing the weight (P43), bound to `delivery-handover/<id>`. */
  handoverPhoto: ShipmentProofPhoto;
  /** "Tidak jadi dikirim" reason. */
  cancelReason: string | null;
  /** The putus nota of this shipment, cancelled or corrected (R22); null for konsi and old-rule shipments. */
  nota: { invoiceDate: Date; dueDate: Date; voidedAt: Date | null; voidReason: string | null; correctedAt: Date | null } | null;
  konsiTransferStatus: "IN_TRANSIT" | "RECEIVED" | "CANCELLED" | null;
  /** The store's receipt of this shipment's document (`StoreReceipt`) — the "store received" marker (R9). */
  penerimaan: { receivedAt: Date; receivedVia: string | null; receiverName: string | null; picName: string | null } | null;
  lines: Array<{
    id: string;
    productName: string;
    variantSku: string;
    plannedQty: number;
    deliveredQty: number | null;
    /** Refused at the door / lost in transit, recorded by the POD at a store without an SPG. */
    returnedQty: number | null;
    lostQty: number | null;
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
 * `include`d: under `relationMode = "prisma"` the shipment's user columns have no FK behind them,
 * and an `include` of a dangling REQUIRED relation throws instead of returning null. The order's
 * `storeId` does carry a real FK, so a missing store is defensive only. A missing user renders as
 * null; a missing order or store returns null overall (same `NOT_FOUND` reading the writer uses).
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
      ? prisma.fieldSalesDelivery.findUnique({
          where: { id: row.deliveryId },
          select: { docNo: true, invoiceDate: true, dueDate: true, voidedAt: true, voidReason: true, correctedAt: true },
        })
      : Promise.resolve(null),
    prisma.konsiTransfer.findUnique({ where: { shipmentId: row.id }, select: { id: true, docNo: true, status: true } }),
  ]);
  const sumber = konsiTransfer
    ? { sourceType: "KONSI_TRANSFER", sourceId: konsiTransfer.id }
    : row.deliveryId
      ? { sourceType: "PUTUS_DELIVERY", sourceId: row.deliveryId }
      : null;
  const terima = sumber
    ? await prisma.storeReceipt.findUnique({
        where: { sourceType_sourceId: sumber },
        select: { receivedAt: true, receivedVia: true, receivedById: true, picName: true },
      })
    : null;
  const penerima = terima?.receivedById
    ? await prisma.user.findUnique({ where: { id: terima.receivedById }, select: { name: true, email: true } })
    : null;
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
    /* The nota carries the dates since it is issued at creation; the shipment columns are legacy. */
    invoiceDate: delivery?.invoiceDate ?? row.invoiceDate,
    dueDate: delivery?.dueDate ?? row.dueDate,
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
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    handoverPhoto: deriveProofPhoto(row.handoverPhotoR2Key, row.handoverPhotoUrl, `delivery-handover/${row.id}`),
    cancelReason: row.cancelReason,
    nota: delivery
      ? {
          invoiceDate: delivery.invoiceDate,
          dueDate: delivery.dueDate,
          voidedAt: delivery.voidedAt,
          voidReason: delivery.voidReason,
          correctedAt: delivery.correctedAt,
        }
      : null,
    konsiTransferStatus: konsiTransfer?.status ?? null,
    penerimaan: terima
      ? {
          receivedAt: terima.receivedAt,
          receivedVia: terima.receivedVia,
          receiverName: penerima ? penerima.name || penerima.email : null,
          picName: terima.picName,
        }
      : null,
    lines: row.lines.map((line) => ({
      id: line.id,
      productName: productNameByOrderLineId.get(line.orderLineId) ?? "",
      variantSku: line.variantSku,
      plannedQty: line.plannedQty,
      deliveredQty: line.deliveredQty,
      returnedQty: line.returnedQty,
      lostQty: line.lostQty,
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
