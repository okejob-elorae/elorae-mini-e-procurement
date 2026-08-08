import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordFieldSalesDelivery, closeFieldSalesOrderRemainder } from "./writer";
import { DeliveryError } from "../errors";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

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
    });
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(8);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("PARTIAL");
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: lineAId } });
    expect(line.deliveredQty).toBe(2);
  });

  it("sets DELIVERED once every line is fully delivered", async () => {
    await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 5 }, { orderLineId: lineBId, qty: 5 }] });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("DELIVERED");
  });

  it("rejects a qty above outstanding and moves no stock", async () => {
    const err = await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 6 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.code).toBe("OVER_DELIVER");
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(10);
  });

  it("hard-blocks when on-hand is short and names every short line", async () => {
    await prisma.inventoryValue.update({ where: { id: invId }, data: { qtyOnHand: 1 } });
    const err = await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 5 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.code).toBe("INSUFFICIENT_STOCK");
    expect(err.shortLines).toHaveLength(1);
  });

  it("rejects an empty line set", async () => {
    const err = await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [] }).catch((e) => e);
    expect(err.code).toBe("NO_LINES");
  });

  it("writes SalesHistory for the delivered qty only, keyed and dated by the delivery", async () => {
    const first = await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 2 }] });
    const rows = await prisma.salesHistory.findMany({ where: { itemId: seededId(itemId) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].orderId).toBe(first.docNo);
  });

  it("does not collide on the SalesHistory unique key across two deliveries of the same variant", async () => {
    await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 2 }] });
    await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 3 }] });
    const rows = await prisma.salesHistory.findMany({ where: { itemId: seededId(itemId) } });
    expect(rows).toHaveLength(2);
  });

  it("stamps a due date at the store's payment tempo", async () => {
    const { deliveryId } = await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 2 }] });
    const dlv = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const days = Math.round((dlv.dueDate.getTime() - dlv.invoiceDate.getTime()) / 86400000);
    expect(days).toBe(30);
  });

  it("replays an idempotencyKey without creating a second delivery or moving stock", async () => {
    await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 2 }], idempotencyKey: `dlv-idem-${token}` });
    await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 2 }], idempotencyKey: `dlv-idem-${token}` });
    const all = await prisma.fieldSalesDelivery.findMany({ where: { orderId: seededId(orderId) } });
    expect(all).toHaveLength(1);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(8);
  });

  it("refuses to deliver an order that is not APPROVED", async () => {
    await prisma.fieldSalesOrder.update({ where: { id: orderId }, data: { status: "PENDING_APPROVAL" } });
    const err = await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 1 }] }).catch((e) => e);
    expect(err.code).toBe("INVALID_STATE");
  });

  it("closing the remainder releases only the unconsumed reservation and sets CLOSED", async () => {
    await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: lineAId, qty: 2 }] });
    await closeFieldSalesOrderRemainder({ orderId, closedById: userId, reason: "stok habis" });
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.reservedQty)).toBe(0);
    expect(Number(inv.qtyOnHand)).toBe(8);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.deliveryStatus).toBe("CLOSED");
  });
});
