import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { buildStocktakeLines, previousApprovedCountedAt } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("store stocktake queries (test bed only)", () => {
  const tag = `STK-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let userId = "";
  let itemAId = "";
  let itemBId = "";
  let itemCId = "";
  let storeId = "";
  let freshStoreId = "";
  let quietStoreId = "";
  let stocktakeIds: string[] = [];
  let spgSaleIds: string[] = [];
  let storeStockIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    userId = "";
    itemAId = "";
    itemBId = "";
    itemCId = "";
    storeId = "";
    freshStoreId = "";
    quietStoreId = "";
    stocktakeIds = [];
    spgSaleIds = [];
    storeStockIds = [];

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const user = await prisma.user.create({ data: { email: `${tag}@example.com`.toLowerCase(), name: "Test Stocktake User" } });
    userId = user.id;

    const itemA = await prisma.item.create({
      data: { sku: `${tag}-A`, nameId: "Test Stocktake Item A", nameEn: "Item A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemAId = itemA.id;
    const itemB = await prisma.item.create({
      data: { sku: `${tag}-B`, nameId: "Test Stocktake Item B", nameEn: "Item B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemBId = itemB.id;
    const itemC = await prisma.item.create({
      data: { sku: `${tag}-C`, nameId: "Test Stocktake Item C", nameEn: "Item C", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemCId = itemC.id;

    const store = await prisma.store.create({
      data: { code: `${tag}-STORE`, name: "Test Stocktake Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    storeId = store.id;
    const fresh = await prisma.store.create({
      data: { code: `${tag}-FRESH`, name: "Test Stocktake Fresh Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    freshStoreId = fresh.id;
    const quiet = await prisma.store.create({
      data: { code: `${tag}-QUIET`, name: "Test Stocktake Quiet Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    quietStoreId = quiet.id;
  });

  afterEach(async () => {
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: { in: stocktakeIds } } });
    await prisma.storeStocktake.deleteMany({ where: { id: { in: stocktakeIds } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: spgSaleIds } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: spgSaleIds } } });
    await prisma.storeStock.deleteMany({ where: { id: { in: storeStockIds } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(freshStoreId), seededId(quietStoreId)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId), seededId(itemCId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("builds a line from EVERY StoreStock row including zero and negative", async () => {
    const rowHigh = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 10, avgCost: 0 } });
    const rowZero = await prisma.storeStock.create({ data: { storeId, itemId: itemBId, variantSku: "", qty: 0, avgCost: 0 } });
    const rowNegative = await prisma.storeStock.create({ data: { storeId, itemId: itemCId, variantSku: "", qty: -2, avgCost: 0 } });
    storeStockIds.push(rowHigh.id, rowZero.id, rowNegative.id);

    const lines = await buildStocktakeLines(prisma, seededId(storeId), null, new Date());

    expect(lines).toHaveLength(3);
    expect(
      lines.map((l) => l.expectedQty).sort((a, b) => a - b),
    ).toEqual([-2, 0, 10]);
  });

  it("takes periodFrom from the previous APPROVED stocktake's countedAt", async () => {
    const stocktake = await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/1`,
        storeId,
        status: "APPROVED",
        countedAt: new Date("2026-08-01T00:00:00.000Z"),
        createdById: userId,
      },
    });
    stocktakeIds.push(stocktake.id);

    const from = await previousApprovedCountedAt(prisma, seededId(storeId));

    expect(from?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("ignores a CANCELLED stocktake when choosing periodFrom", async () => {
    const approved = await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/2`,
        storeId,
        status: "APPROVED",
        countedAt: new Date("2026-08-01T00:00:00.000Z"),
        createdById: userId,
      },
    });
    const cancelled = await prisma.storeStocktake.create({
      data: {
        docNo: `STK/${tag}/3`,
        storeId,
        status: "CANCELLED",
        countedAt: new Date("2026-08-20T00:00:00.000Z"),
        createdById: userId,
      },
    });
    stocktakeIds.push(approved.id, cancelled.id);

    const from = await previousApprovedCountedAt(prisma, seededId(storeId));

    expect(from?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("returns null periodFrom for a store's first stocktake", async () => {
    const from = await previousApprovedCountedAt(prisma, seededId(freshStoreId));

    expect(from).toBeNull();
  });

  it("sums SpgSale units inside the window only, per item and variant", async () => {
    const windowFrom = new Date("2026-08-10T00:00:00.000Z");
    const windowTo = new Date("2026-08-20T00:00:00.000Z");

    const stockRow = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 20, avgCost: 0 } });
    storeStockIds.push(stockRow.id);

    const before = await prisma.spgSale.create({
      data: {
        docNo: `SPGSALE/${tag}/BEFORE`,
        salesmanId: userId,
        storeId,
        createdById: userId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdAt: new Date("2026-08-05T00:00:00.000Z"),
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "Test Stocktake Item A", qty: 5, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    const inside = await prisma.spgSale.create({
      data: {
        docNo: `SPGSALE/${tag}/INSIDE`,
        salesmanId: userId,
        storeId,
        createdById: userId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdAt: new Date("2026-08-15T00:00:00.000Z"),
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "Test Stocktake Item A", qty: 3, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    const after = await prisma.spgSale.create({
      data: {
        docNo: `SPGSALE/${tag}/AFTER`,
        salesmanId: userId,
        storeId,
        createdById: userId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
        lines: { create: [{ itemId: itemAId, variantSku: "", productName: "Test Stocktake Item A", qty: 2, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    spgSaleIds.push(before.id, inside.id, after.id);

    const lines = await buildStocktakeLines(prisma, seededId(storeId), windowFrom, windowTo);
    const line = lines.find((l) => l.itemId === itemAId && l.variantSku === "")!;

    expect(line.soldInPeriodQty).toBe(3);
  });

  it("reports zero sold rather than omitting the line when the window holds no sales", async () => {
    const stockRow = await prisma.storeStock.create({ data: { storeId: quietStoreId, itemId: itemAId, variantSku: "", qty: 5, avgCost: 0 } });
    storeStockIds.push(stockRow.id);

    const lines = await buildStocktakeLines(prisma, seededId(quietStoreId), null, new Date());

    expect(lines).toHaveLength(1);
    expect(lines[0].soldInPeriodQty).toBe(0);
  });
});
