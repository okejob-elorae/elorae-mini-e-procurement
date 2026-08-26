import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordFieldSalesDelivery, closeFieldSalesOrderRemainder } from "./writer";
import { DeliveryError } from "../errors";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Fixture dates for tests that don't care about the exact value — the writer no longer derives one. */
const defaultInvoiceDate = new Date("2026-01-01T00:00:00.000+07:00");
const defaultDueDate = new Date("2026-01-08T00:00:00.000+07:00");

d("recordFieldSalesDelivery (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineAId = "";
  let lineBId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; invId = ""; storeId = ""; userId = ""; orderId = ""; lineAId = ""; lineBId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-FSD-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FSD-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 10, avgCost: 500, totalValue: 5000 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSD-STORE-${token}`, name: "Test FSD Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-fsd-${token}@example.com`, name: "Test FSD Salesman" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSD-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 10000,
        total: 10000,
        lines: {
          create: [
            { itemId, variantSku: "", productName: "Test FSD Product A", qty: 5, unitPrice: 1000, lineTotal: 5000 },
            { itemId, variantSku: "", productName: "Test FSD Product B", qty: 5, unitPrice: 1000, lineTotal: 5000 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineAId = order.lines.find((l) => l.productName === "Test FSD Product A")!.id;
    lineBId = order.lines.find((l) => l.productName === "Test FSD Product B")!.id;

    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineAId, itemId, variantSku: "", qty: 5, state: "RESERVED" },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineBId, itemId, variantSku: "", qty: 5, state: "RESERVED" },
    });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.receivable.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("consumes only the delivered qty and sets the order to PARTIAL", async () => {
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(8);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("PARTIAL");
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: lineAId } });
    expect(line.deliveredQty).toBe(2);
  });

  it("sets DELIVERED once every line is fully delivered", async () => {
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [
        { orderLineId: lineAId, qty: 5 },
        { orderLineId: lineBId, qty: 5 },
      ],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("DELIVERED");
  });

  it("rejects a qty above outstanding and moves no stock", async () => {
    const err = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 6 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.code).toBe("OVER_DELIVER");
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(10);
  });

  it("hard-blocks when on-hand is short and names every short line", async () => {
    await prisma.inventoryValue.update({ where: { id: invId }, data: { qtyOnHand: 1 } });
    const err = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 5 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.code).toBe("INSUFFICIENT_STOCK");
    expect(err.shortLines).toHaveLength(1);
  });

  it("hard-blocks when two lines share the same item+variant and their combined qty exceeds on-hand, moving no stock", async () => {
    /**
     * lineA and lineB both resolve to invId (same item, variantSku "") — 6 on hand covers either
     * line alone (5) but not both (10) delivered in one call.
     */
    await prisma.inventoryValue.update({ where: { id: invId }, data: { qtyOnHand: 6 } });
    const err = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [
        { orderLineId: lineAId, qty: 5 },
        { orderLineId: lineBId, qty: 5 },
      ],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.code).toBe("INSUFFICIENT_STOCK");
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(6);
  });

  it("rejects an empty line set", async () => {
    const err = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    }).catch((e) => e);
    expect(err.code).toBe("NO_LINES");
  });

  it("writes SalesHistory for the delivered qty only, keyed and dated by the delivery", async () => {
    const first = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    const rows = await prisma.salesHistory.findMany({ where: { itemId: seededId(itemId) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].orderId).toBe(first.docNo);
  });

  it("does not collide on the SalesHistory unique key across two deliveries of the same variant", async () => {
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 3 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    const rows = await prisma.salesHistory.findMany({ where: { itemId: seededId(itemId) } });
    expect(rows).toHaveLength(2);
  });

  it("stamps exactly the invoice and due dates it was given", async () => {
    const { deliveryId } = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    const dlv = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(dlv.invoiceDate.toISOString()).toBe(defaultInvoiceDate.toISOString());
    expect(dlv.dueDate.toISOString()).toBe(defaultDueDate.toISOString());
  });

  it("stores the given dates and never consults the store payment tempo", async () => {
    const invoiceDate = new Date("2026-03-01T00:00:00.000+07:00");
    const dueDate = new Date("2026-03-05T00:00:00.000+07:00");

    const { deliveryId } = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate,
      dueDate,
      idempotencyKey: `${token}-dates`,
    });

    const dlv = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: deliveryId } });

    /* The seeded store has paymentTempo 30, so a derived due date would be 31 Mar, not 5 Mar. */
    expect(dlv.invoiceDate.toISOString()).toBe(invoiceDate.toISOString());
    expect(dlv.dueDate.toISOString()).toBe(dueDate.toISOString());
  });

  it("refuses a due date earlier than the invoice date", async () => {
    await expect(
      recordFieldSalesDelivery({
        orderId,
        deliveredById: userId,
        lines: [{ orderLineId: lineAId, qty: 1 }],
        invoiceDate: new Date("2026-03-10T00:00:00.000+07:00"),
        dueDate: new Date("2026-03-09T00:00:00.000+07:00"),
        idempotencyKey: `${token}-inverted`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATES" });
  });

  it("replays an idempotencyKey without creating a second delivery or moving stock", async () => {
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
      idempotencyKey: `dlv-idem-${token}`,
    });
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
      idempotencyKey: `dlv-idem-${token}`,
    });
    const all = await prisma.fieldSalesDelivery.findMany({ where: { orderId: seededId(orderId) } });
    expect(all).toHaveLength(1);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(8);
  });

  it("refuses to deliver an order that is not APPROVED", async () => {
    await prisma.fieldSalesOrder.update({ where: { id: orderId }, data: { status: "PENDING_APPROVAL" } });
    const err = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    }).catch((e) => e);
    expect(err.code).toBe("INVALID_STATE");
  });

  it("closing the remainder releases only the unconsumed reservation and sets CLOSED", async () => {
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    await closeFieldSalesOrderRemainder({ orderId, closedById: userId, reason: "stok habis" });
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.reservedQty)).toBe(0);
    expect(Number(inv.qtyOnHand)).toBe(8);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("CLOSED");
  });

  it("stamps the closure reason and its author, leaving the salesman's note alone", async () => {
    await prisma.fieldSalesOrder.update({ where: { id: orderId }, data: { note: "titip di kasir" } });
    await closeFieldSalesOrderRemainder({ orderId, closedById: userId, reason: "stok habis" });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.closeReason).toBe("stok habis");
    expect(order.closedById).toBe(userId);
    expect(order.closedAt).not.toBeNull();
    expect(order.note).toBe("titip di kasir");
  });

  it("creates a receivable for the delivery at full outstanding", async () => {
    const res = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });

    const receivable = await prisma.receivable.findUnique({ where: { deliveryId: res.deliveryId } });
    expect(receivable).not.toBeNull();
    expect(Number(receivable!.originalAmount)).toBe(2000);
    expect(Number(receivable!.outstandingAmount)).toBe(2000);
    expect(Number(receivable!.paidAmount)).toBe(0);
    expect(receivable!.status).toBe("OUTSTANDING");
    expect(receivable!.storeId).toBe(storeId);
    expect(receivable!.invoiceDate.getTime()).toBe(defaultInvoiceDate.getTime());
    expect(receivable!.dueDate.getTime()).toBe(defaultDueDate.getTime());
  });

  it("writes the delivery cogsAmount from the consumed avg cost", async () => {
    const res = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });

    const delivery = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: res.deliveryId } });
    expect(Number(delivery.cogsAmount)).toBe(1000);
    expect(Number(delivery.total)).toBe(2000);
  });

  it("gives each delivery of the same order its own receivable", async () => {
    const first = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    const second = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });

    const rows = await prisma.receivable.findMany({
      where: { deliveryId: { in: [first.deliveryId, second.deliveryId] } },
    });
    expect(rows).toHaveLength(2);
  });
});

