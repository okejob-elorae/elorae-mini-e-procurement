import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getStockAcrossLocations } from "./stock-across-locations";

describe("getStockAcrossLocations", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let canvasserId = "";
  let storeId = "";
  let dualItemId = "";
  let itemId = "";
  let storeOnlyItemId = "";
  let emptyItemId = "";

  beforeEach(async () => {
    uomId = "";
    canvasserId = "";
    storeId = "";
    dualItemId = "";
    itemId = "";
    storeOnlyItemId = "";
    emptyItemId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-SAL-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const canvasser = await prisma.user.create({ data: { email: `test-sal-${token}@example.com`, name: "Test Van Canvasser" } });
    canvasserId = canvasser.id;

    const store = await prisma.store.create({
      data: { code: `TEST-SAL-STORE-${token}`, name: "Test Cross-Location Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    /* Dual-row item: a null-keyed row AND a ""-keyed row for the SAME item — the real dual-row
       state InventoryValue can hold. 10 + 20 must fold onto the single "" key as 30. */
    const dualItem = await prisma.item.create({
      data: { sku: `TEST-SAL-DUAL-${token}`, nameId: "Dual row item", nameEn: "Dual row item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    dualItemId = dualItem.id;
    await prisma.inventoryValue.create({ data: { itemId: dualItemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });
    await prisma.inventoryValue.create({ data: { itemId: dualItemId, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });

    /* Item present in all three ledgers under the same real variant, XL. */
    const item = await prisma.item.create({
      data: { sku: `TEST-SAL-ITEM-${token}`, nameId: "Cross-location item", nameEn: "Cross-location item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "XL", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });
    await prisma.vanStock.create({ data: { userId: canvasserId, itemId, variantSku: "XL", qty: 4, avgCost: 1000 } });
    await prisma.storeStock.create({ data: { storeId, itemId, variantSku: "XL", qty: 6, avgCost: 1000 } });

    /* Item held ONLY at a store — no InventoryValue row, no VanStock row at all. */
    const storeOnlyItem = await prisma.item.create({
      data: { sku: `TEST-SAL-STOREONLY-${token}`, nameId: "Store-only item", nameEn: "Store-only item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    storeOnlyItemId = storeOnlyItem.id;
    await prisma.storeStock.create({ data: { storeId, itemId: storeOnlyItemId, variantSku: "", qty: 6, avgCost: 1000 } });

    /* Item that exists but has no ledger row anywhere — proves the "no key" case isn't vacuous. */
    const emptyItem = await prisma.item.create({
      data: { sku: `TEST-SAL-EMPTY-${token}`, nameId: "No-stock item", nameEn: "No-stock item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    emptyItemId = emptyItem.id;
  });

  afterEach(async () => {
    const itemIds = [seededId(dualItemId), seededId(itemId), seededId(storeOnlyItemId), seededId(emptyItemId)];
    await prisma.storeStock.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.vanStock.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(canvasserId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it('folds a null and a "" InventoryValue row for one item onto a single key', async () => {
    /* the fixture seeds BOTH spellings for the same item — a real dual row */
    const m = await getStockAcrossLocations([seededId(dualItemId)]);
    expect(m.size).toBe(1);
    expect(m.get(`${dualItemId}::`)!.main).toBe(30);
  });

  it("sums main, van and store for the same key", async () => {
    const m = await getStockAcrossLocations([seededId(itemId)]);
    const row = m.get(`${itemId}::XL`)!;
    expect(row.main).toBe(10);
    expect(row.van).toBe(4);
    expect(row.store).toBe(6);
    expect(row.total).toBe(20);
  });

  it("reports an item held ONLY at a store", async () => {
    const m = await getStockAcrossLocations([seededId(storeOnlyItemId)]);
    const row = m.get(`${storeOnlyItemId}::`)!;
    expect(row.main).toBe(0);
    expect(row.store).toBe(6);
    expect(row.total).toBe(6);
  });

  it("returns no key for an item with stock nowhere", async () => {
    /* seededId'd item that exists but has no ledger row anywhere */
    const m = await getStockAcrossLocations([seededId(emptyItemId)]);
    expect(m.has(`${emptyItemId}::`)).toBe(false);
  });

  it("returns an empty map for an empty itemIds array", async () => {
    const m = await getStockAcrossLocations([]);
    expect(m.size).toBe(0);
  });
});
