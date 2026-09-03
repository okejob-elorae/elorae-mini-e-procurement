import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
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
