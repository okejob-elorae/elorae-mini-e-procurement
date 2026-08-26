import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listAssortmentGaps, listAssortmentLines } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("store assortment queries (test bed only)", () => {
  const tag = `AST-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let userId = "";
  let itemAId = "";
  let itemBId = "";
  let storeId = "";
  let otherStoreId = "";
  let assortmentLineIds: string[] = [];
  let storeStockIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    userId = "";
    itemAId = "";
    itemBId = "";
    storeId = "";
    otherStoreId = "";
    assortmentLineIds = [];
    storeStockIds = [];

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const user = await prisma.user.create({ data: { email: `${tag}@example.com`.toLowerCase(), name: "Test Assortment User" } });
    userId = user.id;

    const itemA = await prisma.item.create({
      data: { sku: `${tag}-A`, nameId: "Test Assortment Item A", nameEn: "Item A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemAId = itemA.id;
    const itemB = await prisma.item.create({
      data: { sku: `${tag}-B`, nameId: "Test Assortment Item B", nameEn: "Item B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 1000 },
    });
    itemBId = itemB.id;

    const store = await prisma.store.create({
      data: { code: `${tag}-STORE`, name: "Test Assortment Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    storeId = store.id;
    const other = await prisma.store.create({
      data: { code: `${tag}-OTHER`, name: "Test Assortment Other Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    otherStoreId = other.id;
  });

  afterEach(async () => {
    await prisma.storeAssortmentLine.deleteMany({ where: { id: { in: assortmentLineIds } } });
    await prisma.storeStock.deleteMany({ where: { id: { in: storeStockIds } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(otherStoreId)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  describe("listAssortmentGaps", () => {
    it("treats a MISSING StoreStock row as a gap — the never-received case", async () => {
      const line = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "", targetQty: null, createdById: userId },
      });
      assortmentLineIds.push(line.id);

      const gaps = await listAssortmentGaps(seededId(storeId));

      expect(gaps).toHaveLength(1);
      expect(gaps[0].onHandQty).toBe(0);
      expect(gaps[0].itemId).toBe(itemAId);
      expect(gaps[0].targetQty).toBeNull();
    });

    it("treats qty <= 0 as a gap when the target is null", async () => {
      const lineZero = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "", targetQty: null, createdById: userId },
      });
      const lineNegative = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemBId, variantSku: "", targetQty: null, createdById: userId },
      });
      assortmentLineIds.push(lineZero.id, lineNegative.id);

      const stockZero = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 0, avgCost: 0 } });
      const stockNegative = await prisma.storeStock.create({ data: { storeId, itemId: itemBId, variantSku: "", qty: -2, avgCost: 0 } });
      storeStockIds.push(stockZero.id, stockNegative.id);

      const gaps = await listAssortmentGaps(seededId(storeId));

      expect(gaps).toHaveLength(2);
      expect(gaps.map((g) => g.itemId).sort()).toEqual([itemAId, itemBId].sort());
    });

    it("does NOT report a healthy row with a null target", async () => {
      const line = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "", targetQty: null, createdById: userId },
      });
      assortmentLineIds.push(line.id);

      const stock = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 5, avgCost: 0 } });
      storeStockIds.push(stock.id);

      const gaps = await listAssortmentGaps(seededId(storeId));

      expect(gaps).toHaveLength(0);
    });

    it("reports a gap when qty is below a set target", async () => {
      const line = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "", targetQty: 10, createdById: userId },
      });
      assortmentLineIds.push(line.id);

      const stock = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 4, avgCost: 0 } });
      storeStockIds.push(stock.id);

      const gaps = await listAssortmentGaps(seededId(storeId));

      expect(gaps).toHaveLength(1);
      expect(gaps[0].onHandQty).toBe(4);
      expect(gaps[0].targetQty).toBe(10);
    });

    it("does NOT report a row at or above its target", async () => {
      const line = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "", targetQty: 10, createdById: userId },
      });
      assortmentLineIds.push(line.id);

      const stock = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "", qty: 10, avgCost: 0 } });
      storeStockIds.push(stock.id);

      const gaps = await listAssortmentGaps(seededId(storeId));

      expect(gaps).toHaveLength(0);
    });

    it("is per-variant: one variant stocked, one not, yields exactly one gap", async () => {
      const lineV1 = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "V1", targetQty: null, createdById: userId },
      });
      const lineV2 = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "V2", targetQty: null, createdById: userId },
      });
      assortmentLineIds.push(lineV1.id, lineV2.id);

      const stockV1 = await prisma.storeStock.create({ data: { storeId, itemId: itemAId, variantSku: "V1", qty: 5, avgCost: 0 } });
      storeStockIds.push(stockV1.id);

      const gaps = await listAssortmentGaps(seededId(storeId));

      expect(gaps).toHaveLength(1);
      expect(gaps[0].variantSku).toBe("V2");
    });

    it("does not leak another store's assortment or stock", async () => {
      const line = await prisma.storeAssortmentLine.create({
        data: { storeId: otherStoreId, itemId: itemAId, variantSku: "", targetQty: null, createdById: userId },
      });
      assortmentLineIds.push(line.id);
      const stock = await prisma.storeStock.create({ data: { storeId: otherStoreId, itemId: itemAId, variantSku: "", qty: 0, avgCost: 0 } });
      storeStockIds.push(stock.id);

      const gaps = await listAssortmentGaps(seededId(storeId));

      expect(gaps).toHaveLength(0);
    });
  });

  describe("listAssortmentLines", () => {
    it("returns the store's configured lines with item and variant labels", async () => {
      const line = await prisma.storeAssortmentLine.create({
        data: { storeId, itemId: itemAId, variantSku: "", targetQty: 10, createdById: userId },
      });
      assortmentLineIds.push(line.id);

      const lines = await listAssortmentLines(seededId(storeId));

      expect(lines).toHaveLength(1);
      expect(lines[0].itemId).toBe(itemAId);
      expect(lines[0].itemSku).toBe(`${tag}-A`);
      expect(lines[0].productName).toBe("Test Assortment Item A");
      expect(lines[0].variantSku).toBe("");
      expect(lines[0].targetQty).toBe(10);
    });

    it("does not leak another store's assortment lines", async () => {
      const line = await prisma.storeAssortmentLine.create({
        data: { storeId: otherStoreId, itemId: itemAId, variantSku: "", targetQty: null, createdById: userId },
      });
      assortmentLineIds.push(line.id);

      const lines = await listAssortmentLines(seededId(storeId));

      expect(lines).toHaveLength(0);
    });
  });
});
