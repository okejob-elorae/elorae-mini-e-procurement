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
  let variantItemId = "";
  let unsentVariantItemId = "";
  let collisionItemId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let priorOrderId = "";
  let priorVariantOrderId = "";
  let putusStoreId = "";
  let putusOrderId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    neverSentItemId = "";
    previouslySentItemId = "";
    variantItemId = "";
    unsentVariantItemId = "";
    collisionItemId = "";
    storeId = "";
    userId = "";
    orderId = "";
    priorOrderId = "";
    priorVariantOrderId = "";
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

    /* Multi-variant item: only ONE of its two variants gets sent to the store on a separate order. */
    const variantItem = await prisma.item.create({
      data: { sku: `TEST-KSG-VAR-${token}`, nameId: "Variant item", nameEn: "Variant item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    variantItemId = variantItem.id;
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "RED", qtyOnHand: 20, reservedQty: 0, avgCost: 800, totalValue: 16000 } });
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "BLUE", qtyOnHand: 15, reservedQty: 0, avgCost: 800, totalValue: 12000 } });

    /*
     * A second multi-variant item where NEITHER variant was ever sent, so BOTH survive into the
     * suggestion list. `variantItemId` above is excluded by sentItemIds before the per-variant
     * expansion ever runs, so it cannot cover two surviving real variants.
     */
    const unsentVariantItem = await prisma.item.create({
      data: { sku: `TEST-KSG-UVAR-${token}`, nameId: "Unsent variant item", nameEn: "Unsent variant item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 22000 },
    });
    unsentVariantItemId = unsentVariantItem.id;
    await prisma.inventoryValue.create({ data: { itemId: unsentVariantItemId, variantSku: "S", qtyOnHand: 30, reservedQty: 5, avgCost: 800, totalValue: 24000 } });
    await prisma.inventoryValue.create({ data: { itemId: unsentVariantItemId, variantSku: "M", qtyOnHand: 8, reservedQty: 1, avgCost: 800, totalValue: 6400 } });

    /* Both a `null` and an `""` InventoryValue row for the same item — the real-world collision. */
    const collisionItem = await prisma.item.create({
      data: { sku: `TEST-KSG-COL-${token}`, nameId: "Collision item", nameEn: "Collision item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 25000 },
    });
    collisionItemId = collisionItem.id;
    await prisma.inventoryValue.create({ data: { itemId: collisionItemId, variantSku: null, qtyOnHand: 9, reservedQty: 0, avgCost: 700, totalValue: 6300 } });
    await prisma.inventoryValue.create({ data: { itemId: collisionItemId, variantSku: "", qtyOnHand: 4, reservedQty: 0, avgCost: 700, totalValue: 2800 } });

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

    /* A separate, already-APPROVED konsi order sending only the RED variant of `variantItemId`. */
    const priorVariantOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KSG-PRIOR-VAR-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId: variantItemId, variantSku: "RED", productName: "Variant item", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    priorVariantOrderId = priorVariantOrder.id;

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
    const allItemIds = [
      seededId(itemId),
      seededId(neverSentItemId),
      seededId(previouslySentItemId),
      seededId(variantItemId),
      seededId(unsentVariantItemId),
      seededId(collisionItemId),
    ];
    const allOrderIds = [
      seededId(orderId),
      seededId(priorOrderId),
      seededId(priorVariantOrderId),
      seededId(putusOrderId),
    ];
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

  it("excludes BOTH variants of an item when only one variant was ever sent to this store", async () => {
    const rows = await listKonsiSuggestions(orderId);
    const variantRows = rows.filter((r) => r.itemId === variantItemId);
    expect(variantRows).toHaveLength(0);
  });

  it("returns one distinguishable row per variant when NEITHER variant was ever sent", async () => {
    const rows = (await listKonsiSuggestions(orderId)).filter((r) => r.itemId === unsentVariantItemId);
    expect(rows).toHaveLength(2);
    /*
     * Distinct variantSku is what the panel has to render: `sku` is the article SKU and is
     * identical on both rows, so without the variant these two are indistinguishable to the
     * admin choosing which physical goods leave the warehouse.
     */
    expect(rows.map((r) => r.variantSku).sort()).toEqual(["M", "S"]);
    expect(rows.every((r) => r.sku === `TEST-KSG-UVAR-${token}`)).toBe(true);
    const availableBySku = new Map(rows.map((r) => [r.variantSku, r.available]));
    expect(availableBySku.get("S")).toBe(25);
    expect(availableBySku.get("M")).toBe(7);
  });

  it("dedupes a null/empty-string InventoryValue collision into one suggestion at the minimum available", async () => {
    const rows = await listKonsiSuggestions(orderId);
    const collisionRows = rows.filter((r) => r.itemId === collisionItemId);
    expect(collisionRows).toHaveLength(1);
    expect(collisionRows[0].variantSku).toBe("");
    expect(collisionRows[0].available).toBe(4);
  });
});
