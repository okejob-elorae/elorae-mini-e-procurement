import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { deleteItem, getItemDeleteImpact, ITEM_DELETE_BLOCKED } from "./mutations";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("deleteItem impact and sales-history un-mapping (test bed only)", () => {
  let token = "";
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesHistoryId = "";
  let assortmentLineId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10).toUpperCase();
    uomId = "";
    itemId = "";
    storeId = "";
    salesHistoryId = "";
    assortmentLineId = "";
    const uom = await prisma.uOM.create({
      data: { code: `TEST-DEL-UOM-${token}`, nameId: "pcs", nameEn: "pcs" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: {
        sku: `TST-DEL-${token}`,
        nameId: "t",
        nameEn: "t",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
      },
    });
    itemId = item.id;
    await prisma.itemImage.create({
      data: { itemId, url: `https://example.test/${token}.jpg` },
    });
    await prisma.itemPriceChangeLog.create({
      data: { itemId, triggerReason: "MANUAL_EDIT", newSellingPrice: 100 },
    });
    const row = await prisma.salesHistory.create({
      data: {
        channel: "OFFLINE",
        orderId: `TST-DEL-ORD-${token}`,
        orderStatus: "COMPLETED",
        variantSku: `TST-DEL-${token}-V`,
        parentSku: `TST-DEL-${token}`,
        productName: "t",
        quantity: 1,
        netQuantity: 1,
        unitPrice: 100,
        unitPriceAfterDiscount: 100,
        lineTotal: 100,
        orderTotal: 100,
        orderDate: new Date("2026-01-01T00:00:00Z"),
        itemId,
        erpVariantSku: `TST-DEL-${token}-V`,
        jubelioItemId: 123456,
        resolutionStatus: "MAPPED",
      },
    });
    salesHistoryId = row.id;
  });

  afterEach(async () => {
    if (salesHistoryId) await prisma.salesHistory.delete({ where: { id: seededId(salesHistoryId) } });
    if (assortmentLineId) {
      await prisma.storeAssortmentLine.delete({ where: { id: seededId(assortmentLineId) } });
    }
    if (storeId) await prisma.store.delete({ where: { id: seededId(storeId) } });
    if (itemId) {
      await prisma.itemImage.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("reports what the delete will destroy without blocking", async () => {
    expect(await getItemDeleteImpact(itemId)).toEqual({
      blocked: false,
      images: 1,
      priceChanges: 1,
      salesHistory: 1,
    });
  });

  it("un-maps the sales history row and cascades the image and price log", async () => {
    await deleteItem(itemId);

    const row = await prisma.salesHistory.findUnique({ where: { id: salesHistoryId } });
    expect(row).toMatchObject({
      itemId: null,
      erpVariantSku: null,
      jubelioItemId: null,
      resolutionStatus: "UNMAPPED",
    });
    expect(await prisma.itemImage.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    expect(await prisma.itemPriceChangeLog.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    expect(await prisma.item.count({ where: { id: seededId(itemId) } })).toBe(0);
  });

  it("refuses an item with a blocking record", async () => {
    const store = await prisma.store.create({
      data: { code: `TEST-DEL-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const line = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId, createdById: "test-user" },
    });
    assortmentLineId = line.id;

    expect((await getItemDeleteImpact(itemId)).blocked).toBe(true);
    await expect(deleteItem(itemId)).rejects.toThrow(ITEM_DELETE_BLOCKED);
    expect(await prisma.item.count({ where: { id: seededId(itemId) } })).toBe(1);
  });
});
