import { acceptReturnItem, rejectReturnItem, submitReturnDecision } from "@elorae/db";

describe("sales-return-writer", () => {
  function createTx(overrides: Partial<any> = {}): any {
    return {
      salesReturnItem: { findUnique: jest.fn(), update: jest.fn() },
      salesReturn: { findUnique: jest.fn(), update: jest.fn() },
      stockAdjustment: { create: jest.fn() },
      inventoryValue: { findFirst: jest.fn(), update: jest.fn() },
      jubelioOutbox: { create: jest.fn() },
      ...overrides,
    };
  }

  describe("acceptReturnItem", () => {
    it("writes StockAdjustment + InventoryValue update + stamps decision", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue({
        id: "ri1",
        salesReturnId: "r1",
        itemId: "i1",
        variantSku: null,
        qty: "2.00",
        decision: "PENDING",
        salesReturn: { pushOutboxRowId: null },
      });
      tx.inventoryValue.findFirst.mockResolvedValue({
        id: "iv1",
        qtyOnHand: "10.00",
        avgCost: "100.00",
      });
      tx.stockAdjustment.create.mockResolvedValue({ id: "sa1" });
      tx.salesReturnItem.update.mockResolvedValue({});
      tx.inventoryValue.update.mockResolvedValue({});

      const result = await acceptReturnItem(tx, {
        returnItemId: "ri1",
        reason: "Customer return — undamaged",
        changedById: "u1",
      });

      expect(result).toEqual({ applied: true, stockAdjustmentId: "sa1" });
      expect(tx.stockAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          itemId: "i1",
          type: "POSITIVE",
          qtyChange: 2,
          source: "ERP_RETURN_ACCEPT",
          docNumber: "RET-ri1",
          idempotencyKey: "return-accept:ri1",
          externalRef: "ri1",
        }),
      }));
      expect(tx.salesReturnItem.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "ri1" },
        data: expect.objectContaining({
          decision: "ACCEPTED",
          decidedById: "u1",
          stockAdjustmentId: "sa1",
        }),
      }));
    });
  });

  describe("acceptReturnItem skip rules", () => {
    it("returns return_locked when parent has pushOutboxRowId set", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue({
        id: "ri1",
        decision: "PENDING",
        itemId: "i1",
        salesReturn: { pushOutboxRowId: "ob1" },
      });

      const r = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "x", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "return_locked" });
      expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
    });

    it("returns already_decided when item.decision !== PENDING", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue({
        id: "ri1",
        decision: "ACCEPTED",
        itemId: "i1",
        salesReturn: { pushOutboxRowId: null },
      });

      const r = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "x", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "already_decided" });
    });

    it("returns unmapped_sku when itemId is null", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue({
        id: "ri1",
        decision: "PENDING",
        itemId: null,
        salesReturn: { pushOutboxRowId: null },
      });

      const r = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "x", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "unmapped_sku" });
    });

    it("returns no_inventory_row when no matching InventoryValue", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue({
        id: "ri1",
        decision: "PENDING",
        itemId: "i1",
        variantSku: null,
        qty: "1.00",
        salesReturn: { pushOutboxRowId: null },
      });
      tx.inventoryValue.findFirst.mockResolvedValue(null);

      const r = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "x", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "no_inventory_row" });
    });
  });

  describe("rejectReturnItem", () => {
    it("stamps decision without stock side-effect", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue({
        id: "ri1",
        decision: "PENDING",
        salesReturn: { pushOutboxRowId: null },
      });
      tx.salesReturnItem.update.mockResolvedValue({});

      const r = await rejectReturnItem(tx, {
        returnItemId: "ri1",
        reason: "Item damaged in transit; not our fault",
        changedById: "u1",
      });

      expect(r).toEqual({ applied: true });
      expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
      expect(tx.salesReturnItem.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          decision: "REJECTED",
          decidedById: "u1",
          itemReason: "Item damaged in transit; not our fault",
        }),
      }));
    });

    it("returns return_locked once parent pushed", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue({
        id: "ri1",
        decision: "PENDING",
        salesReturn: { pushOutboxRowId: "ob1" },
      });

      const r = await rejectReturnItem(tx, { returnItemId: "ri1", reason: "x", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "return_locked" });
    });
  });

  describe("submitReturnDecision", () => {
    it("derives ACCEPTED when all items accepted and enqueues outbox row", async () => {
      const tx = createTx();
      tx.salesReturn.findUnique.mockResolvedValue({
        id: "r1",
        pushOutboxRowId: null,
        items: [{ decision: "ACCEPTED" }, { decision: "ACCEPTED" }],
      });
      tx.jubelioOutbox.create.mockResolvedValue({ id: "ob1" });
      tx.salesReturn.update.mockResolvedValue({});

      const r = await submitReturnDecision(tx, { salesReturnId: "r1", changedById: "u1" });
      expect(r).toEqual({ applied: true, status: "ACCEPTED", outboxRowId: "ob1" });
      expect(tx.jubelioOutbox.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          entityType: "salesreturn_decision_push",
          entityId: "r1",
        }),
      }));
    });

    it("derives REJECTED when all items rejected", async () => {
      const tx = createTx();
      tx.salesReturn.findUnique.mockResolvedValue({
        id: "r1",
        pushOutboxRowId: null,
        items: [{ decision: "REJECTED" }, { decision: "REJECTED" }],
      });
      tx.jubelioOutbox.create.mockResolvedValue({ id: "ob1" });

      const r = await submitReturnDecision(tx, { salesReturnId: "r1", changedById: "u1" });
      expect(r).toEqual({ applied: true, status: "REJECTED", outboxRowId: "ob1" });
    });

    it("derives PARTIAL on mixed", async () => {
      const tx = createTx();
      tx.salesReturn.findUnique.mockResolvedValue({
        id: "r1",
        pushOutboxRowId: null,
        items: [{ decision: "ACCEPTED" }, { decision: "REJECTED" }],
      });
      tx.jubelioOutbox.create.mockResolvedValue({ id: "ob1" });

      const r = await submitReturnDecision(tx, { salesReturnId: "r1", changedById: "u1" });
      expect(r).toEqual({ applied: true, status: "PARTIAL", outboxRowId: "ob1" });
    });

    it("returns items_still_pending when any item PENDING", async () => {
      const tx = createTx();
      tx.salesReturn.findUnique.mockResolvedValue({
        id: "r1",
        pushOutboxRowId: null,
        items: [{ decision: "ACCEPTED" }, { decision: "PENDING" }],
      });

      const r = await submitReturnDecision(tx, { salesReturnId: "r1", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "items_still_pending" });
      expect(tx.jubelioOutbox.create).not.toHaveBeenCalled();
    });

    it("returns already_submitted when pushOutboxRowId already set", async () => {
      const tx = createTx();
      tx.salesReturn.findUnique.mockResolvedValue({
        id: "r1",
        pushOutboxRowId: "ob-old",
        items: [{ decision: "ACCEPTED" }],
      });

      const r = await submitReturnDecision(tx, { salesReturnId: "r1", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "already_submitted" });
    });

    it("returns no_items when return has zero items", async () => {
      const tx = createTx();
      tx.salesReturn.findUnique.mockResolvedValue({
        id: "r1",
        pushOutboxRowId: null,
        items: [],
      });

      const r = await submitReturnDecision(tx, { salesReturnId: "r1", changedById: "u1" });
      expect(r).toEqual({ applied: false, skipped: "no_items" });
    });
  });
});
