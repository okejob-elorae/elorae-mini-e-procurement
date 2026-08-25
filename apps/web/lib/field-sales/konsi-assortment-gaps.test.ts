import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listKonsiAssortmentGaps, listKonsiSuggestions } from "./queries";

/* Read-only against a shared dev DB, but the fixture still writes rows — keep the same guard as sibling specs. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listKonsiAssortmentGaps (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let userId = "";
  let storeId = "";
  let putusStoreId = "";
  let prevSentItemId = "";
  let variantItemId = "";
  let targetItemId = "";
  let overlapItemId = "";
  let orderId = "";
  let priorOrderId = "";
  let putusOrderId = "";
  const assortmentLineIds: string[] = [];
  const storeStockIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    userId = "";
    storeId = "";
    putusStoreId = "";
    prevSentItemId = "";
    variantItemId = "";
    targetItemId = "";
    overlapItemId = "";
    orderId = "";
    priorOrderId = "";
    putusOrderId = "";
    assortmentLineIds.length = 0;
    storeStockIds.length = 0;

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-KAG-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const user = await prisma.user.create({ data: { email: `test-kag-${token}@example.com`, name: "Test KAG Admin" } });
    userId = user.id;

    const store = await prisma.store.create({
      data: { code: `TEST-KAG-STORE-${token}`, name: "Test Assortment Gap Store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    storeId = store.id;

    const putusStore = await prisma.store.create({
      data: { code: `TEST-KAG-PSTORE-${token}`, name: "Test Putus Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    putusStoreId = putusStore.id;

    /**
     * On the assortment, sent to this store before, and currently holds nothing — the exact case
     * the gap signal exists to catch, and the case `listKonsiSuggestions` MUST have already
     * dropped via `sentItemIds`.
     */
    const prevSentItem = await prisma.item.create({
      data: { sku: `TEST-KAG-PS-${token}`, nameId: "Previously sent, now gapped", nameEn: "Previously sent, now gapped", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 30000 },
    });
    prevSentItemId = prevSentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: prevSentItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });
    const line = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: prevSentItemId, variantSku: "", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(line.id);

    /**
     * Two-variant item, both on the assortment. V1 will be on the order under approval (so its
     * gap must be excluded); V2 is not on the order (so its gap must still show). Neither variant
     * was ever sent, so `listKonsiSuggestions` drops the WHOLE item (item-grain onOrder exclusion)
     * — leaving no overlap to worry about for this pair.
     */
    const variantItem = await prisma.item.create({
      data: { sku: `TEST-KAG-VAR-${token}`, nameId: "Variant gap item", nameEn: "Variant gap item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    variantItemId = variantItem.id;
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "V1", qtyOnHand: 5, reservedQty: 0, avgCost: 800, totalValue: 4000 } });
    await prisma.inventoryValue.create({ data: { itemId: variantItemId, variantSku: "V2", qtyOnHand: 8, reservedQty: 0, avgCost: 800, totalValue: 6400 } });
    const lineV1 = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: variantItemId, variantSku: "V1", targetQty: null, createdById: userId },
    });
    const lineV2 = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: variantItemId, variantSku: "V2", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(lineV1.id, lineV2.id);

    /* Depleted-but-not-missing gap, with a numeric target, to check `onHandQty`/`targetQty` pass through untouched. */
    const targetItem = await prisma.item.create({
      data: { sku: `TEST-KAG-TGT-${token}`, nameId: "Target gap item", nameEn: "Target gap item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 15000 },
    });
    targetItemId = targetItem.id;
    await prisma.inventoryValue.create({ data: { itemId: targetItemId, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 500, totalValue: 10000 } });
    const lineTarget = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: targetItemId, variantSku: "", targetQty: 5, createdById: userId },
    });
    assortmentLineIds.push(lineTarget.id);
    const stockTarget = await prisma.storeStock.create({
      data: { storeId, itemId: targetItemId, variantSku: "", qty: 1 },
    });
    storeStockIds.push(stockTarget.id);

    /**
     * On the assortment, NEVER sent, not on any order, with real main-warehouse stock — the case
     * that used to render under BOTH headings before `listKonsiSuggestions` learned to suppress a
     * row already claimed by a gap. Deliberately kept separate from `prevSentItemId`/`targetItemId`
     * above, which are excluded from never-sent via `sentItemIds` regardless of that fix — this
     * item is excluded ONLY by the gap-suppression filter, so it is the one that actually proves
     * the fix does something.
     */
    const overlapItem = await prisma.item.create({
      data: { sku: `TEST-KAG-OVL-${token}`, nameId: "Never sent, also a gap", nameEn: "Never sent, also a gap", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 12000 },
    });
    overlapItemId = overlapItem.id;
    await prisma.inventoryValue.create({ data: { itemId: overlapItemId, variantSku: "", qtyOnHand: 6, reservedQty: 0, avgCost: 600, totalValue: 3600 } });
    const lineOverlap = await prisma.storeAssortmentLine.create({
      data: { storeId, itemId: overlapItemId, variantSku: "", targetQty: null, createdById: userId },
    });
    assortmentLineIds.push(lineOverlap.id);

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KAG-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId: variantItemId, variantSku: "V1", productName: "Variant gap item", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    orderId = order.id;

    /**
     * A separate, already-APPROVED konsi order that sent BOTH `prevSentItemId` and `targetItemId`
     * to this store. `targetItemId` must be sent-before too, not just `prevSentItemId`: otherwise
     * it would be a genuinely never-sent item that ALSO happens to be an assortment gap — a case
     * `overlapItemId` above now exists to cover on its own, so it must not sneak into THIS fixture
     * and re-cover the same ground for the wrong reason.
     */
    const priorOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-KAG-PRIOR-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: 2000,
        total: 2000,
        lines: {
          create: [
            { itemId: prevSentItemId, variantSku: "", productName: "Previously sent, now gapped", qty: 1, unitPrice: 1000, lineTotal: 1000 },
            { itemId: targetItemId, variantSku: "", productName: "Target gap item", qty: 1, unitPrice: 1000, lineTotal: 1000 },
          ],
        },
      },
    });
    priorOrderId = priorOrder.id;

    const putusOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-KAG-${token}`,
        orderType: "PUTUS",
        storeId: putusStoreId,
        salesmanId: userId,
        status: "PENDING_APPROVAL",
        subtotal: 1000,
        total: 1000,
        lines: {
          create: [{ itemId: prevSentItemId, variantSku: "", productName: "Previously sent, now gapped", qty: 1, unitPrice: 1000, lineTotal: 1000 }],
        },
      },
    });
    putusOrderId = putusOrder.id;
  });

  afterEach(async () => {
    const allItemIds = [seededId(prevSentItemId), seededId(variantItemId), seededId(targetItemId), seededId(overlapItemId)];
    const allOrderIds = [seededId(orderId), seededId(priorOrderId), seededId(putusOrderId)];
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: allOrderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: allOrderIds } } });
    await prisma.storeAssortmentLine.deleteMany({ where: { id: { in: assortmentLineIds } } });
    await prisma.storeStock.deleteMany({ where: { id: { in: storeStockIds } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(putusStoreId)] } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: allItemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("returns an empty list for a non-existent order", async () => {
    const rows = await listKonsiAssortmentGaps("does-not-exist");
    expect(rows).toEqual([]);
  });

  it("returns an empty list for a non-KONSI order", async () => {
    const rows = await listKonsiAssortmentGaps(putusOrderId);
    expect(rows).toEqual([]);
  });

  it("excludes a gap at VARIANT grain when that variant is already on the order, but keeps a different variant of the same item", async () => {
    const rows = await listKonsiAssortmentGaps(orderId);
    const variantRows = rows.filter((r) => r.itemId === variantItemId);
    expect(variantRows.map((r) => r.variantSku)).toEqual(["V2"]);
  });

  it("passes onHandQty and targetQty through unchanged", async () => {
    const rows = await listKonsiAssortmentGaps(orderId);
    const row = rows.find((r) => r.itemId === targetItemId)!;
    expect(row.onHandQty).toBe(1);
    expect(row.targetQty).toBe(5);
    expect(row.sku).toBe(`TEST-KAG-TGT-${token}`);
  });

  it("a previously-sent assortment item appears in the gap list and NOT in the never-sent list, and the two lists never intersect for this order", async () => {
    const gaps = await listKonsiAssortmentGaps(orderId);
    const neverSent = await listKonsiSuggestions(orderId);

    const gapKeys = new Set(gaps.map((r) => `${r.itemId}::${r.variantSku}`));
    const neverSentKeys = new Set(neverSent.map((r) => `${r.itemId}::${r.variantSku}`));

    expect(gapKeys.has(`${prevSentItemId}::`)).toBe(true);
    expect(neverSentKeys.has(`${prevSentItemId}::`)).toBe(false);
    expect(neverSent.map((r) => r.itemId)).not.toContain(prevSentItemId);

    for (const key of gapKeys) {
      expect(neverSentKeys.has(key)).toBe(false);
    }
  });

  it("an item that is both a never-sent candidate and an assortment gap is returned under the gap set only", async () => {
    const gaps = await listKonsiAssortmentGaps(orderId);
    const neverSent = await listKonsiSuggestions(orderId);

    const key = `${overlapItemId}::`;
    expect(gaps.some((r) => r.itemId === overlapItemId && r.variantSku === "")).toBe(true);
    expect(neverSent.some((r) => r.itemId === overlapItemId)).toBe(false);

    const neverSentKeys = new Set(neverSent.map((r) => `${r.itemId}::${r.variantSku}`));
    expect(neverSentKeys.has(key)).toBe(false);
  });
});
