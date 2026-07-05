import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeCatalogItem, listCatalogForPwa } from "./queries";
import { prisma } from "@elorae/db";

const store = { id: "s1", termsType: "KONSI" as const, marginPercent: 20 };

describe("serializeCatalogItem", () => {
  it("maps fields, computes available and konsi gross-up price", () => {
    const row = {
      id: "i1",
      sku: "FG-RED-M",
      nameId: "Kaos Merah M",
      categoryId: "c1",
      category: { name: "Kaos" },
      sellingPrice: 10000,
      inventoryValues: [
        { qtyOnHand: 8, reservedQty: 3, totalValue: 0 },
        { qtyOnHand: 2, reservedQty: 0, totalValue: 0 },
      ],
    };
    expect(serializeCatalogItem(row, store, "https://cdn/x.jpg", true)).toEqual({
      itemId: "i1",
      sku: "FG-RED-M",
      nameId: "Kaos Merah M",
      categoryId: "c1",
      categoryName: "Kaos",
      primaryImageUrl: "https://cdn/x.jpg",
      available: 7, // (8-3) + (2-0)
      price: 12500, // 10000 / (1 - 0.20)
      priceLabel: "Retail (info)",
      neverSent: true,
    });
  });

  it("null category, no image, no inventory, null price all serialize safely", () => {
    const row = {
      id: "i2",
      sku: "FG-X",
      nameId: "X",
      categoryId: null,
      category: null,
      sellingPrice: null,
      inventoryValues: [],
    };
    expect(serializeCatalogItem(row, { termsType: "PUTUS", marginPercent: null }, null, false)).toEqual({
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
