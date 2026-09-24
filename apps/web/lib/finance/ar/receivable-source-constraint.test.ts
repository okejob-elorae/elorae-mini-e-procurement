import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("Receivable / TaxInvoice exactly-one-source CHECK (test bed only)", () => {
  let token = "";
  let storeId = "";
  let userId = "";
  let orderId = "";
  let deliveryId = "";
  let sellThroughId = "";
  let receivableId = "";
  let taxInvoiceId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = "";
    userId = "";
    orderId = "";
    deliveryId = "";
    sellThroughId = "";
    receivableId = "";
    taxInvoiceId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-RSC-${token}`, name: `Toko ${token}`, address: "test", termsType: "KONSI" },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `rsc-${token}@test.local`, name: `Sales ${token}` },
    });
    userId = user.id;

    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-RSC-ORD-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    orderId = order.id;

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-RSC-DLV-${token}`,
        orderId,
        deliveredAt: new Date("2026-05-20T00:00:00.000+07:00"),
        deliveredById: userId,
        invoiceDate: new Date("2026-05-20T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-20T00:00:00.000+07:00"),
        subtotal: 1000,
        total: 1000,
      },
    });
    deliveryId = delivery.id;

    const sellThrough = await prisma.konsiSellThrough.create({
      data: {
        docNo: `TEST-RSC-KST-${token}`,
        storeId,
        method: "SPG_POS",
        closingStocktakeId: `TEST-RSC-STK-${token}`,
        periodEnd: new Date("2026-05-31T00:00:00.000+07:00"),
        createdById: userId,
      },
    });
    sellThroughId = sellThrough.id;
  });

  afterEach(async () => {
    /* Children of the 1:1 relation to KonsiSellThrough (and to FieldSalesDelivery) must go before
     * their parents. Only the "only sellThroughId succeeds" tests actually persist a row here --
     * the "neither"/"both" cases are expected to throw and never commit anything. */
    await prisma.taxInvoice.deleteMany({ where: { id: seededId(taxInvoiceId) } });
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.konsiSellThrough.deleteMany({ where: { id: seededId(sellThroughId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("rejects a receivable with neither deliveryId nor sellThroughId", async () => {
    await expect(
      prisma.receivable.create({
        data: {
          storeId,
          invoiceDate: new Date("2026-05-20T00:00:00.000+07:00"),
          dueDate: new Date("2026-06-20T00:00:00.000+07:00"),
          originalAmount: 100,
          outstandingAmount: 100,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a receivable with both deliveryId and sellThroughId", async () => {
    await expect(
      prisma.receivable.create({
        data: {
          deliveryId,
          sellThroughId,
          storeId,
          invoiceDate: new Date("2026-05-20T00:00:00.000+07:00"),
          dueDate: new Date("2026-06-20T00:00:00.000+07:00"),
          originalAmount: 100,
          outstandingAmount: 100,
        },
      }),
    ).rejects.toThrow();
  });

  it("accepts a receivable with only sellThroughId", async () => {
    const receivable = await prisma.receivable.create({
      data: {
        sellThroughId,
        storeId,
        invoiceDate: new Date("2026-05-20T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-20T00:00:00.000+07:00"),
        originalAmount: 100,
        outstandingAmount: 100,
      },
    });
    receivableId = receivable.id;
    expect(receivable.deliveryId).toBeNull();
    expect(receivable.sellThroughId).toBe(sellThroughId);
  });

  it("rejects a tax invoice with neither deliveryId nor sellThroughId", async () => {
    await expect(prisma.taxInvoice.create({ data: {} })).rejects.toThrow();
  });

  it("rejects a tax invoice with both deliveryId and sellThroughId", async () => {
    await expect(
      prisma.taxInvoice.create({ data: { deliveryId, sellThroughId } }),
    ).rejects.toThrow();
  });

  it("accepts a tax invoice with only sellThroughId", async () => {
    const taxInvoice = await prisma.taxInvoice.create({ data: { sellThroughId } });
    taxInvoiceId = taxInvoice.id;
    expect(taxInvoice.deliveryId).toBeNull();
    expect(taxInvoice.sellThroughId).toBe(sellThroughId);
  });
});
