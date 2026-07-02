import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { consumeOrder } from "./reservation-writer";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export class InvalidFulfillmentTransition extends Error {
  readonly code = "INVALID_FULFILLMENT_TRANSITION";
  constructor(message: string) {
    super(message);
    this.name = "InvalidFulfillmentTransition";
  }
}

type MarkOpts = { orderId: string; userId: string };
type MarkShipOpts = MarkOpts & { courierId: number };

function assertNotCancelled(status: string, orderId: string): void {
  if (status === "CANCELLED" || status === "RETURNED") {
    throw new InvalidFulfillmentTransition(
      `Order ${orderId} status is ${status} — fulfillment blocked`,
    );
  }
}

export async function markOrderPicked(prisma: AnyClient, opts: MarkOpts): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: opts.orderId } });
    if (!order) {
      throw new InvalidFulfillmentTransition(`Order ${opts.orderId} not found`);
    }
    assertNotCancelled(order.status, opts.orderId);
    if (order.fulfillmentStatus !== "PENDING") {
      throw new InvalidFulfillmentTransition(
        `Order ${opts.orderId} fulfillmentStatus is ${order.fulfillmentStatus}, expected PENDING`,
      );
    }
    await tx.salesOrder.update({
      where: { id: opts.orderId },
      data: {
        fulfillmentStatus: "PICKED",
        pickedAt: new Date(),
        pickedById: opts.userId,
      },
    });
    await tx.jubelioOutbox.create({
      data: {
        entityType: "salesorder_pick",
        entityId: opts.orderId,
        payload: { salesOrderId: opts.orderId, jubelioSalesorderId: order.salesorderId } as Prisma.InputJsonValue,
        enqueuedById: opts.userId,
      },
    });
  });
}

export async function markOrderPacked(prisma: AnyClient, opts: MarkOpts): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: opts.orderId } });
    if (!order) {
      throw new InvalidFulfillmentTransition(`Order ${opts.orderId} not found`);
    }
    assertNotCancelled(order.status, opts.orderId);
    if (order.fulfillmentStatus !== "PICKED") {
      throw new InvalidFulfillmentTransition(
        `Order ${opts.orderId} fulfillmentStatus is ${order.fulfillmentStatus}, expected PICKED`,
      );
    }
    await tx.salesOrder.update({
      where: { id: opts.orderId },
      data: {
        fulfillmentStatus: "PACKED",
        packedAt: new Date(),
        packedById: opts.userId,
      },
    });
    await tx.jubelioOutbox.create({
      data: {
        entityType: "salesorder_pack",
        entityId: opts.orderId,
        payload: { salesOrderId: opts.orderId, jubelioSalesorderId: order.salesorderId } as Prisma.InputJsonValue,
        enqueuedById: opts.userId,
      },
    });
  });
}

export async function markOrderShipped(prisma: AnyClient, opts: MarkShipOpts): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id: opts.orderId } });
    if (!order) {
      throw new InvalidFulfillmentTransition(`Order ${opts.orderId} not found`);
    }
    assertNotCancelled(order.status, opts.orderId);
    if (order.fulfillmentStatus !== "PACKED") {
      throw new InvalidFulfillmentTransition(
        `Order ${opts.orderId} fulfillmentStatus is ${order.fulfillmentStatus}, expected PACKED`,
      );
    }
    await tx.salesOrder.update({
      where: { id: opts.orderId },
      data: {
        fulfillmentStatus: "SHIPPED",
        shippedAt: new Date(),
        shippedById: opts.userId,
        courierId: opts.courierId,
      },
    });
    await tx.jubelioOutbox.create({
      data: {
        entityType: "salesorder_ship",
        entityId: opts.orderId,
        payload: {
          salesOrderId: opts.orderId,
          jubelioSalesorderId: order.salesorderId,
          courierId: opts.courierId,
        } as Prisma.InputJsonValue,
        enqueuedById: opts.userId,
      },
    });
    await consumeOrder(tx, { salesorderId: order.salesorderId, salesorderNo: order.salesorderNo });
  });
}
