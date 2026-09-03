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

    const orderLineById = new Map(order.lines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      const orderLine = orderLineById.get(line.orderLineId);
      if (!orderLine) throw new DeliveryShipmentError("NOT_FOUND");
      const remaining = orderLine.qty - orderLine.deliveredQty - orderLine.cancelledQty;
      if (line.qty > remaining) throw new DeliveryShipmentError("OVER_PLANNED");
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
