import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getFieldSalesOrderById } from "../queries";
import { recordFieldSalesDelivery } from "./writer";

/**
 * Read-only query under test, but the fixture drives a real delivery through the writer, which
 * moves stock — never run against the shared prod DB (port 3307 tunnel / VPS host).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getFieldSalesOrderById — deliveries (test bed only)", () => {
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
      data: { code: `TEST-UOM-FSDQ-${token}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FSDQ-${token}`, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 1000 },
    });
    itemId = item.id;

    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 10, avgCost: 500, totalValue: 5000 },
    });
    invId = inv.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FSDQ-STORE-${token}`, name: "Test FSDQ Store", address: "Test address", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `test-fsdq-${token}@example.com`, name: "Test FSDQ Salesman" },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-FSDQ-${token}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 10000,
        total: 10000,
        lines: {
          create: [
            { itemId, variantSku: "", productName: "Test FSDQ Product A", qty: 5, unitPrice: 1000, lineTotal: 5000 },
            { itemId, variantSku: "", productName: "Test FSDQ Product B", qty: 5, unitPrice: 1000, lineTotal: 5000 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineAId = order.lines.find((l) => l.productName === "Test FSDQ Product A")!.id;
    lineBId = order.lines.find((l) => l.productName === "Test FSDQ Product B")!.id;

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

  it("exposes one delivery with coerced numeric totals and the right outstanding/onHand after a partial delivery", async () => {
    const { docNo } = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: lineAId, qty: 2 }],
    });

    const detail = await getFieldSalesOrderById(orderId);
    expect(detail).not.toBeNull();
    expect(detail!.deliveryStatus).toBe("PARTIAL");

    expect(detail!.deliveries).toHaveLength(1);
    const delivery = detail!.deliveries[0];
    expect(delivery.docNo).toBe(docNo);
    /* Decimal-leak guard: every money field must already be a plain number, not a Prisma.Decimal. */
    expect(typeof delivery.subtotal).toBe("number");
    expect(typeof delivery.discountAmount).toBe("number");
    expect(typeof delivery.total).toBe("number");
    expect(delivery.subtotal).toBe(2000);
    expect(delivery.discountAmount).toBe(0);
    expect(delivery.total).toBe(2000);
    expect(delivery.deliveredByName).toBe("Test FSDQ Salesman");

    expect(delivery.lines).toHaveLength(1);
    const deliveryLine = delivery.lines[0];
    expect(deliveryLine.orderLineId).toBe(lineAId);
    expect(deliveryLine.qty).toBe(2);
    expect(typeof deliveryLine.unitPrice).toBe("number");
    expect(deliveryLine.unitPrice).toBe(1000);
    expect(typeof deliveryLine.lineTotal).toBe("number");
    expect(deliveryLine.lineTotal).toBe(2000);

    const lineA = detail!.lines.find((l) => l.id === lineAId)!;
    expect(lineA.outstanding).toBe(3); /* 5 ordered - 2 delivered - 0 cancelled */
    expect(lineA.onHand).toBe(8); /* qtyOnHand 10 - 2 consumed by the delivery */

    const lineB = detail!.lines.find((l) => l.id === lineBId)!;
    expect(lineB.outstanding).toBe(5); /* untouched by the delivery */
    expect(lineB.onHand).toBe(8); /* same item + variant inventory row as line A */
  });

  it("reports full outstanding and raw on-hand for an order with no deliveries yet", async () => {
    const detail = await getFieldSalesOrderById(orderId);
    expect(detail!.deliveryStatus).toBe("PENDING");
    expect(detail!.deliveries).toEqual([]);
    const lineA = detail!.lines.find((l) => l.id === lineAId)!;
    expect(lineA.outstanding).toBe(5);
    expect(lineA.onHand).toBe(10);
    expect(lineA.available).toBe(0); /* qtyOnHand 10 - reservedQty 10 */
  });
});
