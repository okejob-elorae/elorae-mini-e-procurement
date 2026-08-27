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
    await prisma.fieldSalesDelivery.deleteMany({ where: { order: { storeId } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
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
});
