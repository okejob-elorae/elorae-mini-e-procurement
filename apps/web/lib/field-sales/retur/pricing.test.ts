import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listPriceCandidates, resolveLinePrice } from "./pricing";

/**
 * Read-only queries under test, but the fixture writes real FieldSalesOrder / FieldSalesDelivery
 * / FieldSalesDeliveryLine rows directly (bypassing the delivery writer, which is out of scope
 * here) — never run against the shared prod DB (port 3307 tunnel / VPS host).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listPriceCandidates / resolveLinePrice (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let otherStoreId = "";
  let userId = "";
  let orderId = "";
  let otherOrderId = "";
  let deliveryAId = "";
  let deliveryBId = "";
  let otherDeliveryId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    otherStoreId = "";
    userId = "";
    orderId = "";
    otherOrderId = "";
    deliveryAId = "";
    deliveryBId = "";
    otherDeliveryId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FSP-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FSP-${token}`, nameId: "Retur pricing item", nameEn: "Retur pricing item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSP-STORE-${token}`, name: "Test Pricing Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const otherStore = await prisma.store.create({
      data: { code: `TEST-FSP-OTHER-STORE-${token}`, name: "Test Pricing Other Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    otherStoreId = otherStore.id;

    const user = await prisma.user.create({ data: { email: `test-fsp-${token}@example.com`, name: "Test Pricing User" } });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSP-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 17_300_000,
        total: 15_100_000,
        lines: {
          create: [
            { itemId, variantSku: "XL", productName: "Test Item XL", qty: 12, unitPrice: 1_000_000, lineTotal: 10_000_000 },
            { itemId, variantSku: "M", productName: "Test Item M", qty: 5, unitPrice: 200_000, lineTotal: 1_000_000 },
            { itemId, variantSku: "NULLTOTAL", productName: "Test Item NullTotal", qty: 3, unitPrice: 100_000, lineTotal: 300_000 },
            { itemId, variantSku: "AMBIG", productName: "Test Item Ambig", qty: 4, unitPrice: 1_000_000, lineTotal: 3_800_000 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    const lineXL = order.lines.find((l) => l.variantSku === "XL")!;
    const lineM = order.lines.find((l) => l.variantSku === "M")!;
    const lineNullTotal = order.lines.find((l) => l.variantSku === "NULLTOTAL")!;
    const lineAmbig = order.lines.find((l) => l.variantSku === "AMBIG")!;

    const otherOrder = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSP-OTHER-${token}`,
        storeId: otherStoreId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 4_000_000,
        total: 4_000_000,
        lines: {
          create: [{ itemId, variantSku: "XL", productName: "Test Item XL Other", qty: 4, unitPrice: 1_000_000, lineTotal: 4_000_000 }],
        },
      },
      include: { lines: true },
    });
    otherOrderId = otherOrder.id;
    const otherLineXL = otherOrder.lines[0];

    /* Delivery A: carries XL (the priced happy-path line), M (a real delivery of a DIFFERENT
       variant of the SAME item, priced differently from XL — so a query for "XL" proves the
       variant filter, not just the item filter, is applied: it must return exactly the XL
       price, never the M one) and NULLTOTAL (a line whose lineTotal was never set, which must
       be skipped rather than priced at zero). */
    const deliveryA = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-FSP-DLV-A-${token}`,
        orderId,
        deliveredAt: new Date("2026-08-01T00:00:00.000Z"),
        deliveredById: userId,
        invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
        dueDate: new Date("2026-08-08T00:00:00.000Z"),
        subtotal: 13_300_000,
        total: 13_000_000,
        lines: {
          create: [
            { orderLineId: lineXL.id, itemId, variantSku: "XL", productName: "Test Item XL", qty: 12, unitPrice: 1_000_000, lineTotal: 10_000_000 },
            { orderLineId: lineM.id, itemId, variantSku: "M", productName: "Test Item M", qty: 5, unitPrice: 200_000, lineTotal: 1_000_000 },
            { orderLineId: lineNullTotal.id, itemId, variantSku: "NULLTOTAL", productName: "Test Item NullTotal", qty: 3, unitPrice: 100_000, lineTotal: null },
            { orderLineId: lineAmbig.id, itemId, variantSku: "AMBIG", productName: "Test Item Ambig", qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 },
          ],
        },
      },
    });
    deliveryAId = deliveryA.id;

    /* Delivery B: a second, later delivery of the same AMBIG line at a different net price —
       the two deliveries disagree on what this store was actually billed per unit. */
    const deliveryB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-FSP-DLV-B-${token}`,
        orderId,
        deliveredAt: new Date("2026-08-02T00:00:00.000Z"),
        deliveredById: userId,
        invoiceDate: new Date("2026-08-02T00:00:00.000Z"),
        dueDate: new Date("2026-08-09T00:00:00.000Z"),
        subtotal: 1_800_000,
        total: 1_800_000,
        lines: {
          create: [
            { orderLineId: lineAmbig.id, itemId, variantSku: "AMBIG", productName: "Test Item Ambig", qty: 2, unitPrice: 900_000, lineTotal: 1_800_000 },
          ],
        },
      },
    });
    deliveryBId = deliveryB.id;

    /* A delivery of the SAME item + variant (XL) but to a DIFFERENT store. */
    const otherDelivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-FSP-DLV-OTHER-${token}`,
        orderId: otherOrderId,
        deliveredAt: new Date("2026-08-01T00:00:00.000Z"),
        deliveredById: userId,
        invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
        dueDate: new Date("2026-08-08T00:00:00.000Z"),
        subtotal: 4_000_000,
        total: 4_000_000,
        lines: {
          create: [
            { orderLineId: otherLineXL.id, itemId, variantSku: "XL", productName: "Test Item XL Other", qty: 4, unitPrice: 1_000_000, lineTotal: 4_000_000 },
          ],
        },
      },
    });
    otherDeliveryId = otherDelivery.id;
  });

  afterEach(async () => {
    const deliveryIds = [seededId(deliveryAId), seededId(deliveryBId), seededId(otherDeliveryId)];
    const orderIds = [seededId(orderId), seededId(otherOrderId)];
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(otherStoreId)] } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("returns one candidate per delivery line for that store, item and variant", async () => {
    const found = await listPriceCandidates(prisma, { storeId, itemId, variantSku: "XL" });
    expect(found).toHaveLength(1);
    expect(found[0].unitPrice).toBeCloseTo(833_333.3333, 4);
  });

  it("prices from lineTotal, NOT unitPrice — lineTotal is net of the pro-rated discounts", async () => {
    /* the fixture's line carries unitPrice 1.000.000 and lineTotal 10.000.000 over 12 pcs */
    const found = await listPriceCandidates(prisma, { storeId, itemId, variantSku: "XL" });
    expect(found[0].unitPrice).not.toBeCloseTo(1_000_000, 4);
    expect(found[0].unitPrice).toBeCloseTo(833_333.3333, 4);
  });

  it("scopes to the queried store, not just item and variant", async () => {
    /*
     * otherStoreId has its OWN real XL delivery (4.000.000 over 4 = 1.000.000/unit) — an
     * assertion of zero rows here would be satisfied by nothing, including a correct
     * implementation, since that store genuinely has one XL candidate. Assert the count AND
     * the price/docNo so this fails loudly against both an unfiltered query (would return 2)
     * and a wrong-store filter (would return storeId's 833.333,33 XL price instead).
     */
    const found = await listPriceCandidates(prisma, { storeId: otherStoreId, itemId, variantSku: "XL" });
    expect(found).toHaveLength(1);
    expect(found[0].docNo).toBe(`TEST-FSP-DLV-OTHER-${token}`);
    expect(found[0].unitPrice).toBeCloseTo(1_000_000, 4);
  });

  it("ignores a different variant of the same item", async () => {
    /*
     * M is a real delivery of the SAME item at storeId, priced at 200.000/unit — an
     * assertion of zero XL rows would prove nothing if the query ignored variantSku
     * entirely (it would then return both XL and M). Assert the XL price specifically so a
     * variant-blind query is caught by the wrong number, not just a wrong count.
     */
    const found = await listPriceCandidates(prisma, { storeId, itemId, variantSku: "XL" });
    expect(found).toHaveLength(1);
    expect(found[0].unitPrice).toBeCloseTo(833_333.3333, 4);
    expect(found[0].unitPrice).not.toBeCloseTo(200_000, 4);
  });

  it("skips a delivery line with a null lineTotal rather than pricing it at zero", async () => {
    /* the backfill wrote deliveries whose lines can carry a null lineTotal */
    const found = await listPriceCandidates(prisma, { storeId, itemId, variantSku: "NULLTOTAL" });
    expect(found).toHaveLength(0);
  });

  it("auto-resolves when one distinct price exists", async () => {
    const res = await resolveLinePrice(prisma, { storeId, itemId, variantSku: "XL" });
    expect(res.kind).toBe("AUTO");
  });

  it("reports AMBIGUOUS when two deliveries priced the same goods differently", async () => {
    const res = await resolveLinePrice(prisma, { storeId, itemId, variantSku: "AMBIG" });
    expect(res.kind).toBe("AMBIGUOUS");
    if (res.kind === "AMBIGUOUS") expect(res.candidates).toHaveLength(2);
  });

  it("reports UNPRICEABLE when nothing was ever delivered", async () => {
    const res = await resolveLinePrice(prisma, { storeId, itemId, variantSku: "NEVERSENT" });
    expect(res.kind).toBe("UNPRICEABLE");
  });
});
