import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listReceivables, getReceivable, listPayments, getPayment, listAllocationCandidatesForStore } from "./queries";
import { recordPayment } from "./payment-writer";
import { voidPayment } from "./void-writer";

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
  let userId = "";
  let orderAId = "";
  let orderBId = "";
  let orderCId = "";
  let deliveryAId = "";
  let deliveryBId = "";
  let deliveryCId = "";
  let currentRec = "";
  let overdueRec = "";
  let thirdRec = "";
  /* Set inside whichever test records a payment; stays "" (unmatchable) for every other test. */
  let paymentId = "";
  /* Set only by the returOffsetFor test; stays "" (unmatchable) for every other test. */
  let fieldReturnId = "";
  let returItemId = "";
  let returUomId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; userId = ""; orderAId = ""; orderBId = ""; orderCId = "";
    deliveryAId = ""; deliveryBId = ""; deliveryCId = "";
    currentRec = ""; overdueRec = ""; thirdRec = ""; paymentId = "";
    fieldReturnId = ""; returItemId = ""; returUomId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-ARQ-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    /* One user plays salesman, delivery recipient, and payment recorder/voider — the fixture only
     * needs an actor to satisfy the FK, not a realistic org chart. */
    const user = await prisma.user.create({
      data: { email: `arq-${token}@test.local`, name: `Sales ${token}` },
    });
    userId = user.id;

    /*
     * Receivable.delivery is a REQUIRED relation under relationMode="prisma" — a deliveryId that
     * does not resolve to a real FieldSalesDelivery throws "Inconsistent query result" the moment a
     * query selects through it, which both listReceivables and getReceivable do (docNo,
     * order.salesman.name). So the delivery/order chain has to be real rows, not a fake string id.
     */
    const orderA = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARQ-ORD1-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    orderAId = orderA.id;

    const deliveryA = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARQ-DLV1-${token}`,
        orderId: orderAId,
        deliveredAt: new Date("2026-05-20T00:00:00.000+07:00"),
        deliveredById: userId,
        invoiceDate: new Date("2026-05-20T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-20T00:00:00.000+07:00"),
        subtotal: 1000,
        total: 1000,
      },
    });
    deliveryAId = deliveryA.id;

    /* CURRENT: due 2026-06-20, asOf 2026-06-01 — not yet due. */
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
      data: { orderNo: `TEST-ARQ-ORD2-${token}`, storeId, salesmanId: userId, subtotal: 500, total: 500 },
    });
    orderBId = orderB.id;

    const deliveryB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARQ-DLV2-${token}`,
        orderId: orderBId,
        deliveredAt: new Date("2026-04-01T00:00:00.000+07:00"),
        deliveredById: userId,
        invoiceDate: new Date("2026-04-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-05-01T00:00:00.000+07:00"),
        subtotal: 500,
        total: 500,
      },
    });
    deliveryBId = deliveryB.id;

    /* D31_60: due 2026-05-01, asOf 2026-06-01 — May has 31 days, so daysOverdue = 31 (> 30, <= 60). */
    const b = await prisma.receivable.create({
      data: {
        deliveryId: deliveryBId, storeId,
        invoiceDate: new Date("2026-04-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-05-01T00:00:00.000+07:00"),
        originalAmount: 500, outstandingAmount: 500,
      },
    });
    overdueRec = b.id;

    const orderC = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARQ-ORD3-${token}`, storeId, salesmanId: userId, subtotal: 300, total: 300 },
    });
    orderCId = orderC.id;

    const deliveryC = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARQ-DLV3-${token}`,
        orderId: orderCId,
        deliveredAt: new Date("2026-02-01T00:00:00.000+07:00"),
        deliveredById: userId,
        invoiceDate: new Date("2026-02-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-03-01T00:00:00.000+07:00"),
        subtotal: 300,
        total: 300,
      },
    });
    deliveryCId = deliveryC.id;

    /*
     * D91_120: due 2026-03-01, asOf 2026-06-01 — full March (31) + April (30) + May (31) = 92 days
     * (> 90, <= 120). Distinct from both other buckets, so it can be told apart from either.
     */
    const c = await prisma.receivable.create({
      data: {
        deliveryId: deliveryCId, storeId,
        invoiceDate: new Date("2026-02-01T00:00:00.000+07:00"),
        dueDate: new Date("2026-03-01T00:00:00.000+07:00"),
        originalAmount: 300, outstandingAmount: 300,
      },
    });
    thirdRec = c.id;
  });

  afterEach(async () => {
    /* Defensive, same as void-writer.test.ts: neither writer under test posts a journal itself, but
     * clean up the slot children-first in case that ever changes. */
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: seededId(paymentId) } } });
    await prisma.journal.deleteMany({ where: { sourceId: seededId(paymentId) } });
    await prisma.paymentAllocation.deleteMany({
      where: { receivableId: { in: [seededId(currentRec), seededId(overdueRec), seededId(thirdRec)] } },
    });
    /* fieldReturnId's line/return, and their item/uom, only exist for the returOffsetFor test —
     * children-first, and before `payment` since a FieldReturn points at its offset Payment. */
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(fieldReturnId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(fieldReturnId) } });
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(returItemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(returUomId) } });
    await prisma.receivable.deleteMany({
      where: { id: { in: [seededId(currentRec), seededId(overdueRec), seededId(thirdRec)] } },
    });
    await prisma.fieldSalesDelivery.deleteMany({
      where: { id: { in: [seededId(deliveryAId), seededId(deliveryBId), seededId(deliveryCId)] } },
    });
    await prisma.fieldSalesOrder.deleteMany({
      where: { id: { in: [seededId(orderAId), seededId(orderBId), seededId(orderCId)] } },
    });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
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
    expect(res.bucketTotals.D91_120).toBe(300);
    expect(res.grandOutstanding).toBe(1800);
  });

  it("filters by status", async () => {
    await prisma.receivable.update({ where: { id: currentRec }, data: { status: "PAID", outstandingAmount: 0 } });
    const res = await listReceivables({ storeId, status: "OUTSTANDING", asOf });
    /*
     * thirdRec is also OUTSTANDING (its status is never touched here), and its dueDate
     * (2026-03-01) sorts before overdueRec's (2026-05-01) under `orderBy: [{ dueDate: "asc" }, ...
     * ]`. Asserting both survivors, in order, still proves the PAID row (currentRec) is excluded —
     * and pins the dueDate-asc ordering, which nothing else in this file checks.
     */
    expect(res.rows.map((r) => r.id)).toEqual([thirdRec, overdueRec]);
  });

  it("returns null for an unknown receivable", async () => {
    expect(await getReceivable(`missing-${token}`)).toBeNull();
  });

  /*
   * GAP 1: with 3 seeded rows and pageSize 1, a single-paginated-query regression (folding the
   * totals into the same paginated fetch) would return a page of 1 for `rows` AND undercount the
   * totals to whatever's on that page. Asserting both together is what tells the two apart.
   */
  it("aggregates totals over the whole filtered set, not just the current page", async () => {
    const res = await listReceivables({ storeId, asOf, pageSize: 1 });
    expect(res.rows.length).toBe(1);
    expect(res.bucketTotals.CURRENT).toBe(1000);
    expect(res.bucketTotals.D31_60).toBe(500);
    expect(res.bucketTotals.D91_120).toBe(300);
    expect(res.grandOutstanding).toBe(1800);
  });

  /*
   * GAP 2: exercises the fetch-all/filter-in-JS/slice branch that only runs when `bucket` is set.
   * `rows`/`total`/`grandOutstanding` narrow to the selected bucket; `bucketTotals` deliberately
   * does NOT — the tiles are a readout of where the whole book's debt sits, and zeroing the
   * unselected ones made `AgingSummary` grey them out as empty, hiding real exposure. So the
   * assertions pull in opposite directions on purpose: 300 for the selected bucket AND the other
   * two seeded buckets still reporting their real money.
   */
  it("filters rows and grandOutstanding by bucket while every tile keeps its real total", async () => {
    const res = await listReceivables({ storeId, asOf, bucket: "D91_120" });
    expect(res.rows.map((r) => r.id)).toEqual([thirdRec]);
    expect(res.total).toBe(1);
    expect(res.grandOutstanding).toBe(300);
    expect(res.bucketTotals.D91_120).toBe(300);
    expect(res.bucketTotals.CURRENT).toBe(1000);
    expect(res.bucketTotals.D31_60).toBe(500);
  });

  /*
   * The sharpest version of the same rule: D1_30 holds nothing, so the table and
   * `grandOutstanding` are legitimately empty — but 1.800.000 of debt still exists and every tile
   * must keep saying so. A regression that re-applies the bucket filter to `bucketTotals` would
   * report an empty aging strip for a book that is 1.800.000 in the red.
   */
  it("returns nothing for a bucket with no matching rows, without blanking the tiles", async () => {
    const res = await listReceivables({ storeId, asOf, bucket: "D1_30" });
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.grandOutstanding).toBe(0);
    expect(res.bucketTotals.D1_30).toBe(0);
    expect(res.bucketTotals.CURRENT).toBe(1000);
    expect(res.bucketTotals.D31_60).toBe(500);
    expect(res.bucketTotals.D91_120).toBe(300);
  });

  /*
   * All three seeded rows share one store, so searching the store name would match all of them —
   * a substring of overdueRec's nota number (deliveryB's docNo) is what actually narrows to one
   * row. Lowercased against an all-uppercase docNo segment on purpose, to prove `contains` matches
   * case-insensitively off the column's collation rather than needing Prisma's Postgres-only
   * `mode: "insensitive"`. Asserting bucketTotals/grandOutstanding alongside rows/total is what
   * proves `search` reached the totals query through the shared `whereFor`, not just the row query.
   */
  it("narrows rows and totals when searching by nota number, case-insensitively", async () => {
    const res = await listReceivables({ storeId, asOf, search: `dlv2-${token}` });
    expect(res.rows.map((r) => r.id)).toEqual([overdueRec]);
    expect(res.total).toBe(1);
    expect(res.bucketTotals.D31_60).toBe(500);
    expect(res.bucketTotals.CURRENT).toBe(0);
    expect(res.bucketTotals.D91_120).toBe(0);
    expect(res.grandOutstanding).toBe(500);
  });

  it("treats a blank search as no search", async () => {
    const res = await listReceivables({ storeId, asOf, search: "   " });
    expect(res.rows.map((r) => r.id).sort()).toEqual([currentRec, overdueRec, thirdRec].sort());
    expect(res.grandOutstanding).toBe(1800);
  });

  /*
   * GAP 3: getReceivable must not hide a VOIDED payment from the allocation history — dropping it
   * would make the balance math unexplainable. Goes through the real writers so the assertion is on
   * their actual output, not a hand-crafted row.
   */
  it("keeps a voided payment's allocation in the receivable's history", async () => {
    const payment = await recordPayment({
      storeId, paidAt: asOf, method: "CASH", recordedById: userId,
      amount: 500, allocations: [{ receivableId: overdueRec, amount: 500 }],
    });
    paymentId = payment.paymentId;

    await voidPayment({ paymentId, reason: "test void", voidedById: userId });

    const detail = await getReceivable(overdueRec, asOf);
    expect(detail).not.toBeNull();
    expect(detail!.allocations).toHaveLength(1);
    expect(detail!.allocations[0].amount).toBe(500);
    expect(detail!.allocations[0].payment.status).toBe("VOIDED");
  });

  /* GAP 4: listPayments is what a payment list screen renders directly from. */
  it("returns a payment row with the fields the list needs, amount as a number", async () => {
    const payment = await recordPayment({
      storeId, paidAt: asOf, method: "TRANSFER", recordedById: userId,
      amount: 1000, allocations: [{ receivableId: currentRec, amount: 1000 }],
    });
    paymentId = payment.paymentId;

    const res = await listPayments({ storeId });
    const row = res.rows.find((r) => r.id === paymentId);
    expect(row).toBeDefined();
    expect(row!.docNo).toBe(payment.docNo);
    expect(row!.method).toBe("TRANSFER");
    expect(row!.status).toBe("POSTED");
    expect(row!.storeName).toBe(`Toko ${token}`);
    expect(row!.allocationCount).toBe(1);
    expect(typeof row!.amount).toBe("number");
    expect(row!.amount).toBe(1000);
  });

  /* GAP 4: getPayment's allocations resolve docNo through receivable -> delivery, the part most
   * likely to break silently (e.g. a select that stops joining delivery). */
  it("resolves each allocation's receivable docNo through the delivery relation", async () => {
    const payment = await recordPayment({
      storeId, paidAt: asOf, method: "CASH", recordedById: userId,
      amount: 500, allocations: [{ receivableId: overdueRec, amount: 500 }],
    });
    paymentId = payment.paymentId;

    const detail = await getPayment(paymentId);
    expect(detail).not.toBeNull();
    expect(detail!.allocations).toHaveLength(1);
    expect(detail!.allocations[0].receivableId).toBe(overdueRec);
    expect(detail!.allocations[0].docNo).toBe(`TEST-ARQ-DLV2-${token}`);
    expect(detail!.allocations[0].outstandingAmount).toBe(0);
  });

  /*
   * listAllocationCandidatesForStore merges two `listReceivables` calls (OUTSTANDING + PARTIAL) for
   * one store. overdueRec is flipped to PARTIAL here to cover both statuses; thirdRec is flipped to
   * PAID to prove it's excluded rather than merely untouched.
   */
  it("returns OUTSTANDING and PARTIAL receivables for a store, sorted by dueDate, excluding PAID", async () => {
    await prisma.receivable.update({
      where: { id: overdueRec },
      data: { status: "PARTIAL", paidAmount: 200, outstandingAmount: 300 },
    });
    await prisma.receivable.update({ where: { id: thirdRec }, data: { status: "PAID", outstandingAmount: 0 } });

    const candidates = await listAllocationCandidatesForStore(storeId);

    /* overdueRec (dueDate 2026-05-01) before currentRec (dueDate 2026-06-20); thirdRec absent. */
    expect(candidates.map((c) => c.id)).toEqual([overdueRec, currentRec]);
    expect(candidates.map((c) => c.outstandingAmount)).toEqual([300, 1000]);
  });

  /* GAP 5: getPayment's returOffsetFor lets the payment detail page and Task 9's writer tell a
   * retur-settled payment apart from a plain one. */
  it("exposes returOffsetFor for a payment settled by a field return, and null for a plain payment", async () => {
    const uom = await prisma.uOM.create({ data: { code: `TEST-ARQ-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    returUomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-ARQ-ITEM-${token}`, nameId: "Retur item", nameEn: "Retur item", type: "FINISHED_GOOD", uomId: returUomId, isActive: true },
    });
    returItemId = item.id;

    const offsetPayment = await prisma.payment.create({
      data: {
        docNo: `TEST-ARQ-PAY-OFFSET-${token}`,
        storeId,
        paidAt: asOf,
        method: "RETUR_OFFSET",
        amount: 300,
        recordedById: userId,
      },
    });
    paymentId = offsetPayment.id;

    const fieldReturn = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-ARQ-RET-${token}`,
        storeId,
        raisedById: userId,
        status: "APPROVED",
        valuationStatus: "VALUED",
        offsetStatus: "APPLIED",
        offsetPaymentId: paymentId,
        lines: { create: [{ itemId: returItemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    fieldReturnId = fieldReturn.id;

    const offsetDetail = await getPayment(paymentId);
    expect(offsetDetail).not.toBeNull();
    expect(offsetDetail!.returOffsetFor).toEqual({ id: fieldReturnId, docNo: fieldReturn.docNo });

    const cashPayment = await recordPayment({
      storeId, paidAt: asOf, method: "CASH", recordedById: userId,
      amount: 500, allocations: [{ receivableId: currentRec, amount: 500 }],
    });
    const cashDetail = await getPayment(cashPayment.paymentId);
    expect(cashDetail).not.toBeNull();
    expect(cashDetail!.returOffsetFor).toBeNull();
  });
});
