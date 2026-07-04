import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  markOrderPicked,
  markOrderPacked,
  markOrderShipped,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";

type MockPrisma = {
  $transaction: (cb: (tx: MockPrisma) => Promise<unknown>) => Promise<unknown>;
  salesOrder: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  jubelioOutbox: {
    create: ReturnType<typeof vi.fn>;
  };
  stockReservation: {
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

function makePrismaMock(orderRow: Record<string, unknown> | null): MockPrisma {
  const inner: MockPrisma = {
    $transaction: (cb) => cb(inner),
    salesOrder: {
      findUnique: vi.fn().mockResolvedValue(orderRow),
      update: vi.fn().mockResolvedValue({}),
    },
    jubelioOutbox: {
      create: vi.fn().mockResolvedValue({ id: "ob1" }),
    },
    // consumeOrder (invoked by markOrderShipped) sweeps reservations; no reserved
    // rows in these unit tests, so findMany returns [] and the consume loop is a no-op.
    stockReservation: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return inner;
}

const baseOrder = {
  id: "so1",
  salesorderId: 23043,
  status: "NEW",
  fulfillmentStatus: "PENDING",
};

describe("markOrderPicked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions PENDING -> PICKED, updates audit columns, enqueues outbox", async () => {
    const prisma = makePrismaMock(baseOrder);
    await markOrderPicked(prisma as any, { orderId: "so1", userId: "u1" });

    const updateArgs = prisma.salesOrder.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "so1" });
    expect(updateArgs.data.fulfillmentStatus).toBe("PICKED");
    expect(updateArgs.data.pickedById).toBe("u1");
    expect(updateArgs.data.pickedAt).toBeInstanceOf(Date);

    const outboxArgs = prisma.jubelioOutbox.create.mock.calls[0][0];
    expect(outboxArgs.data.entityType).toBe("salesorder_pick");
    expect(outboxArgs.data.entityId).toBe("so1");
    expect(outboxArgs.data.payload).toEqual({
      salesOrderId: "so1",
      jubelioSalesorderId: 23043,
    });
    expect(outboxArgs.data.enqueuedById).toBe("u1");
  });

  it("throws InvalidFulfillmentTransition when order already PICKED", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PICKED" });
    await expect(markOrderPicked(prisma as any, { orderId: "so1", userId: "u1" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
    expect(prisma.salesOrder.update).not.toHaveBeenCalled();
    expect(prisma.jubelioOutbox.create).not.toHaveBeenCalled();
  });

  it("throws when sub-A status is CANCELLED", async () => {
    const prisma = makePrismaMock({ ...baseOrder, status: "CANCELLED" });
    await expect(markOrderPicked(prisma as any, { orderId: "so1", userId: "u1" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
  });

  it("throws when order does not exist", async () => {
    const prisma = makePrismaMock(null);
    await expect(markOrderPicked(prisma as any, { orderId: "missing", userId: "u1" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
  });
});

describe("markOrderPacked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions PICKED -> PACKED, enqueues outbox", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PICKED" });
    await markOrderPacked(prisma as any, { orderId: "so1", userId: "u2" });

    expect(prisma.salesOrder.update.mock.calls[0][0].data.fulfillmentStatus).toBe("PACKED");
    expect(prisma.jubelioOutbox.create.mock.calls[0][0].data.entityType).toBe("salesorder_pack");
  });

  it("throws when called on PENDING (skipping the PICKED step)", async () => {
    const prisma = makePrismaMock(baseOrder);
    await expect(markOrderPacked(prisma as any, { orderId: "so1", userId: "u2" })).rejects.toBeInstanceOf(
      InvalidFulfillmentTransition,
    );
  });
});

describe("markOrderShipped", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions PACKED -> SHIPPED, writes courierId, enqueues outbox with courierId in payload", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PACKED" });
    await markOrderShipped(prisma as any, { orderId: "so1", userId: "u3", courierId: 4 });

    const updateData = prisma.salesOrder.update.mock.calls[0][0].data;
    expect(updateData.fulfillmentStatus).toBe("SHIPPED");
    expect(updateData.courierId).toBe(4);
    expect(updateData.shippedById).toBe("u3");

    const payload = prisma.jubelioOutbox.create.mock.calls[0][0].data.payload;
    expect(payload).toEqual({
      salesOrderId: "so1",
      jubelioSalesorderId: 23043,
      courierId: 4,
    });
  });

  it("throws when called on PICKED (must be PACKED first)", async () => {
    const prisma = makePrismaMock({ ...baseOrder, fulfillmentStatus: "PICKED" });
    await expect(
      markOrderShipped(prisma as any, { orderId: "so1", userId: "u3", courierId: 4 }),
    ).rejects.toBeInstanceOf(InvalidFulfillmentTransition);
  });
});
