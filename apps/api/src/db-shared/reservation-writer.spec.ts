import { consumeOrder, releaseOrder, reserveOrder } from "../../../../packages/db/src/reservation-writer";
import { InventoryValueMissingError } from "../../../../packages/db/src/stock-writer";

function makeTx(overrides: any = {}) {
  return {
    stockReservation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "r1" }),
      ...overrides.stockReservation,
    },
    /*
     * reserveOrder resolves its row through barisStokPesanan: an exact (itemId, variantSku) row by
     * findUnique, a count of the item's per-variant rows, then the pooled null/"" rows by findMany.
     */
    inventoryValue: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([{ id: "iv1", avgCost: "0", variantSku: "" }]),
      update: jest.fn().mockResolvedValue({ qtyOnHand: "10", reservedQty: "3" }),
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
    expect(tx.inventoryValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemId: "i1", OR: [{ variantSku: null }, { variantSku: "" }] } }),
    );
    expect(tx.stockReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salesorderDetailId: 5,
          state: "RESERVED",
          qty: 3,
          variantSku: "",
          inventoryValueId: "iv1",
        }),
      }),
    );
    expect(tx.inventoryValue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "iv1" },
        data: expect.objectContaining({ reservedQty: { increment: 3 } }),
      }),
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
        update: jest.fn().mockResolvedValue({ qtyOnHand: "2", reservedQty: "3" }),
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
      inventoryValue: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    });
    await expect(
      reserveOrder(tx, {
        salesorderId: 100,
        salesorderNo: "SO-100",
        lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: 3 }],
      }),
    ).rejects.toThrow(InventoryValueMissingError);
    expect(tx.stockReservation.create).not.toHaveBeenCalled();
  });

  it("reserves a variant line on its own (itemId, variantSku) row", async () => {
    const tx = makeTx({
      inventoryValue: { findUnique: jest.fn().mockResolvedValue({ id: "iv-red", avgCost: "0" }) },
    });
    await reserveOrder(tx, {
      salesorderId: 100,
      salesorderNo: "SO-100",
      lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "i1-RED", qty: 3 }],
    });
    expect(tx.inventoryValue.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemId_variantSku: { itemId: "i1", variantSku: "i1-RED" } } }),
    );
    expect(tx.inventoryValue.findMany).not.toHaveBeenCalled();
    expect(tx.stockReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ variantSku: "i1-RED", inventoryValueId: "iv-red" }) }),
    );
    expect(tx.inventoryValue.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "iv-red" } }));
  });

  it("falls back to the pooled row for a variant line when the item keeps no per-variant rows, keying the reservation on it", async () => {
    const tx = makeTx();
    await reserveOrder(tx, {
      salesorderId: 100,
      salesorderNo: "SO-100",
      lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "i1-RED", qty: 3 }],
    });
    expect(tx.stockReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ variantSku: "", inventoryValueId: "iv1" }) }),
    );
  });

  it("refuses a variant line with no row of its own when the item keeps per-variant rows", async () => {
    const tx = makeTx({ inventoryValue: { count: jest.fn().mockResolvedValue(2), update: jest.fn() } });
    await expect(
      reserveOrder(tx, {
        salesorderId: 100,
        salesorderNo: "SO-100",
        lines: [{ salesorderDetailId: 5, itemId: "i1", variantSku: "i1-RED", qty: 3 }],
      }),
    ).rejects.toThrow(InventoryValueMissingError);
    expect(tx.inventoryValue.findMany).not.toHaveBeenCalled();
    expect(tx.stockReservation.create).not.toHaveBeenCalled();
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
        findFirst: jest.fn().mockResolvedValue({ id: "iv1", qtyOnHand: "10", reservedQty: "3", avgCost: "2" }),
        update: jest.fn().mockResolvedValue({ qtyOnHand: "7" }),
      },
      stockAdjustment: { create: jest.fn().mockResolvedValue({ id: "a1" }) },
      // consumeOrder appends one ledger entry per consumed line via appendStockLedger, which
      // calls tx.stockLedgerEntry.create unconditionally — without this the real consume path
      // below throws on tx.stockLedgerEntry being undefined.
      stockLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
      // The fixture row carries salesorderDetailId, so consumeOrder also back-fills that line's
      // COGS. Pre-existing gap: this mock never declared salesOrderItem, so the call threw here
      // long before the ledger work — the ledger entry above just moved the throw one line later.
      salesOrderItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const r = await consumeOrder(tx, { salesorderId: 100, salesorderNo: "SO-100" });
    expect(r.consumed).toBe(1);
    expect(tx.stockReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: "JUBELIO", salesorderDetailId: 5, state: "RESERVED" }, data: expect.objectContaining({ state: "CONSUMED" }) }),
    );
    expect(tx.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "FULFILLMENT_CONSUME", newQty: 7, qtyChange: -3 }) }),
    );
    expect(tx.inventoryValue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "iv1" },
        data: expect.objectContaining({
          qtyOnHand: { decrement: 3 },
          reservedQty: { decrement: 3 },
          totalValue: { decrement: 6 },
        }),
      }),
    );
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ itemId: "i1", qty: -3, balanceQty: 7 }) }),
    );
  });

  it("throws InventoryValueMissingError when no InventoryValue row exists for the reservation", async () => {
    const tx: any = {
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "r1", salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: "3", state: "RESERVED" },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryValue: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      stockAdjustment: { create: jest.fn() },
    };
    await expect(consumeOrder(tx, { salesorderId: 100, salesorderNo: "SO-100" })).rejects.toThrow(
      InventoryValueMissingError,
    );
    expect(tx.inventoryValue.update).not.toHaveBeenCalled();
    expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it("is a no-op when the conditional update matches zero rows (already consumed)", async () => {
    const tx: any = {
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "r1", salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: "3", state: "RESERVED" },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      inventoryValue: { findFirst: jest.fn(), update: jest.fn() },
      stockAdjustment: { create: jest.fn() },
    };
    const r = await consumeOrder(tx, { salesorderId: 100, salesorderNo: "SO-100" });
    expect(r.consumed).toBe(0);
    expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
    expect(tx.inventoryValue.update).not.toHaveBeenCalled();
  });
});

describe("releaseOrder", () => {
  it("releases RESERVED lines: decrements reserved, leaves onHand untouched", async () => {
    const tx: any = {
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "r1", salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: "3", state: "RESERVED" },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryValue: {
        findFirst: jest.fn().mockResolvedValue({ id: "iv1", qtyOnHand: "10", reservedQty: "3" }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const r = await releaseOrder(tx, { salesorderId: 100 });
    expect(r.released).toBe(1);
    expect(tx.inventoryValue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "iv1" },
        data: expect.objectContaining({ reservedQty: { decrement: 3 } }),
      }),
    );
    // onHand must NOT be in the update payload
    const call = tx.inventoryValue.update.mock.calls[0][0];
    expect(call.data.qtyOnHand).toBeUndefined();
    expect(call.data.totalValue).toBeUndefined();
  });

  it("skips lines already CONSUMED (updateMany count 0)", async () => {
    const tx: any = {
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "r1", salesorderDetailId: 5, itemId: "i1", variantSku: "", qty: "3", state: "RESERVED" },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      inventoryValue: { findFirst: jest.fn(), update: jest.fn() },
    };
    const r = await releaseOrder(tx, { salesorderId: 100 });
    expect(r.released).toBe(0);
    expect(tx.inventoryValue.update).not.toHaveBeenCalled();
  });
});
