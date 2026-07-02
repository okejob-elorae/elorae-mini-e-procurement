import { markOrderShipped } from "../../../../packages/db/src/sales-order-fulfillment-writer";

describe("sales-order-fulfillment-writer", () => {
  describe("markOrderShipped", () => {
    it("consumes reservations when shipping", async () => {
      const inner: any = {
        salesOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: "o1",
            status: "PROCESSING",
            fulfillmentStatus: "PACKED",
            salesorderId: 100,
            salesorderNo: "SO-100",
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        jubelioOutbox: { create: jest.fn().mockResolvedValue({}) },
        stockReservation: {
          findMany: jest.fn().mockResolvedValue([
            { salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: "3", state: "RESERVED" },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryValue: {
          findUnique: jest.fn().mockResolvedValue({ qtyOnHand: "10", reservedQty: "3", avgCost: "2" }),
          update: jest.fn(),
        },
        stockAdjustment: { create: jest.fn().mockResolvedValue({ id: "a1" }) },
      };
      const prisma: any = { $transaction: (fn: any) => fn(inner) };
      await markOrderShipped(prisma, { orderId: "o1", userId: "u1", courierId: 7 });
      expect(inner.stockReservation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: "CONSUMED" }) }),
      );
    });
  });
});