d("recordFieldSalesDelivery — two distinct items in one call (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemAId = "";
  let itemBId = "";
  let invAId = "";
  let invBId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineAId = "";
  let lineBId = "";

  beforeEach(async () => {
    uomId = ""; itemAId = ""; itemBId = ""; invAId = ""; invBId = ""; storeId = ""; userId = ""; orderId = ""; lineAId = ""; lineBId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-FSD2-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const itemA = await prisma.item.create({
      data: { sku: `TEST-FSD2-A-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemAId = itemA.id;
    const itemB = await prisma.item.create({
      data: { sku: `TEST-FSD2-B-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 2000 },
    });
    itemBId = itemB.id;

    const invA = await prisma.inventoryValue.create({
      data: { itemId: itemAId, variantSku: "", qtyOnHand: 10, reservedQty: 3, avgCost: 500, totalValue: 5000 },
    });
    invAId = invA.id;
    const invB = await prisma.inventoryValue.create({
      data: { itemId: itemBId, variantSku: "", qtyOnHand: 10, reservedQty: 4, avgCost: 800, totalValue: 8000 },
    });
    invBId = invB.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSD2-STORE-${token}`, name: "Test FSD2 Store", address: "Test address", termsType: "PUTUS", paymentTempo: 14, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-fsd2-${token}@example.com`, name: "Test FSD2 Salesman" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSD2-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 11000,
        total: 11000,
        lines: {
          create: [
            { itemId: itemAId, variantSku: "", productName: "Test FSD2 Product A", qty: 3, unitPrice: 1000, lineTotal: 3000 },
            { itemId: itemBId, variantSku: "", productName: "Test FSD2 Product B", qty: 4, unitPrice: 2000, lineTotal: 8000 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineAId = order.lines.find((l) => l.itemId === itemAId)!.id;
    lineBId = order.lines.find((l) => l.itemId === itemBId)!.id;

    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineAId, itemId: itemAId, variantSku: "", qty: 3, state: "RESERVED" },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineBId, itemId: itemBId, variantSku: "", qty: 4, state: "RESERVED" },
    });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.receivable.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: { in: [seededId(invAId), seededId(invBId)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemAId), seededId(itemBId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("delivering two lines on two distinct items in one call writes one correctly-shaped SalesHistory row per item", async () => {
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [
        { orderLineId: lineAId, qty: 3 },
        { orderLineId: lineBId, qty: 4 },
      ],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });

    const rows = await prisma.salesHistory.findMany({ where: { itemId: { in: [itemAId, itemBId] } } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.channel).toBe("OFFLINE");
      expect(row.orderStatus).toBe("COMPLETED");
      expect(row.importBatchId).toBeNull();
    }
    const rowA = rows.find((r) => r.itemId === itemAId)!;
    const rowB = rows.find((r) => r.itemId === itemBId)!;
    expect(rowA.quantity).toBe(3);
    expect(Number(rowA.lineTotal)).toBe(3000);
    expect(rowB.quantity).toBe(4);
    expect(Number(rowB.lineTotal)).toBe(8000);

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("DELIVERED");
  });
});

