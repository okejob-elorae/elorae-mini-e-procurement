import { Prisma, applyJubelioStockAdjustment } from "@elorae/db";

type MockTx = {
  stockAdjustment: { create: jest.Mock };
  inventoryValue: { findUnique: jest.Mock; update: jest.Mock };
};

function buildPrismaMock() {
  const tx: MockTx = {
    stockAdjustment: { create: jest.fn() },
    inventoryValue: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (cb: (t: MockTx) => Promise<unknown>) => cb(tx)),
  };
  return { prisma, tx };
}

describe("applyJubelioStockAdjustment", () => {
  it("inserts StockAdjustment and updates InventoryValue on first apply", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.inventoryValue.findUnique.mockResolvedValue({ qtyOnHand: 10, avgCost: 100 });
    tx.stockAdjustment.create.mockResolvedValue({ id: "adj_1" });
    tx.inventoryValue.update.mockResolvedValue({});

    const result = await applyJubelioStockAdjustment(prisma as any, {
      itemId: "item_1",
      variantSku: "SKU-A",
      newQty: 5,
      idempotencyKey: "evt_1",
      externalRef: "JBLITEM-1",
      reason: "test",
    });

    expect(result).toEqual({ adjustmentId: "adj_1", skipped: false });
    expect(tx.stockAdjustment.create).toHaveBeenCalledTimes(1);
    const createArg = tx.stockAdjustment.create.mock.calls[0][0].data;
    expect(createArg.source).toBe("JUBELIO_WEBHOOK");
    expect(createArg.idempotencyKey).toBe("evt_1");
    expect(createArg.externalRef).toBe("JBLITEM-1");
    expect(Number(createArg.prevQty)).toBe(10);
    expect(Number(createArg.newQty)).toBe(5);
    expect(Number(createArg.qtyChange)).toBe(-5);
    expect(tx.inventoryValue.update).toHaveBeenCalledWith({
      where: { itemId_variantSku: { itemId: "item_1", variantSku: "SKU-A" } },
      data: { qtyOnHand: 5, totalValue: 500, lastUpdated: expect.any(Date) },
    });
  });

  it("returns skipped:true when idempotencyKey already used (P2002)", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.inventoryValue.findUnique.mockResolvedValue({ qtyOnHand: 10, avgCost: 100 });
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["idempotencyKey"] },
    });
    tx.stockAdjustment.create.mockRejectedValue(err);

    const result = await applyJubelioStockAdjustment(prisma as any, {
      itemId: "item_1",
      variantSku: "SKU-A",
      newQty: 5,
      idempotencyKey: "evt_1",
      externalRef: "JBLITEM-1",
      reason: "test",
    });

    expect(result).toEqual({ adjustmentId: null, skipped: true });
    expect(tx.inventoryValue.update).not.toHaveBeenCalled();
  });

  it("rethrows P2002 with unrelated target", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.inventoryValue.findUnique.mockResolvedValue({ qtyOnHand: 10, avgCost: 100 });
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["someOtherField"] },
    });
    tx.stockAdjustment.create.mockRejectedValue(err);

    await expect(
      applyJubelioStockAdjustment(prisma as any, {
        itemId: "item_1",
        variantSku: "SKU-A",
        newQty: 5,
        idempotencyKey: "evt_1",
        externalRef: "JBLITEM-1",
        reason: "test",
      }),
    ).rejects.toThrow();
  });

  it("throws when InventoryValue is missing", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.inventoryValue.findUnique.mockResolvedValue(null);

    await expect(
      applyJubelioStockAdjustment(prisma as any, {
        itemId: "item_1",
        variantSku: "SKU-A",
        newQty: 5,
        idempotencyKey: "evt_1",
        externalRef: "JBLITEM-1",
        reason: "test",
      }),
    ).rejects.toThrow(/InventoryValue not found/);
  });
});
