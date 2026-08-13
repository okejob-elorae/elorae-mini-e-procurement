import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listKonsiSuggestions } from "./queries";

/* Read-only against a shared dev DB, but the fixture still writes rows — keep the same guard as sibling specs. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listKonsiSuggestions (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let neverSentItemId = "";
  let previouslySentItemId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let priorOrderId = "";
  let putusStoreId = "";
  let putusOrderId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    neverSentItemId = "";
    previouslySentItemId = "";
    storeId = "";
    userId = "";
    orderId = "";
    priorOrderId = "";
    putusStoreId = "";
    putusOrderId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KSG-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-KSG-${token}`, nameId: "On order item", nameEn: "On order item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 1000, totalValue: 50000 } });

    const neverSentItem = await prisma.item.create({
      data: { sku: `TEST-KSG-NS-${token}`, nameId: "Never sent item", nameEn: "Never sent item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50000 },
    });
    neverSentItemId = neverSentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: neverSentItemId, variantSku: "", qtyOnHand: 12, reservedQty: 2, avgCost: 1500, totalValue: 18000 } });

    const previouslySentItem = await prisma.item.create({
      data: { sku: `TEST-KSG-PS-${token}`, nameId: "Previously sent item", nameEn: "Previously sent item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 30000 },
    });
    previouslySentItemId = previouslySentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: previouslySentItemId, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 900, totalValue: 18000 } });

    const store = await prisma.store.create({
      data: { code: `TEST-KSG-STORE-${token}`, name: "Test Konsi Suggestions Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    const putusStore = await prisma.store.create({
      data: { code: `TEST-KSG-PSTORE-${token}`, name: "Test Putus Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    putusStoreId = putusStore.id;

    const user = await prisma.user.create({ data: { email: `test-ksg-${token}@example.com`, name: "Test KSG Salesman" } });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KSG-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId, variantSku: "", productName: "On order item", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    orderId = order.id;

    /* A separate, already-APPROVED konsi order for the same store, carrying an item never on `orderId`. */
    const priorOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KSG-PRIOR-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId: previouslySentItemId, variantSku: "", productName: "Previously sent item", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    priorOrderId = priorOrder.id;

    const putusOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-KSG-${token}`,
        orderType: "PUTUS",
        storeId: putusStoreId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId, variantSku: "", productName: "On order item", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    putusOrderId = putusOrder.id;
  });

  afterEach(async () => {
    const allItemIds = [seededId(itemId), seededId(neverSentItemId), seededId(previouslySentItemId)];
    const allOrderIds = [seededId(orderId), seededId(priorOrderId), seededId(putusOrderId)];
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: allOrderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: allOrderIds } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(putusStoreId)] } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: allItemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("excludes items already sent to this store and items already on the order", async () => {
    const rows = await listKonsiSuggestions(orderId);
    const ids = rows.map((r) => r.itemId);
    expect(ids).not.toContain(itemId);
    expect(ids).not.toContain(previouslySentItemId);
    expect(ids).toContain(neverSentItemId);
  });

  it("reports available as on-hand minus reserved", async () => {
    const row = (await listKonsiSuggestions(orderId)).find((r) => r.itemId === neverSentItemId)!;
    expect(row.available).toBe(10);
    expect(row.variantSku).toBe("");
    expect(row.sku).toBe(`TEST-KSG-NS-${token}`);
    expect(row.name).toBe("Never sent item");
  });

  it("returns an empty list for a non-existent order", async () => {
    const rows = await listKonsiSuggestions("does-not-exist");
    expect(rows).toEqual([]);
  });

  it("returns an empty list for a non-KONSI order", async () => {
    const rows = await listKonsiSuggestions(putusOrderId);
    expect(rows).toEqual([]);
  });
});
