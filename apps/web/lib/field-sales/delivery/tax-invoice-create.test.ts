import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordFieldSalesDelivery } from "./writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("recordFieldSalesDelivery creates its TaxInvoice (test bed only)", () => {
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
      data: { code: `TEST-UOM-TXI-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-TXI-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 10, avgCost: 500, totalValue: 5000 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-TXI-STORE-${token}`, name: "Test TXI Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-txi-${token}@example.com`, name: "Test TXI Salesman" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-TXI-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 10000,
        total: 10000,
        lines: {
          create: [
            { itemId, variantSku: "", productName: "Test TXI Product A", qty: 5, unitPrice: 1000, lineTotal: 5000 },
            { itemId, variantSku: "", productName: "Test TXI Product B", qty: 5, unitPrice: 1000, lineTotal: 5000 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineAId = order.lines.find((l) => l.productName === "Test TXI Product A")!.id;
    lineBId = order.lines.find((l) => l.productName === "Test TXI Product B")!.id;

    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineAId, itemId, variantSku: "", qty: 5, state: "RESERVED" },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineBId, itemId, variantSku: "", qty: 5, state: "RESERVED" },
    });
  });

  afterEach(async () => {
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
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

  it("creates exactly one PENDING TaxInvoice with the delivery", async () => {
    const { deliveryId } = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
      invoiceDate: new Date("2026-08-13T00:00:00.000Z"),
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
    });

    const rows = await prisma.taxInvoice.findMany({ where: { deliveryId: seededId(deliveryId) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].notaPrintedAt).toBeNull();
    expect(rows[0].invoiceNo).toBeNull();
  });

  it("an idempotencyKey replay does not create a second TaxInvoice", async () => {
    const key = `taxinv-${Date.now()}`;
    const first = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: new Date("2026-08-13T00:00:00.000Z"),
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
      idempotencyKey: key,
    });
    const second = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 1 }],
      invoiceDate: new Date("2026-08-13T00:00:00.000Z"),
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
      idempotencyKey: key,
    });

    expect(second.deliveryId).toBe(first.deliveryId);
    const rows = await prisma.taxInvoice.findMany({ where: { deliveryId: seededId(first.deliveryId) } });
    expect(rows).toHaveLength(1);
  });
});
