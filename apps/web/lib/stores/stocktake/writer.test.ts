import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createStoreStocktake, saveStocktakeCounts, approveStoreStocktake, cancelStoreStocktake } from "./writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("store stocktake writer (test bed only)", () => {
  const tag = `STKW-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let adminId = "";
  let itemMainId = "";
  let itemNegativeId = "";
  let itemZeroId = "";
  let itemAddedId = "";
  let bogusItemId = "";
  let itemIds: string[] = [];
  let storeId = "";
  let stocktakeIds: string[] = [];
  let stkCounter = 0;

  const docNo = () => `STK/${tag}/${++stkCounter}`;

  type LineSeed = {
    itemId: string;
    variantSku?: string;
    productName?: string;
    expectedQty: number;
    countedQty: number | null;
    reason?: string;
    cause?: "SHRINKAGE" | "UNRECORDED_SALE";
    isAdded?: boolean;
  };

  const mkStocktake = async (opts: { status?: "DRAFT" | "PENDING_VERIFICATION"; openKey?: string | null; lines: LineSeed[] }) => {
    const st = await prisma.storeStocktake.create({
      data: {
        docNo: docNo(),
        storeId,
        status: opts.status ?? "DRAFT",
        openKey: opts.openKey === undefined ? storeId : opts.openKey,
        countedAt: new Date(),
        createdById: adminId,
        lines: {
          create: opts.lines.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku ?? "",
            productName: l.productName ?? "Test line",
            expectedQty: l.expectedQty,
            countedQty: l.countedQty,
            reason: l.reason ?? null,
            cause: l.cause ?? null,
            isAdded: l.isAdded ?? false,
          })),
        },
      },
      select: { id: true },
    });
    stocktakeIds.push(st.id);
    return st.id;
  };

  beforeEach(async () => {
    uomId = "";
    adminId = "";
    itemMainId = "";
    itemNegativeId = "";
    itemZeroId = "";
    itemAddedId = "";
    bogusItemId = "";
    itemIds = [];
    storeId = "";
    stocktakeIds = [];
    stkCounter = 0;

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    adminId = admin.id;

    const itemMain = await prisma.item.create({ data: { sku: `${tag}-MAIN`, nameId: "Main", nameEn: "Main", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemMainId = itemMain.id;
    const itemNegative = await prisma.item.create({ data: { sku: `${tag}-NEG`, nameId: "Neg", nameEn: "Neg", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemNegativeId = itemNegative.id;
    const itemZero = await prisma.item.create({ data: { sku: `${tag}-ZERO`, nameId: "Zero", nameEn: "Zero", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemZeroId = itemZero.id;
    const itemAdded = await prisma.item.create({ data: { sku: `${tag}-ADD`, nameId: "Added", nameEn: "Added", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 } });
    itemAddedId = itemAdded.id;
    bogusItemId = `${tag}-bogus-item-id`;
    itemIds = [itemMainId, itemNegativeId, itemZeroId, itemAddedId, bogusItemId];

    const store = await prisma.store.create({ data: { code: `${tag}-STORE`, name: "Test Stocktake Writer Store", address: "Jl. Test", termsType: "KONSI", isActive: true } });
    storeId = store.id;

    /*
     * Fresh StoreStock rows every test (beforeEach runs per-test, not per-suite) — itemMain at
     * 10 with a real avgCost, itemNegative already driven negative (the correction-path row),
     * itemZero at zero (the other row this feature exists to make countable). itemAdded
     * deliberately has NO row — an item the store's ledger has never held.
     */
    await prisma.storeStock.create({ data: { storeId, itemId: itemMainId, variantSku: "", qty: 10, avgCost: 12500 } });
    await prisma.storeStock.create({ data: { storeId, itemId: itemNegativeId, variantSku: "", qty: -4, avgCost: 0 } });
    await prisma.storeStock.create({ data: { storeId, itemId: itemZeroId, variantSku: "", qty: 0, avgCost: 8000 } });
  });

  afterEach(async () => {
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: { in: stocktakeIds } } });
    await prisma.storeStocktake.deleteMany({ where: { id: { in: stocktakeIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId), itemId: { in: itemIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemMainId), seededId(itemNegativeId), seededId(itemZeroId), seededId(itemAddedId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("writes StoreStock.qty = countedQty for a counted line", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(6);
  });

  it("writes nothing for a line whose countedQty is null", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(10);
  });

  it("clears a NEGATIVE row when it is counted at zero — the correction path", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemNegativeId, variantSku: "", productName: "Neg", expectedQty: -4, countedQty: 0, reason: "physical count" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemNegativeId) } });
    expect(Number(ss.qty)).toBe(0);
  });

  it("includes a ZERO row as a countable line", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(ss.qty)).toBe(3);
  });

  it("creates a StoreStock row at avgCost 0 for an added line with no existing row", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemAddedId, variantSku: "", productName: "Added", expectedQty: 0, countedQty: 5, reason: "found on shelf", isAdded: true }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemAddedId) } });
    expect(Number(ss.qty)).toBe(5);
    expect(Number(ss.avgCost)).toBe(0);
  });

  it("leaves avgCost untouched on both a shortfall and a surplus line", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const main = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    const zero = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(main.avgCost)).toBe(12500);
    expect(Number(zero.avgCost)).toBe(8000);
  });

  it("returns VARIANCE_NEEDS_REASON for a non-zero variance with no reason, and writes nothing", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6 }],
    });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "VARIANCE_NEEDS_REASON" });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(10);
  });

  it("returns SHORTFALL_NEEDS_CAUSE for a negative variance with a reason but no cause", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount" }],
    });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "SHORTFALL_NEEDS_CAUSE" });
  });

  it("accepts a positive variance with a reason and no cause", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" }],
    });
    const res = await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    expect(res.ok).toBe(true);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(ss.qty)).toBe(3);
  });

  it("never refuses an unbalanced count — net variance need not cancel to zero", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" },
      ],
    });
    const res = await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    expect(res.ok).toBe(true);
    const main = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    const zero = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemZeroId) } });
    expect(Number(main.qty)).toBe(6);
    expect(Number(zero.qty)).toBe(3);
  });

  it("computes varianceQty as counted MINUS expected — a shortfall is negative", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 7, reason: "recount", cause: "SHRINKAGE" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.varianceQty)).toBe(-3);
  });

  it("writes the \"\"-keyed row for a variantless line, without forking a second row", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const rows = await prisma.storeStock.findMany({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].variantSku).toBe("");
    expect(Number(rows[0].qty)).toBe(6);
  });

  it("stamps qtyAtApproval from the live row when the ledger drifted after the snapshot, and still writes the counted figure", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" }],
    });
    // Simulate a konsi transfer landing after the count was taken but before approval.
    await prisma.storeStock.update({ where: { storeId_itemId_variantSku: { storeId, itemId: itemMainId, variantSku: "" } }, data: { qty: 15 } });

    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });

    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(storeId), itemId: seededId(itemMainId) } });
    expect(Number(ss.qty)).toBe(6);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: seededId(id) } });
    expect(Number(line.qtyAtApproval)).toBe(15);
    expect(Number(line.appliedQty)).toBe(6);
  });

  it("isFullCount is false when any line is left uncounted", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: null },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.isFullCount).toBe(false);
  });

  it("isFullCount is true only when every line carried a count", async () => {
    const id = await mkStocktake({
      lines: [
        { itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" },
        { itemId: itemZeroId, variantSku: "", productName: "Zero", expectedQty: 0, countedQty: 3, reason: "found stock" },
      ],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.isFullCount).toBe(true);
  });

  it("stamps openKey null on approval, and a second stocktake can then be opened for the store", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 10 }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(st.openKey).toBeNull();
    expect(st.status).toBe("APPROVED");

    const second = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
    stocktakeIds.push(second.id);
    expect(second.docNo).toMatch(/^STK\//);
  });

  it("writes no StockAdjustment and no InventoryValue row", async () => {
    await prisma.inventoryValue.create({ data: { itemId: itemMainId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 500, totalValue: 50000 } });
    const adjCountBefore = await prisma.stockAdjustment.count({ where: { itemId: itemMainId } });

    const id = await mkStocktake({
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 6, reason: "recount", cause: "SHRINKAGE" }],
    });

    const invBefore = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: itemMainId } });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    const invAfter = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: itemMainId } });

    expect(Number(invAfter.qtyOnHand)).toBe(Number(invBefore.qtyOnHand));
    expect(await prisma.stockAdjustment.count({ where: { itemId: itemMainId } })).toBe(adjCountBefore);
  });

  it("returns ITEM_NOT_FOUND for a dangling itemId and writes nothing", async () => {
    const id = await mkStocktake({
      lines: [{ itemId: bogusItemId, variantSku: "", productName: "Ghost", expectedQty: 0, countedQty: 0 }],
    });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    const rows = await prisma.storeStock.findMany({ where: { storeId: seededId(storeId), itemId: seededId(bogusItemId) } });
    expect(rows).toHaveLength(0);
  });

  it("refuses INVALID_STATE when the document is not DRAFT or PENDING_VERIFICATION", async () => {
    const id = await mkStocktake({
      status: "PENDING_VERIFICATION",
      lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: 10 }],
    });
    await approveStoreStocktake({ stocktakeId: id, approvedById: adminId });
    await expect(approveStoreStocktake({ stocktakeId: id, approvedById: adminId })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  describe("createStoreStocktake", () => {
    it("opens a document snapshotting every StoreStock row, with countedQty null on every line", async () => {
      const res = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
      stocktakeIds.push(res.id);
      expect(res.docNo).toMatch(/^STK\//);
      const lines = await prisma.storeStocktakeLine.findMany({ where: { stocktakeId: res.id } });
      expect(lines).toHaveLength(3); // itemMain, itemNegative, itemZero
      expect(lines.every((l) => l.countedQty === null)).toBe(true);
    });

    it("refuses ALREADY_OPEN when the store already has an open document", async () => {
      const first = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
      stocktakeIds.push(first.id);
      await expect(createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
    });
  });

  describe("saveStocktakeCounts", () => {
    it("writes countedQty and the computed varianceQty on the targeted line", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id } });
      const res = await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: 6, cause: "SHRINKAGE", reason: "recount" }], submit: false, userId: adminId });
      expect(res.ok).toBe(true);
      expect(res.status).toBe("DRAFT");
      const updated = await prisma.storeStocktakeLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(Number(updated.countedQty)).toBe(6);
      expect(Number(updated.varianceQty)).toBe(-4);
    });

    it("moves DRAFT to PENDING_VERIFICATION when submit is true", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: id } });
      const res = await saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: line.id, countedQty: 6 }], submit: true, userId: adminId });
      expect(res.status).toBe("PENDING_VERIFICATION");
      const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(st.status).toBe("PENDING_VERIFICATION");
      expect(st.submittedById).toBe(adminId);
    });

    it("returns INVALID_REQUEST for a lineId that does not belong to the document", async () => {
      const id = await mkStocktake({
        lines: [{ itemId: itemMainId, variantSku: "", productName: "Main", expectedQty: 10, countedQty: null }],
      });
      await expect(saveStocktakeCounts({ stocktakeId: id, lines: [{ lineId: "not-a-real-line-id", countedQty: 6 }], submit: false, userId: adminId })).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    });
  });

  describe("cancelStoreStocktake", () => {
    it("requires a non-empty reason", async () => {
      const id = await mkStocktake({ lines: [] });
      await expect(cancelStoreStocktake({ stocktakeId: id, cancelledById: adminId, reason: "" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    });

    it("nulls openKey and stamps CANCELLED so the store can be counted again", async () => {
      const id = await mkStocktake({ lines: [] });
      await cancelStoreStocktake({ stocktakeId: id, cancelledById: adminId, reason: "abandoned count" });
      const st = await prisma.storeStocktake.findUniqueOrThrow({ where: { id: seededId(id) } });
      expect(st.status).toBe("CANCELLED");
      expect(st.openKey).toBeNull();
      expect(st.cancelReason).toBe("abandoned count");

      const second = await createStoreStocktake({ storeId, createdById: adminId, countedAt: new Date() });
      stocktakeIds.push(second.id);
      expect(second.id).toBeTruthy();
    });
  });
});
