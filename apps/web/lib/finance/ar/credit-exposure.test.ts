import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { computeStoreCreditExposure } from "./credit-exposure";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("computeStoreCreditExposure (test bed only)", () => {
  let token = "";
  let storeId = "";
  let userId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; userId = "";
    const store = await prisma.store.create({
      data: { code: `TEST-CEX-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const user = await prisma.user.create({ data: { email: `cex-${token}@test.local`, name: `Sales ${token}` } });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.receivable.deleteMany({ where: { storeId } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { delivery: { order: { storeId } } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { order: { storeId } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { order: { storeId } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.item.deleteMany({ where: { sku: { startsWith: `TEST-CEX-ITEM-${token}` } } });
    await prisma.uOM.deleteMany({ where: { code: `TEST-CEX-UOM-${token}` } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function makeDeliveredOrder(opts: { orderTotal: number; deliveryTotal: number; recStatus: "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF"; outstanding: number }) {
    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-CEX-ORD-${token}-${Math.random().toString(36).slice(2, 8)}`, storeId, salesmanId: userId, status: "APPROVED", subtotal: opts.orderTotal, total: opts.orderTotal },
    });
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-CEX-DLV-${token}-${Math.random().toString(36).slice(2, 8)}`,
        orderId: order.id, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date(),
        subtotal: opts.deliveryTotal, total: opts.deliveryTotal,
      },
    });
    await prisma.receivable.create({
      data: {
        deliveryId: delivery.id, storeId,
        invoiceDate: new Date(), dueDate: new Date(),
        originalAmount: opts.deliveryTotal, outstandingAmount: opts.outstanding, status: opts.recStatus,
      },
    });
    return order.id;
  }

  it("a store with neither receivables nor approved orders has zero exposure", async () => {
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure).toEqual({ receivableOutstanding: 0, undeliveredOrderResidual: 0, total: 0 });
  });

  it("sums OUTSTANDING and PARTIAL receivables, excludes WRITTEN_OFF and PAID", async () => {
    await makeDeliveredOrder({ orderTotal: 100_000, deliveryTotal: 100_000, recStatus: "OUTSTANDING", outstanding: 100_000 });
    await makeDeliveredOrder({ orderTotal: 50_000, deliveryTotal: 50_000, recStatus: "PARTIAL", outstanding: 20_000 });
    await makeDeliveredOrder({ orderTotal: 30_000, deliveryTotal: 30_000, recStatus: "WRITTEN_OFF", outstanding: 30_000 });
    await makeDeliveredOrder({ orderTotal: 10_000, deliveryTotal: 10_000, recStatus: "PAID", outstanding: 0 });

    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.receivableOutstanding).toBe(120_000);
    expect(exposure.undeliveredOrderResidual).toBe(0);
    expect(exposure.total).toBe(120_000);
  });

  it("residual is order.total minus its deliveries' total, for an APPROVED order with a partial delivery", async () => {
    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-CEX-ORD-${token}-partial`, storeId, salesmanId: userId, status: "APPROVED", subtotal: 100_000, total: 100_000 },
    });
    await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-CEX-DLV-${token}-partial`, orderId: order.id, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date(), subtotal: 40_000, total: 40_000,
      },
    });
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.receivableOutstanding).toBe(0);
    expect(exposure.undeliveredOrderResidual).toBe(60_000);
    expect(exposure.total).toBe(60_000);
  });

  it("an over-delivered order's residual floors at zero per order, never lending negative headroom to a sibling", async () => {
    // Order A: over-delivered (would be negative residual if not floored).
    const orderA = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-CEX-ORD-${token}-A`, storeId, salesmanId: userId, status: "APPROVED", subtotal: 50_000, total: 50_000 },
    });
    await prisma.fieldSalesDelivery.create({
      data: { docNo: `TEST-CEX-DLV-${token}-A`, orderId: orderA.id, deliveredAt: new Date(), deliveredById: userId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 70_000, total: 70_000 },
    });
    // Order B: undelivered, genuine positive residual.
    const orderB = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-CEX-ORD-${token}-B`, storeId, salesmanId: userId, status: "APPROVED", subtotal: 30_000, total: 30_000 },
    });

    const exposure = await computeStoreCreditExposure(prisma, storeId);
    // If unfloored: (50k - 70k) + (30k - 0) = 10k. Floored per order: 0 + 30k = 30k.
    expect(exposure.undeliveredOrderResidual).toBe(30_000);
  });

  it("a PENDING_APPROVAL order contributes no residual", async () => {
    await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-CEX-ORD-${token}-pending`, storeId, salesmanId: userId, status: "PENDING_APPROVAL", subtotal: 100_000, total: 100_000 },
    });
    const exposure = await computeStoreCreditExposure(prisma, storeId);
    expect(exposure.undeliveredOrderResidual).toBe(0);
  });

  it("a closeFieldSalesOrderRemainder'd order stops contributing residual for its written-off remainder — only the delivered portion's receivable counts", async () => {
    /*
     * Regression for the bug where a closed remainder's residual (order.total - delivered)
     * was counted forever, because closeFieldSalesOrderRemainder never changes order.total or
     * order.status — it only settles the lines (deliveredQty/cancelledQty) and flips
     * deliveryStatus to CLOSED. Mirrors that writer's exact end state rather than guessing at
     * the enum value: 40 of 100 units delivered (real delivery + receivable), the remaining 60
     * cancelled, deliveryStatus CLOSED.
     */
    const uom = await prisma.uOM.create({ data: { code: `TEST-CEX-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    const item = await prisma.item.create({
      data: { sku: `TEST-CEX-ITEM-${token}`, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId: uom.id, isActive: true, sellingPrice: 1000 },
    });

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-CEX-ORD-${token}-closed`, storeId, salesmanId: userId, status: "APPROVED", orderType: "PUTUS",
        subtotal: 100_000, total: 100_000,
        lines: { create: [{ itemId: item.id, variantSku: "", productName: "T", qty: 100, unitPrice: 1000, lineTotal: 100_000 }] },
      },
      include: { lines: true },
    });
    const line = order.lines[0];

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-CEX-DLV-${token}-closed`, orderId: order.id, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date(), subtotal: 40_000, total: 40_000,
        lines: { create: [{ orderLineId: line.id, itemId: item.id, variantSku: "", productName: "T", qty: 40 }] },
      },
    });
    await prisma.receivable.create({
      data: {
        deliveryId: delivery.id, storeId, invoiceDate: new Date(), dueDate: new Date(),
        originalAmount: 40_000, outstandingAmount: 40_000, status: "OUTSTANDING",
      },
    });
    await prisma.fieldSalesOrderLine.update({ where: { id: line.id }, data: { deliveredQty: 40, cancelledQty: 60 } });
    await prisma.fieldSalesOrder.update({
      where: { id: order.id },
      data: { deliveryStatus: "CLOSED", closedAt: new Date(), closedById: userId, closeReason: "test" },
    });

    const exposure = await computeStoreCreditExposure(prisma, storeId);
    // Before the fix: undeliveredOrderResidual would be 100_000 - 40_000 = 60_000 forever, total 100_000.
    expect(exposure.receivableOutstanding).toBe(40_000);
    expect(exposure.undeliveredOrderResidual).toBe(0);
    expect(exposure.total).toBe(40_000);
  });
});
