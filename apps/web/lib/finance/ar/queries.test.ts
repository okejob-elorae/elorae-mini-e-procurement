import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listReceivables, getReceivable } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const asOf = new Date("2026-06-01T00:00:00.000+07:00");

d("AR queries (test bed only)", () => {
  /*
   * Regenerated per test, not once per describe: Store.code / FieldSalesOrder.orderNo /
   * FieldSalesDelivery.docNo / Receivable.deliveryId are all @unique on this token. A single leaked
   * afterEach (fixture ids stay "" on a hook failure, so the teardown deletes nothing) would
   * otherwise make every remaining test in this file fail with P2002 in beforeEach on the shared
   * bed, for the rest of the run.
   */
  let token = "";
  let storeId = "";
  let salesmanId = "";
  let orderAId = "";
  let orderBId = "";
  let deliveryAId = "";
  let deliveryBId = "";
  let currentRec = "";
  let overdueRec = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; salesmanId = ""; orderAId = ""; orderBId = "";
    deliveryAId = ""; deliveryBId = ""; currentRec = ""; overdueRec = "";

    const store = await prisma.store.create({
      data: { code: `TEST-ARQ-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const salesman = await prisma.user.create({
      data: { email: `arq-${token}@test.local`, name: `Sales ${token}` },
    });
    salesmanId = salesman.id;

    /*
     * Receivable.delivery is a REQUIRED relation under relationMode="prisma" — a deliveryId that
     * does not resolve to a real FieldSalesDelivery throws "Inconsistent query result" the moment a
     * query selects through it, which both listReceivables and getReceivable do (docNo,
     * order.salesman.name). So the delivery/order chain has to be real rows, not a fake string id.
     */
    const orderA = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARQ-ORD1-${token}`, storeId, salesmanId, subtotal: 1000, total: 1000 },
    });
    orderAId = orderA.id;

    const deliveryA = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARQ-DLV1-${token}`,
        orderId: orderAId,
        deliveredAt: new Date("2026-05-20T00:00:00.000+07:00"),
        deliveredById: salesmanId,
        invoiceDate: new Date("2026-05-20T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-20T00:00:00.000+07:00"),
        subtotal: 1000,
        total: 1000,
      },
    });
    deliveryAId = deliveryA.id;

    const a = await prisma.receivable.create({
      data: {
        deliveryId: deliveryAId, storeId,
        invoiceDate: new Date("2026-05-20T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-20T00:00:00.000+07:00"),
        originalAmount: 1000, outstandingAmount: 1000,
      },
    });
    currentRec = a.id;

    const orderB = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARQ-ORD2-${token}`, storeId, salesmanId, subtotal: 500, total: 500 },
    });
    orderBId = orderB.id;

    const deliveryB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARQ-DLV2-${token}`,
        orderId: orderBId,
        deliveredAt: new Date("2026-04-01T00:00:00.000+07:00"),
        deliveredById: salesmanId,
        invoiceDate: new Date("2026-04-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-05-01T00:00:00.000+07:00"),
        subtotal: 500,
        total: 500,
      },
    });
    deliveryBId = deliveryB.id;

    const b = await prisma.receivable.create({
      data: {
        deliveryId: deliveryBId, storeId,
        invoiceDate: new Date("2026-04-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-05-01T00:00:00.000+07:00"),
        originalAmount: 500, outstandingAmount: 500,
      },
    });
    overdueRec = b.id;
  });

  afterEach(async () => {
    await prisma.receivable.deleteMany({ where: { id: { in: [seededId(currentRec), seededId(overdueRec)] } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: [seededId(deliveryAId), seededId(deliveryBId)] } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: [seededId(orderAId), seededId(orderBId)] } } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("buckets a not-yet-due row as CURRENT and an overdue one by days past due", async () => {
    const res = await listReceivables({ storeId, asOf });
    const byId = new Map(res.rows.map((r) => [r.id, r]));
    expect(byId.get(currentRec)!.bucket).toBe("CURRENT");
    expect(byId.get(overdueRec)!.bucket).toBe("D31_60");
    expect(byId.get(overdueRec)!.daysOverdue).toBe(31);
  });

  it("totals outstanding per bucket and overall", async () => {
    const res = await listReceivables({ storeId, asOf });
    expect(res.bucketTotals.CURRENT).toBe(1000);
    expect(res.bucketTotals.D31_60).toBe(500);
    expect(res.grandOutstanding).toBe(1500);
  });

  it("filters by status", async () => {
    await prisma.receivable.update({ where: { id: currentRec }, data: { status: "PAID", outstandingAmount: 0 } });
    const res = await listReceivables({ storeId, status: "OUTSTANDING", asOf });
    expect(res.rows.map((r) => r.id)).toEqual([overdueRec]);
  });

  it("returns null for an unknown receivable", async () => {
    expect(await getReceivable(`missing-${token}`)).toBeNull();
  });
});
