import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { recordFieldSalesDelivery } from "@/lib/field-sales/delivery/writer";
import { DeliveryShipmentError } from "./errors";

export async function createDeliveryShipment(input: {
  orderId: string;
  method: "EXPEDITION" | "SALESMAN_CARRY";
  lines: Array<{ orderLineId: string; qty: number }>;
  packedById: string;
}): Promise<{ shipmentId: string; docNo: string }> {
  if (input.lines.length === 0) throw new DeliveryShipmentError("NO_LINES");
  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new DeliveryShipmentError("INVALID_QTY");
    }
  }

  return runSerializable(async (tx) => {
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: { lines: true },
    });
    if (!order) throw new DeliveryShipmentError("NOT_FOUND");

    const packer = await tx.user.findUnique({
      where: { id: input.packedById },
      select: { id: true },
    });
    if (!packer) throw new DeliveryShipmentError("NOT_FOUND");

    const orderLineById = new Map(order.lines.map((l) => [l.id, l]));

    /* Aggregate qty by orderLineId to catch duplicate entries that together exceed remaining qty */
    const qtyByOrderLineId = new Map<string, number>();
    for (const line of input.lines) {
      const current = qtyByOrderLineId.get(line.orderLineId) ?? 0;
      qtyByOrderLineId.set(line.orderLineId, current + line.qty);
    }

    /* Validate aggregate quantities against remaining */
    for (const [orderLineId, totalQty] of qtyByOrderLineId) {
      const orderLine = orderLineById.get(orderLineId);
      if (!orderLine) throw new DeliveryShipmentError("NOT_FOUND");
      const remaining = orderLine.qty - orderLine.deliveredQty - orderLine.cancelledQty;
      if (totalQty > remaining) throw new DeliveryShipmentError("OVER_PLANNED");
    }

    const docNo = await generateDocNumber("DELIVERY", tx);
    const shipment = await tx.deliveryShipment.create({
      data: {
        docNo,
        orderId: input.orderId,
        method: input.method,
        packedById: input.packedById,
        lines: {
          create: input.lines.map((line) => {
            const orderLine = orderLineById.get(line.orderLineId)!;
            return {
              orderLineId: line.orderLineId,
              itemId: orderLine.itemId,
              variantSku: orderLine.variantSku,
              plannedQty: line.qty,
            };
          }),
        },
      },
    });

    return { shipmentId: shipment.id, docNo: shipment.docNo };
  });
}

export async function updateShipmentTracking(input: {
  shipmentId: string;
  carrierName?: string;
  resiNumber?: string;
}): Promise<{ ok: true }> {
  const result = await prisma.deliveryShipment.updateMany({
    where: { id: input.shipmentId, status: "PACKED" },
    data: {
      ...(input.carrierName !== undefined ? { carrierName: input.carrierName } : {}),
      ...(input.resiNumber !== undefined ? { resiNumber: input.resiNumber } : {}),
    },
  });
  if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");
  return { ok: true };
}

export async function shipDeliveryShipment(input: {
  shipmentId: string;
  shippedById: string;
}): Promise<{ ok: true }> {
  const shipment = await prisma.deliveryShipment.findUnique({ where: { id: input.shipmentId } });
  if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
  if (shipment.status !== "PACKED") throw new DeliveryShipmentError("INVALID_STATE");
  if (shipment.method === "EXPEDITION" && !shipment.resiNumber) {
    throw new DeliveryShipmentError("MISSING_RESI");
  }

  const result = await prisma.deliveryShipment.updateMany({
    where: { id: input.shipmentId, status: "PACKED" },
    data: { status: "IN_TRANSIT", shippedAt: new Date(), shippedById: input.shippedById },
  });
  if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");
  return { ok: true };
}

export async function completeDeliveryShipment(input: {
  shipmentId: string;
  deliveredById: string;
  proofPhotoUrl: string;
  proofPhotoR2Key: string;
  invoiceDate: Date;
  dueDate: Date;
  lines: Array<{ shipmentLineId: string; deliveredQty: number }>;
}): Promise<{ ok: true; deliveryId: string }> {
  if (input.lines.length === 0) throw new DeliveryShipmentError("NO_LINES");
  if (!input.proofPhotoUrl) throw new DeliveryShipmentError("MISSING_PROOF");
  for (const line of input.lines) {
    if (!Number.isInteger(line.deliveredQty) || line.deliveredQty < 0) {
      throw new DeliveryShipmentError("INVALID_QTY");
    }
  }

  const shipment = await prisma.deliveryShipment.findUnique({
    where: { id: input.shipmentId },
    include: { lines: true, order: { select: { orderType: true } } },
  });
  if (!shipment) throw new DeliveryShipmentError("NOT_FOUND");
  if (shipment.status !== "IN_TRANSIT") throw new DeliveryShipmentError("INVALID_STATE");

  const lineById = new Map(shipment.lines.map((l) => [l.id, l]));
  for (const line of input.lines) {
    const shipmentLine = lineById.get(line.shipmentLineId);
    if (!shipmentLine) throw new DeliveryShipmentError("NOT_FOUND");
    if (line.deliveredQty > shipmentLine.plannedQty) throw new DeliveryShipmentError("OVER_PLANNED");
  }

  const anyShort = input.lines.some((line) => {
    const shipmentLine = lineById.get(line.shipmentLineId)!;
    return line.deliveredQty < shipmentLine.plannedQty;
  });
  const nextStatus = anyShort ? "PARTIALLY_DELIVERED" : "DELIVERED";

  const isKonsi = shipment.order.orderType === "KONSI";
  let deliveryId = "";

  if (!isKonsi) {
    const deliveredLines = input.lines
      .filter((line) => line.deliveredQty > 0)
      .map((line) => {
        const shipmentLine = lineById.get(line.shipmentLineId)!;
        return { orderLineId: shipmentLine.orderLineId, qty: line.deliveredQty };
      });
    if (deliveredLines.length > 0) {
      const delivery = await recordFieldSalesDelivery({
        orderId: shipment.orderId,
        deliveredById: input.deliveredById,
        lines: deliveredLines,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        idempotencyKey: `shipment-${input.shipmentId}`,
      });
      deliveryId = delivery.deliveryId;
    }
  }

  await runSerializable(async (tx) => {
    const result = await tx.deliveryShipment.updateMany({
      where: { id: input.shipmentId, status: "IN_TRANSIT" },
      data: {
        status: nextStatus,
        deliveredAt: new Date(),
        deliveredById: input.deliveredById,
        proofPhotoUrl: input.proofPhotoUrl,
        proofPhotoR2Key: input.proofPhotoR2Key,
        ...(deliveryId ? { deliveryId } : {}),
      },
    });
    if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");

    for (const line of input.lines) {
      await tx.deliveryShipmentLine.update({
        where: { id: line.shipmentLineId },
        data: { deliveredQty: line.deliveredQty },
      });
    }
  });

  return { ok: true, deliveryId };
}

export async function cancelDeliveryShipment(input: {
  shipmentId: string;
  cancelledById: string;
}): Promise<{ ok: true }> {
  const result = await prisma.deliveryShipment.updateMany({
    where: { id: input.shipmentId, status: { in: ["PACKED", "IN_TRANSIT"] } },
    data: { status: "CANCELLED" },
  });
  if (result.count === 0) throw new DeliveryShipmentError("INVALID_STATE");
  return { ok: true };
}