d("recordFieldSalesDelivery — discount allocation across two deliveries (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; invId = ""; storeId = ""; userId = ""; orderId = ""; lineId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-FSD3-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FSD3-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 10, avgCost: 500, totalValue: 5000 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSD3-STORE-${token}`, name: "Test FSD3 Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-fsd3-${token}@example.com`, name: "Test FSD3 Salesman" },
    });
    userId = user.id;

    /* Line-level 1000 discount (10% of 10000) + an order-level 500 on top: total = 10000-1000-500 = 8500. */
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSD3-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 10000,
        total: 8500,
        orderDiscountAmount: 500,
        lines: {
          create: [{ itemId, variantSku: "", productName: "Test FSD3 Product", qty: 10, unitPrice: 1000, lineTotal: 10000, discountAmount: 1000 }],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;

    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty: 10, state: "RESERVED" },
    });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.receivable.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("a partial delivery then the closing delivery split the discount exactly, and SalesHistory is net of it", async () => {
    /* Delivery 1: 6 of 10 — pro-rated share. 10% line discount → 600; order discount pro-rata → 300. */
    const d1 = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineId, qty: 6 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    /* Delivery 2: the remaining 4 — closes the order, so it takes whatever discount is left over exactly. */
    const d2 = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineId, qty: 4 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });

    const delivery1 = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: d1.deliveryId } });
    const delivery2 = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: d2.deliveryId } });
    expect(Number(delivery1.discountAmount)).toBe(300);
    expect(Number(delivery2.discountAmount)).toBe(200);
    expect(Number(delivery1.discountAmount) + Number(delivery2.discountAmount)).toBe(500); /* == order.orderDiscountAmount */

    const deliveryLines1 = await prisma.fieldSalesDeliveryLine.findMany({ where: { deliveryId: d1.deliveryId } });
    const deliveryLines2 = await prisma.fieldSalesDeliveryLine.findMany({ where: { deliveryId: d2.deliveryId } });
    expect(Number(deliveryLines1[0].discountAmount) + Number(deliveryLines2[0].discountAmount)).toBe(1000); /* == line.discountAmount */

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("DELIVERED");

    const hist1 = await prisma.salesHistory.findFirst({ where: { orderId: d1.docNo } });
    expect(Number(hist1!.unitPriceAfterDiscount)).toBe(900); /* (6000 - 600) / 6 */
    expect(Number(hist1!.lineTotal)).toBe(5400);
    expect(Number(hist1!.orderTotal)).toBe(5100); /* delivery 1's own total: 6000 - 600 - 300 */

    const hist2 = await prisma.salesHistory.findFirst({ where: { orderId: d2.docNo } });
    expect(Number(hist2!.unitPriceAfterDiscount)).toBe(900); /* (4000 - 400) / 4 */
    expect(Number(hist2!.lineTotal)).toBe(3600);
    expect(Number(hist2!.orderTotal)).toBe(3400); /* delivery 2's own total: 4000 - 400 - 200 */
  });
});

d("recordFieldSalesDelivery — residue on a line that finishes before the order does (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let lineAId = "";
  let lineBId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; invId = ""; storeId = ""; userId = ""; orderId = ""; lineAId = ""; lineBId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-FSD4-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FSD4-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 100 },
    });
    itemId = item.id;

    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 4, avgCost: 50, totalValue: 500 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSD4-STORE-${token}`, name: "Test FSD4 Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-fsd4-${token}@example.com`, name: "Test FSD4 Salesman" },
    });
    userId = user.id;

    /*
     * Line A carries the whole 100 discount over 3 units, so shipping it one unit at a time
     * allocates round(100/3) = 33 three times and leaves 1 behind. Line B ships last and is the
     * only line in the delivery that closes the order.
     */
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSD4-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 400,
        total: 300,
        lines: {
          create: [
            { itemId, variantSku: "", productName: "Test FSD4 Product A", qty: 3, unitPrice: 100, lineTotal: 300, discountAmount: 100 },
            { itemId, variantSku: "", productName: "Test FSD4 Product B", qty: 1, unitPrice: 100, lineTotal: 100 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineAId = order.lines.find((l) => l.productName === "Test FSD4 Product A")!.id;
    lineBId = order.lines.find((l) => l.productName === "Test FSD4 Product B")!.id;

    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineAId, itemId, variantSku: "", qty: 3, state: "RESERVED" },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineBId, itemId, variantSku: "", qty: 1, state: "RESERVED" },
    });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.receivable.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("the deliveries still sum to the order total when a line strands residue before the closing delivery", async () => {
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });
    const closing = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineBId, qty: 1 }],
      invoiceDate: defaultInvoiceDate,
      dueDate: defaultDueDate,
    });

    const deliveries = await prisma.fieldSalesDelivery.findMany({
      where: { orderId: seededId(orderId) },
      include: { lines: true },
    });
    expect(deliveries).toHaveLength(4);

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("DELIVERED");

    const totals = deliveries.reduce((sum, d) => sum + Number(d.total), 0);
    expect(totals).toBe(Number(order.total));

    const lineDiscounts = deliveries.flatMap((d) => d.lines).reduce((sum, l) => sum + Number(l.discountAmount), 0);
    const headerDiscounts = deliveries.reduce((sum, d) => sum + Number(d.discountAmount), 0);
    expect(lineDiscounts + headerDiscounts).toBe(100);

    /* Line A's stranded rupiah lands on the closing delivery's header, not on line B. */
    const closingRow = deliveries.find((d) => d.id === closing.deliveryId)!;
    expect(Number(closingRow.discountAmount)).toBe(1);
    expect(Number(closingRow.lines[0].discountAmount)).toBe(0);
  });
});
