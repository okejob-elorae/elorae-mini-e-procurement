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

    /**
     * Quantity already claimed by OTHER still-open shipments on the same order line.
     * `orderLine.deliveredQty` only moves at COMPLETION, so without this two shipments packed
     * back to back against one line each see the full remaining figure and both pass — the second
     * to complete then dies inside `recordFieldSalesDelivery` with OVER_DELIVER, after the goods
     * have physically left. PACKED and IN_TRANSIT are exactly the statuses holding an unconsumed
     * claim: DELIVERED/PARTIALLY_DELIVERED already moved `deliveredQty`, and CANCELLED holds
     * nothing. Scoped by `orderId` rather than filtering on the line relation, which keeps this a
     * plain query on one table under `relationMode = "prisma"`.
     */
    const openShipments = await tx.deliveryShipment.findMany({
      where: { orderId: input.orderId, status: { in: ["PACKED", "IN_TRANSIT"] } },
      select: { lines: { select: { orderLineId: true, plannedQty: true } } },
    });
    const inFlightByOrderLineId = new Map<string, number>();
    for (const openShipment of openShipments) {
      for (const openLine of openShipment.lines) {
        const current = inFlightByOrderLineId.get(openLine.orderLineId) ?? 0;
        inFlightByOrderLineId.set(openLine.orderLineId, current + openLine.plannedQty);
      }
    }

    /* Validate aggregate quantities against remaining */
    for (const [orderLineId, totalQty] of qtyByOrderLineId) {
      const orderLine = orderLineById.get(orderLineId);
      if (!orderLine) throw new DeliveryShipmentError("NOT_FOUND");
      const inFlight = inFlightByOrderLineId.get(orderLineId) ?? 0;
      const remaining = orderLine.qty - orderLine.deliveredQty - orderLine.cancelledQty - inFlight;
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
  carriedById?: string;
  invoiceDate?: Date;
  dueDate?: Date;
}): Promise<{ ok: true }> {
  const result = await prisma.deliveryShipment.updateMany({
    where: { id: input.shipmentId, status: "PACKED" },
    data: {
      ...(input.carrierName !== undefined ? { carrierName: input.carrierName } : {}),
      ...(input.resiNumber !== undefined ? { resiNumber: input.resiNumber } : {}),
      ...(input.carriedById !== undefined ? { carriedById: input.carriedById } : {}),
      ...(input.invoiceDate !== undefined ? { invoiceDate: input.invoiceDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
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

  /**
   * The payload must name EVERY line on the shipment EXACTLY once. Both halves are load-bearing
   * and neither is enforced anywhere else, because this call is terminal — there is no state left
   * to correct from afterwards:
   *
   * - a DUPLICATE `shipmentLineId` would pass the per-entry OVER_PLANNED check below twice while
   *   `recordFieldSalesDelivery` aggregates by `orderLineId` internally and consumes/invoices the
   *   SUM, permanently desyncing this shipment's own `deliveredQty` from the accounting record;
   * - a MISSING entry would leave that line's `deliveredQty` null forever while `anyShort` — which
   *   only sees `input.lines` — still reads "nothing short" and moves the shipment to DELIVERED, a
   *   terminal status that can neither be completed nor cancelled again.
   *
   * Same aggregate-then-validate stance `createDeliveryShipment` takes on duplicate
   * `orderLineId`s, made stricter here for the reason above.
   */
  const seenLineIds = new Set<string>();
  for (const line of input.lines) {
    const shipmentLine = lineById.get(line.shipmentLineId);
    if (!shipmentLine) throw new DeliveryShipmentError("NOT_FOUND");
    if (seenLineIds.has(line.shipmentLineId)) throw new DeliveryShipmentError("LINE_MISMATCH");
    seenLineIds.add(line.shipmentLineId);
    if (line.deliveredQty > shipmentLine.plannedQty) throw new DeliveryShipmentError("OVER_PLANNED");
  }
  if (seenLineIds.size !== shipment.lines.length) throw new DeliveryShipmentError("LINE_MISMATCH");

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
