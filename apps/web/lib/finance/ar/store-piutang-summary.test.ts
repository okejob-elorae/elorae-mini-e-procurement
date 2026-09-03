import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getStorePiutangSummary } from "./queries";
import { AGING_BUCKETS } from "./aging";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getStorePiutangSummary (test bed only)", () => {
  /*
   * Regenerated per test, not once per describe, same reasoning as queries.test.ts: Store.code /
   * FieldSalesOrder.orderNo / FieldSalesDelivery.docNo are all @unique on this token, and a single
   * leaked afterEach (fixture ids stay "" on a hook failure, so the teardown deletes nothing) would
   * otherwise make every remaining test in this file fail with P2002 on the shared bed.
   */
  let token = "";
  let storeAId = "";
  let storeBId = "";
  let userId = "";
  let seq = 0;
  const orderIds: string[] = [];
  const deliveryIds: string[] = [];
  const receivableIds: string[] = [];

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeAId = "";
    storeBId = "";
    userId = "";
    seq = 0;
    orderIds.length = 0;
    deliveryIds.length = 0;
    receivableIds.length = 0;

    const storeA = await prisma.store.create({
      data: { code: `TEST-PTG-A-${token}`, name: `Toko A ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeAId = storeA.id;

    const storeB = await prisma.store.create({
      data: { code: `TEST-PTG-B-${token}`, name: `Toko B ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeBId = storeB.id;

    const user = await prisma.user.create({ data: { email: `ptg-${token}@test.local`, name: `Sales ${token}` } });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.receivable.deleteMany({ where: { id: { in: receivableIds.length ? receivableIds : [""] } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds.length ? deliveryIds : [""] } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds.length ? orderIds : [""] } } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeAId), seededId(storeBId)] } } });
  });

  /*
   * Receivable.delivery is a REQUIRED relation under relationMode="prisma" — a deliveryId that does
   * not resolve to a real FieldSalesDelivery throws "Inconsistent query result" the moment a query
   * selects through it (getStorePiutangSummary goes through listReceivables, which does). So every
   * seeded row needs a real Store -> FieldSalesOrder -> FieldSalesDelivery -> Receivable chain, the
   * same shape credit-exposure.test.ts and queries.test.ts already use for this exact model.
   */
  async function makeReceivable(opts: {
    storeId: string;
    outstanding: number;
    dueDate: Date;
    status?: "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF";
    originalAmount?: number;
  }): Promise<string> {
    seq += 1;
    const original = opts.originalAmount ?? Math.max(opts.outstanding, 1);

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-PTG-ORD-${token}-${seq}`,
        storeId: opts.storeId,
        salesmanId: userId,
        status: "APPROVED",
        subtotal: original,
        total: original,
      },
    });
    orderIds.push(order.id);

    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-PTG-DLV-${token}-${seq}`,
        orderId: order.id,
        deliveredAt: new Date(),
        deliveredById: userId,
        invoiceDate: new Date(),
        dueDate: opts.dueDate,
        subtotal: original,
        total: original,
      },
    });
    deliveryIds.push(delivery.id);

    const receivable = await prisma.receivable.create({
      data: {
        deliveryId: delivery.id,
        storeId: opts.storeId,
        invoiceDate: new Date(),
        dueDate: opts.dueDate,
        originalAmount: original,
        outstandingAmount: opts.outstanding,
        status: opts.status ?? "OUTSTANDING",
      },
    });
    receivableIds.push(receivable.id);
    return receivable.id;
  }

  it("returns zeros for a store with no receivables", async () => {
    const summary = await getStorePiutangSummary(storeAId);
    expect(summary.grandOutstanding).toBe(0);
    expect(summary.openCount).toBe(0);
    expect(summary.rows).toEqual([]);
    for (const bucket of AGING_BUCKETS) {
      expect(summary.bucketTotals[bucket]).toBe(0);
    }
  });

  it("includes OUTSTANDING and PARTIAL rows sorted by due date ascending", async () => {
    const outstandingId = await makeReceivable({
      storeId: storeAId,
      outstanding: 1000,
      dueDate: new Date("2026-09-20T00:00:00.000+07:00"),
      status: "OUTSTANDING",
    });
    const partialId = await makeReceivable({
      storeId: storeAId,
      outstanding: 400,
      originalAmount: 1000,
      dueDate: new Date("2026-09-10T00:00:00.000+07:00"),
      status: "PARTIAL",
    });

    const summary = await getStorePiutangSummary(storeAId);
    expect(summary.openCount).toBe(2);
    /* partialId is due 2026-09-10, outstandingId is due 2026-09-20 — sooner due date sorts first. */
    expect(summary.rows.map((r) => r.id)).toEqual([partialId, outstandingId]);
    expect(summary.grandOutstanding).toBeCloseTo(1400);
  });

  it("excludes PAID receivables from rows and totals", async () => {
    await makeReceivable({
      storeId: storeAId,
      outstanding: 0,
      originalAmount: 500,
      dueDate: new Date(),
      status: "PAID",
    });
    const openId = await makeReceivable({
      storeId: storeAId,
      outstanding: 700,
      dueDate: new Date(),
      status: "OUTSTANDING",
    });

    const summary = await getStorePiutangSummary(storeAId);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].id).toBe(openId);
    expect(summary.openCount).toBe(1);
    expect(summary.grandOutstanding).toBe(700);
  });

  it("caps rows at `take` while openCount reports the true total", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      /* Distinct dueDates, ascending, so the expected first-5 slice is deterministic. */
      const dueDate = new Date(Date.UTC(2026, 8, i + 1));
      ids.push(await makeReceivable({ storeId: storeAId, outstanding: 100, dueDate, status: "OUTSTANDING" }));
    }

    const summary = await getStorePiutangSummary(storeAId, new Date(), 5);
    expect(summary.rows).toHaveLength(5);
    expect(summary.openCount).toBe(6);
    expect(summary.rows.map((r) => r.id)).toEqual(ids.slice(0, 5));
  });

  it("never mixes another store's receivables into the summary", async () => {
    const idA = await makeReceivable({ storeId: storeAId, outstanding: 500, dueDate: new Date(), status: "OUTSTANDING" });
    await makeReceivable({ storeId: storeBId, outstanding: 900, dueDate: new Date(), status: "OUTSTANDING" });

    const summaryA = await getStorePiutangSummary(storeAId);
    expect(summaryA.rows).toHaveLength(1);
    expect(summaryA.rows[0].id).toBe(idA);
    expect(summaryA.openCount).toBe(1);
    expect(summaryA.grandOutstanding).toBe(500);
  });
});
