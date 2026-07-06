import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeCatalogItem, listCatalogForPwa } from "./queries";
import { prisma } from "@elorae/db";

const store = { id: "s1", termsType: "KONSI" as const, marginPercent: 20 };

describe("serializeCatalogItem", () => {
  const baseRow = {
    id: "i1",
    sku: "FG-RED-M",
    nameId: "Kaos Merah M",
    categoryId: "c1",
    category: { name: "Kaos" },
    sellingPrice: 10000,
    minOrderQty: null,
    inventoryValues: [
      { qtyOnHand: 8, reservedQty: 3, totalValue: 0 },
      { qtyOnHand: 2, reservedQty: 0, totalValue: 0 },
    ],
  };

  it("maps fields, computes available, and hides price for konsi (spec D9)", () => {
    // Konsi is a consignment transfer — the salesman sees no pricing; the gross-up
    // must not even reach the wire, so price/priceLabel are null server-side.
    expect(serializeCatalogItem(baseRow, store, "https://cdn/x.jpg", true, 6)).toEqual({
      itemId: "i1",
      sku: "FG-RED-M",
      nameId: "Kaos Merah M",
      categoryId: "c1",
      categoryName: "Kaos",
      primaryImageUrl: "https://cdn/x.jpg",
      available: 7, // (8-3) + (2-0)
      price: null,
      priceLabel: null,
      neverSent: true,
      minOrderQty: 6,
    });
  });

  it("returns the real selling price + label for a putus store", () => {
    const putusStore = { id: "s2", termsType: "PUTUS" as const, marginPercent: null };
    const out = serializeCatalogItem(baseRow, putusStore, null, false, 6);
    expect(out.price).toBe(10000);
    expect(out.priceLabel).toBe("Harga");
    expect(out.available).toBe(7);
    expect(out.neverSent).toBe(false);
    expect(out.minOrderQty).toBe(6);
  });

  it("uses the item-level minOrderQty override instead of the global default", () => {
    const putusStore = { id: "s2", termsType: "PUTUS" as const, marginPercent: null };
    const row = { ...baseRow, minOrderQty: 3 };
    const out = serializeCatalogItem(row, putusStore, null, false, 6);
    expect(out.minOrderQty).toBe(3);
  });

  it("null category, no image, no inventory, null price all serialize safely", () => {
    const row = {
      id: "i2",
      sku: "FG-X",
      nameId: "X",
      categoryId: null,
      category: null,
      sellingPrice: null,
      minOrderQty: null,
      inventoryValues: [],
    };
    expect(serializeCatalogItem(row, { termsType: "PUTUS", marginPercent: null }, null, false, 6)).toEqual({
      itemId: "i2",
      sku: "FG-X",
      nameId: "X",
      categoryId: null,
      categoryName: null,
      primaryImageUrl: null,
      available: 0,
      price: null,
      priceLabel: null,
      neverSent: false,
      minOrderQty: 6,
    });
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listCatalogForPwa — konsi neverSent (test bed only)", () => {
  const sku = `TEST-CQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let sentItemId = "";
  let freshItemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const sentItem = await prisma.item.create({
      data: { sku: `${sku}-SENT`, nameId: "Sent Item", nameEn: "Sent Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    sentItemId = sentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: sentItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const freshItem = await prisma.item.create({
      data: { sku: `${sku}-FRESH`, nameId: "Fresh Item", nameEn: "Fresh Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    freshItemId = freshItem.id;
    await prisma.inventoryValue.create({ data: { itemId: freshItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const konsiStore = await prisma.store.create({ data: { code: `S-${sku}`, name: "Toko Konsi Test", address: "T", termsType: "KONSI", isActive: true } });
    storeId = konsiStore.id;

    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId,
        salesmanId,
        visitId,
        status: "PENDING_APPROVAL",
        orderType: "KONSI",
        subtotal: 0,
        total: 0,
        lines: {
          create: [{ itemId: sentItemId, variantSku: "", productName: "Sent Item", qty: 1, unitPrice: 0, lineTotal: 0 }],
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId] } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.storeVisit.deleteMany({ where: { id: visitId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId] } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId] } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId] } } });
    await prisma.item.deleteMany({ where: { id: { in: [sentItemId, freshItemId] } } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("marks the sent item neverSent:false and the untouched item neverSent:true", async () => {
    const payload = await listCatalogForPwa(storeId);
    expect(payload).not.toBeNull();
    const bySku = new Map(payload!.items.map((i) => [i.itemId, i]));
    expect(bySku.get(sentItemId)!.neverSent).toBe(false);
    expect(bySku.get(freshItemId)!.neverSent).toBe(true);
  });
});

d("listCatalogForPwa — effective min-qty (test bed only)", () => {
  const sku = `TEST-CQ-MINQTY-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let globalItemId = "";
  let overrideItemId = "";
  let storeId = "";

  beforeEach(async () => {
    await prisma.systemSetting.upsert({
      where: { key: "putus.minOrderQty" },
      create: { key: "putus.minOrderQty", value: "6" },
      update: { value: "6" },
    });

    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const globalItem = await prisma.item.create({
      data: { sku: `${sku}-GLOBAL`, nameId: "Global Min Item", nameEn: "Global Min Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000, minOrderQty: null },
    });
    globalItemId = globalItem.id;
    await prisma.inventoryValue.create({ data: { itemId: globalItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const overrideItem = await prisma.item.create({
      data: { sku: `${sku}-OVERRIDE`, nameId: "Override Min Item", nameEn: "Override Min Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000, minOrderQty: 3 },
    });
    overrideItemId = overrideItem.id;
    await prisma.inventoryValue.create({ data: { itemId: overrideItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const putusStore = await prisma.store.create({ data: { code: `S-${sku}`, name: "Toko Putus Test", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = putusStore.id;
  });

  afterEach(async () => {
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: [globalItemId, overrideItemId] } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: [globalItemId, overrideItemId] } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: [globalItemId, overrideItemId] } } });
    await prisma.item.deleteMany({ where: { id: { in: [globalItemId, overrideItemId] } } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  it("catalog payload carries effective min-qty per item", async () => {
    const payload = await listCatalogForPwa(storeId);
    expect(payload).not.toBeNull();
    const byId = new Map(payload!.items.map((i) => [i.itemId, i]));
    expect(byId.get(globalItemId)!.minOrderQty).toBe(6); // global default
    expect(byId.get(overrideItemId)!.minOrderQty).toBe(3); // item override
  });
});
