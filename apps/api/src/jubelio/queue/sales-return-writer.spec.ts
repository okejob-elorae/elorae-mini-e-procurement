import { acceptReturnItem, rejectReturnItem, submitReturnDecision } from "@elorae/db";

describe("sales-return-writer", () => {
  function createTx(overrides: Partial<any> = {}): any {
    return {
      salesReturnItem: { findUnique: jest.fn(), update: jest.fn() },
      salesReturn: { findUnique: jest.fn(), update: jest.fn() },
      stockAdjustment: { create: jest.fn() },
      inventoryValue: {
        findFirst: jest.fn(),
        update: jest.fn(),
        /* moveMainStock's pinned path: a guarded updateMany, a re-read, then the ledger append. */
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ qtyOnHand: "12.00" }),
      },
      stockLedgerEntry: { create: jest.fn() },
      stockReservation: { findUnique: jest.fn() },
      jubelioProductMapping: { findFirst: jest.fn(), findMany: jest.fn() },
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

  describe("acceptReturnItem against the order's reservation", () => {
    function pendingLine(extra: Record<string, unknown> = {}) {
      return {
        id: "ri1",
        salesReturnId: "r1",
        itemId: null,
        variantSku: null,
        salesOrderDetailId: 555,
        qty: "2.00",
        decision: "PENDING",
        salesReturn: { pushOutboxRowId: null, jubelioReturnNo: "RET-1" },
        ...extra,
      };
    }

    it("accepts with no stock change when the line's reservation was released, even with no resolved item", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine());
      tx.stockReservation.findUnique.mockResolvedValue({ itemId: "i1", variantSku: "V-M", state: "RELEASED", qty: "2" });
      tx.salesReturnItem.update.mockResolvedValue({});

      const result = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "Came back", changedById: "u1" });

      expect(result).toEqual({ applied: true, stockAdjustmentId: null, noStockReason: "NOT_CONSUMED" });
      expect(tx.stockReservation.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { salesorderDetailId: 555 } }));
      expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
      expect(tx.inventoryValue.findFirst).not.toHaveBeenCalled();
      const data = tx.salesReturnItem.update.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ decision: "ACCEPTED", decidedById: "u1" }));
      expect(data.stockAdjustmentId).toBeUndefined();
      expect(data.itemReason).toBeUndefined();
    });

    it("refuses order_not_settled while the line's reservation is still RESERVED, writing nothing", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine());
      tx.stockReservation.findUnique.mockResolvedValue({ itemId: "i1", variantSku: "V-M", state: "RESERVED", qty: "2" });

      const result = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "Came back", changedById: "u1" });

      expect(result).toEqual({ applied: false, skipped: "order_not_settled" });
      expect(tx.salesReturnItem.update).not.toHaveBeenCalled();
      expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
    });

    it("restores a CONSUMED line onto the reservation's own item and variant, not the line's", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine({ itemId: "stale-item", variantSku: "V-M" }));
      tx.stockReservation.findUnique.mockResolvedValue({ itemId: "i1", variantSku: "V-M", state: "CONSUMED", qty: "2" });
      tx.jubelioProductMapping.findFirst.mockResolvedValue({ id: "m1" });
      tx.inventoryValue.findFirst.mockResolvedValue({ id: "iv1", qtyOnHand: "10.00", avgCost: "100.00" });
      tx.stockAdjustment.create.mockResolvedValue({ id: "sa1" });
      tx.salesReturnItem.update.mockResolvedValue({});

      const result = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "Came back", changedById: "u1" });

      expect(result).toEqual({ applied: true, stockAdjustmentId: "sa1" });
      expect(tx.jubelioProductMapping.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { itemId: "i1", erpVariantSku: "V-M" },
      }));
      expect(tx.inventoryValue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { itemId: "i1", variantSku: "V-M" },
      }));
      expect(tx.stockAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ itemId: "i1", qtyChange: 2, source: "ERP_RETURN_ACCEPT" }),
      }));
    });

    it("restores a CONSUMED line whose reserved row is no longer mapped onto the one item the variant moved to", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine());
      tx.stockReservation.findUnique.mockResolvedValue({ itemId: "old-item", variantSku: "V-M", state: "CONSUMED", qty: "2" });
      tx.jubelioProductMapping.findFirst.mockResolvedValue(null);
      tx.jubelioProductMapping.findMany.mockResolvedValue([{ itemId: "twin" }]);
      tx.inventoryValue.findFirst.mockResolvedValue({ id: "iv-twin", qtyOnHand: "5.00", avgCost: "80.00" });
      tx.stockAdjustment.create.mockResolvedValue({ id: "sa2" });
      tx.salesReturnItem.update.mockResolvedValue({});

      const result = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "Came back", changedById: "u1" });

      expect(result).toEqual({ applied: true, stockAdjustmentId: "sa2" });
      expect(tx.jubelioProductMapping.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { erpVariantSku: "V-M", itemId: { not: "old-item" } },
      }));
      expect(tx.inventoryValue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { itemId: "twin", variantSku: "V-M" },
      }));
      expect(tx.stockAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ itemId: "twin", qtyChange: 2 }),
      }));
    });

    it.each([
      ["no other item maps the variant", []],
      ["more than one other item maps it", [{ itemId: "a" }, { itemId: "b" }]],
    ])("refuses no_inventory_row for an unmapped consumed row when %s, writing nothing", async (_label, moved) => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine());
      tx.stockReservation.findUnique.mockResolvedValue({ itemId: "old-item", variantSku: "V-M", state: "CONSUMED", qty: "2" });
      tx.jubelioProductMapping.findFirst.mockResolvedValue(null);
      tx.jubelioProductMapping.findMany.mockResolvedValue(moved);

      const result = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "Came back", changedById: "u1" });

      expect(result).toEqual({ applied: false, skipped: "no_inventory_row" });
      expect(tx.salesReturnItem.update).not.toHaveBeenCalled();
      expect(tx.stockAdjustment.create).not.toHaveBeenCalled();
    });

    it("caps the restore at the reserved qty when the return line claims more", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine({ qty: "5.00" }));
      tx.stockReservation.findUnique.mockResolvedValue({ itemId: "i1", variantSku: "V-M", state: "CONSUMED", qty: "2" });
      tx.jubelioProductMapping.findFirst.mockResolvedValue({ id: "m1" });
      tx.inventoryValue.findFirst.mockResolvedValue({ id: "iv1", qtyOnHand: "10.00", avgCost: "100.00" });
      tx.stockAdjustment.create.mockResolvedValue({ id: "sa3" });
      tx.salesReturnItem.update.mockResolvedValue({});

      await acceptReturnItem(tx, { returnItemId: "ri1", reason: "Came back", changedById: "u1" });

      expect(tx.stockAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ qtyChange: 2, newQty: 12 }),
      }));
    });

    it("keeps the item-based path when the line has no reservation: an unresolved item is still unmapped_sku", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine());
      tx.stockReservation.findUnique.mockResolvedValue(null);

      const result = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "Came back", changedById: "u1" });

      expect(result).toEqual({ applied: false, skipped: "unmapped_sku" });
      expect(tx.salesReturnItem.update).not.toHaveBeenCalled();
    });

    it("still refuses already_decided before consulting any reservation", async () => {
      const tx = createTx();
      tx.salesReturnItem.findUnique.mockResolvedValue(pendingLine({ decision: "ACCEPTED" }));

      const result = await acceptReturnItem(tx, { returnItemId: "ri1", reason: "x", changedById: "u1" });

      expect(result).toEqual({ applied: false, skipped: "already_decided" });
      expect(tx.stockReservation.findUnique).not.toHaveBeenCalled();
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
