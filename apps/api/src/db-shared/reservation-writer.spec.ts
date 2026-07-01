import { consumeOrder, reserveOrder } from "../../../../packages/db/src/reservation-writer";
import { InventoryValueMissingError } from "../../../../packages/db/src/stock-writer";

function makeTx(overrides: any = {}) {
  return {
    stockReservation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "r1" }),
      ...overrides.stockReservation,
    },
    inventoryValue: {
      findUnique: jest.fn().mockResolvedValue({ qtyOnHand: "10", reservedQty: "0" }),
      update: jest.fn().mockResolvedValue({}),
      ...overrides.inventoryValue,
    },
    adminNotification: { create: jest.fn().mockResolvedValue({}), ...overrides.adminNotification },
  } as any;
}

describe("reserveOrder", () => {
  it("reserves a new line and increments the aggregate", async () => {
    const tx = makeTx();
    const r = await reserveOrder(tx, {
      salesorderId: 100,
      salesorderNo: "SO-100",
      lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: 3 }],
    });
    expect(r.reserved).toBe(1);
    expect(r.skipped).toBe(0);
    expect(tx.stockReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ salesorderDetailId: 5, state: "RESERVED", qty: 3 }) }),
    );
    expect(tx.inventoryValue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reservedQty: 3 }) }),
    );
    expect(r.oversell).toHaveLength(0);
  });

  it("skips a line whose reservation already exists (idempotent)", async () => {
    const tx = makeTx({ stockReservation: { findUnique: jest.fn().mockResolvedValue({ id: "existing" }) } });
    const r = await reserveOrder(tx, {
      salesorderId: 100,
      salesorderNo: "SO-100",
      lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: 3 }],
    });
    expect(r.reserved).toBe(0);
    expect(r.skipped).toBe(1);
    expect(tx.stockReservation.create).not.toHaveBeenCalled();
    expect(tx.inventoryValue.update).not.toHaveBeenCalled();
  });

  it("emits an oversell alert + AdminNotification when reserved exceeds onHand", async () => {
    const tx = makeTx({
      inventoryValue: {
        findUnique: jest.fn().mockResolvedValue({ qtyOnHand: "2", reservedQty: "0" }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const r = await reserveOrder(tx, {
      salesorderId: 100,
      salesorderNo: "SO-100",
      lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: 3 }],
    });
    expect(r.oversell).toEqual([{ itemId: "i1", variantSku: "", available: -1 }]);
    expect(tx.adminNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: "STOCK_OVERSELL_RISK", severity: "WARN" }),
      }),
    );
  });

  it("throws InventoryValueMissingError when no InventoryValue row exists for the line", async () => {
    const tx = makeTx({
      inventoryValue: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      reserveOrder(tx, {
        salesorderId: 100,
        salesorderNo: "SO-100",
        lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: 3 }],
      }),
    ).rejects.toThrow(InventoryValueMissingError);
  });
});

describe("consumeOrder", () => {
  it("consumes RESERVED lines: deducts onHand + reserved, writes FULFILLMENT_CONSUME adjustment", async () => {
    const tx: any = {
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "r1", salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: "3", state: "RESERVED" },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryValue: {
        findUnique: jest.fn().mockResolvedValue({ qtyOnHand: "10", reservedQty: "3", avgCost: "2" }),
        update: jest.fn().mockResolvedValue({}),
      },
      stockAdjustment: { create: jest.fn().mockResolvedValue({ id: "a1" }) },
    };
    const r = await consumeOrder(tx, { salesorderId: 100, salesorderNo: "SO-100" });
    expect(r.consumed).toBe(1);
    expect(tx.stockReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salesorderDetailId: 5, state: "RESERVED" }, data: expect.objectContaining({ state: "CONSUMED" }) }),
    );
    expect(tx.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "FULFILLMENT_CONSUME", newQty: 7, qtyChange: -3 }) }),
    );
    expect(tx.inventoryValue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ qtyOnHand: 7, reservedQty: 0 }) }),
    );
  });

  it("is a no-op when the conditional update matches zero rows (already consumed)", async () => {
    const tx: any = {
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "r1", salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: "3", state: "RESERVED" },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      inventoryValue: { findUnique: jest.fn(), update: jest.fn() },
      stockAdjustment: { create: jest.fn() },
    };
    const r = await consumeOrder(tx, { salesorderId: 100, salesorderNo: "SO-100" });
    expect(r.consumed).toBe(0);
    expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
    expect(tx.inventoryValue.update).not.toHaveBeenCalled();
  });
});
