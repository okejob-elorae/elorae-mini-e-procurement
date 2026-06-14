import { recalcItemSellingPrice } from "@elorae/db";

describe("recalcItemSellingPrice", () => {
  function createTx(overrides: Partial<any> = {}): any {
    return {
      item: { findUnique: jest.fn(), update: jest.fn() },
      jubelioPushDefaults: { findFirst: jest.fn() },
      inventoryValue: { findUnique: jest.fn() },
      itemPriceChangeLog: { create: jest.fn() },
      jubelioProductMapping: { count: jest.fn() },
      jubelioOutbox: { create: jest.fn() },
      ...overrides,
    };
  }

  it("uses Item.targetMarginPercent when set, ignoring defaults", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1",
      type: "FINISHED_GOOD",
      source: "ERP",
      sellingPrice: 100,
      targetMarginPercent: 30,
      additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({
      defaultMarginPercent: 50, // should NOT be used
      defaultAdditionalCost: null,
    });
    tx.jubelioProductMapping.count.mockResolvedValue(0);
    tx.item.update.mockResolvedValue({});
    tx.itemPriceChangeLog.create.mockResolvedValue({});

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1",
      trigger: "FG_RECEIPT",
      newAvgCost: 200,
      fgReceiptId: "r1",
      changedById: "u1",
    });

    expect(result).toEqual(expect.objectContaining({
      applied: true,
      newSellingPrice: 260, // 200 * 1.30 + 0
    }));
    expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "i1" },
      data: { sellingPrice: 260 },
    }));
  });

  it("falls back to defaults.defaultMarginPercent when item margin is null", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FINISHED_GOOD", source: "ERP",
      sellingPrice: null, targetMarginPercent: null, additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({
      defaultMarginPercent: 25, defaultAdditionalCost: 5,
    });
    tx.jubelioProductMapping.count.mockResolvedValue(0);

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
    });

    expect(result).toEqual(expect.objectContaining({
      applied: true,
      newSellingPrice: 130, // 100 * 1.25 + 5
    }));
  });

  it("returns skipped:no_margin_configured when neither item nor defaults has margin", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FINISHED_GOOD", source: "ERP",
      sellingPrice: null, targetMarginPercent: null, additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({
      defaultMarginPercent: null, defaultAdditionalCost: null,
    });

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "MARGIN_CHANGE", changedById: "u1",
    });

    expect(result).toEqual({ applied: false, skipped: "no_margin_configured" });
    expect(tx.item.update).not.toHaveBeenCalled();
  });

  it("returns skipped:non_finished_good for raw material", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FABRIC", source: "ERP",
      sellingPrice: null, targetMarginPercent: 30, additionalCost: null,
    });

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
    });

    expect(result).toEqual({ applied: false, skipped: "non_finished_good" });
  });

  it("returns skipped:ingested_item when source is JUBELIO_INGEST", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FINISHED_GOOD", source: "JUBELIO_INGEST",
      sellingPrice: 99, targetMarginPercent: 30, additionalCost: null,
    });

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
    });

    expect(result).toEqual({ applied: false, skipped: "ingested_item" });
  });

  it("returns skipped:no_change when computed price equals current", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FINISHED_GOOD", source: "ERP",
      sellingPrice: 130, targetMarginPercent: 30, additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({
      defaultMarginPercent: null, defaultAdditionalCost: null,
    });
    // newAvgCost 100 * 1.30 = 130, equal to current sellingPrice

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 100, changedById: "u1",
    });

    expect(result).toEqual({ applied: false, skipped: "no_change" });
    expect(tx.itemPriceChangeLog.create).not.toHaveBeenCalled();
    expect(tx.jubelioOutbox.create).not.toHaveBeenCalled();
  });

  it("enqueues product_push outbox row when item has Jubelio mapping", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FINISHED_GOOD", source: "ERP",
      sellingPrice: 100, targetMarginPercent: 30, additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({});
    tx.jubelioProductMapping.count.mockResolvedValue(2);
    tx.jubelioOutbox.create.mockResolvedValue({ id: "ob1" });
    tx.itemPriceChangeLog.create.mockResolvedValue({});

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 200, fgReceiptId: "r1", changedById: "u1",
    });

    expect(tx.jubelioOutbox.create).toHaveBeenCalledWith({
      data: {
        entityType: "product_push",
        entityId: "i1",
        payload: {},
        enqueuedById: "u1",
      },
      select: { id: true },
    });
    expect(result).toEqual(expect.objectContaining({ applied: true, outboxRowId: "ob1" }));
  });

  it("does not enqueue outbox when no Jubelio mapping exists", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FINISHED_GOOD", source: "ERP",
      sellingPrice: 100, targetMarginPercent: 30, additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({});
    tx.jubelioProductMapping.count.mockResolvedValue(0);
    tx.itemPriceChangeLog.create.mockResolvedValue({});

    const result = await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 200, changedById: "u1",
    });

    expect(tx.jubelioOutbox.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ applied: true, outboxRowId: null }));
  });

  it("writes ItemPriceChangeLog with fgReceiptId for FG_RECEIPT trigger", async () => {
    const tx = createTx();
    tx.item.findUnique.mockResolvedValue({
      id: "i1", type: "FINISHED_GOOD", source: "ERP",
      sellingPrice: 100, targetMarginPercent: 30, additionalCost: null,
    });
    tx.jubelioPushDefaults.findFirst.mockResolvedValue({});
    tx.jubelioProductMapping.count.mockResolvedValue(0);

    await recalcItemSellingPrice(tx, {
      itemId: "i1", trigger: "FG_RECEIPT", newAvgCost: 200, fgReceiptId: "r1", changedById: "u1",
    });

    expect(tx.itemPriceChangeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "i1",
        oldSellingPrice: 100,
        newSellingPrice: 260,
        newAvgCost: 200,
        marginPercentUsed: 30,
        additionalCostUsed: 0,
        triggerReason: "FG_RECEIPT",
        fgReceiptId: "r1",
        changedById: "u1",
      }),
    });
  });
});
