import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitCollection } from "./submit-writer";
import {
  listCollectionQueue,
  getReceivableForCollection,
  listPendingCollections,
  getCollectionSubmission,
} from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * `COLLECTION_PENDING_VERIFICATION` rows scoped to one seeded receivable, matched in JS on
 * `metadata.receivableId` — this MariaDB adapter's JSON-path filtering is unreliable, and this
 * spec shares the dev DB with real notification rows, so a category-wide delete would take out
 * rows this spec never created. `submitCollection` writes one inside its own transaction, so
 * every seeded fixture here leaves one behind unless teardown removes it.
 */
async function notificationsFor(receivableId: string) {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "COLLECTION_PENDING_VERIFICATION" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return recent.filter((n) => (n.metadata as { receivableId?: string } | null)?.receivableId === receivableId);
}

d("listCollectionQueue (test bed only)", () => {
  let token = "";
  let storeId = "";
  let adminId = "";
  let collectorId = "";
  let orderAId = "";
  let orderBId = "";
  let deliveryAId = "";
  let deliveryBId = "";
  let receivableAId = "";
  let receivableBId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; adminId = ""; collectorId = "";
    orderAId = ""; orderBId = ""; deliveryAId = ""; deliveryBId = "";
    receivableAId = ""; receivableBId = "";

    const store = await prisma.store.create({ data: { code: `TEST-CQ-${token}`, name: "test", address: "test", termsType: "PUTUS" } });
    storeId = store.id;
    const admin = await prisma.user.create({ data: { email: `cq-admin-${token}@test.local`, name: "admin", role: "ADMIN" } });
    adminId = admin.id;
    const collector = await prisma.user.create({ data: { email: `cq-collector-${token}@test.local`, name: "collector", role: "ADMIN" } });
    collectorId = collector.id;

    const orderA = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-CQ-ORDA-${token}`, storeId, salesmanId: adminId, subtotal: 1000, total: 1000 } });
    orderAId = orderA.id;
    const deliveryA = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-CQ-DLVA-${token}`, orderId: orderAId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 1000, total: 1000 } });
    deliveryAId = deliveryA.id;
    const receivableA = await prisma.receivable.create({ data: { deliveryId: deliveryAId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 1000, outstandingAmount: 1000, collectorId } });
    receivableAId = receivableA.id;

    const orderB = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-CQ-ORDB-${token}`, storeId, salesmanId: adminId, subtotal: 500, total: 500 } });
    orderBId = orderB.id;
    const deliveryB = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-CQ-DLVB-${token}`, orderId: orderBId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 500, total: 500 } });
    deliveryBId = deliveryB.id;
    const receivableB = await prisma.receivable.create({ data: { deliveryId: deliveryBId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 500, outstandingAmount: 0, status: "PAID", collectorId } });
    receivableBId = receivableB.id;
  });

  afterEach(async () => {
    const notifsA = await notificationsFor(receivableAId);
    const notifsB = await notificationsFor(receivableBId);
    const allNotifIds = [...notifsA, ...notifsB].map((n) => n.id);
    if (allNotifIds.length > 0) {
      await prisma.adminNotification.deleteMany({ where: { id: { in: allNotifIds } } });
    }
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: { in: [seededId(receivableAId), seededId(receivableBId)] } } });
    await prisma.receivable.deleteMany({ where: { id: { in: [seededId(receivableAId), seededId(receivableBId)] } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: [seededId(deliveryAId), seededId(deliveryBId)] } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(adminId), seededId(collectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("excludes PAID/WRITTEN_OFF receivables (the externally-settled case, no housekeeping writer involved)", async () => {
    const rows = await listCollectionQueue(collectorId);
    const ids = rows.map((r) => r.receivableId);
    expect(ids).toContain(receivableAId);
    expect(ids).not.toContain(receivableBId);
  });

  it("pendingSubmittedAmount sums only PENDING rows", async () => {
    await submitCollection({ receivableId: receivableAId, collectorId, amount: 300, method: "CASH", paidAt: new Date() });
    const rows = await listCollectionQueue(collectorId);
    const row = rows.find((r) => r.receivableId === receivableAId);
    expect(row!.pendingSubmittedAmount).toBe(300);
  });

  it("getReceivableForCollection returns null when the receivable is assigned to a different collector", async () => {
    const otherCollector = await prisma.user.create({ data: { email: `cq-other-${token}@test.local`, name: "other", role: "ADMIN" } });
    try {
      const result = await getReceivableForCollection(receivableAId, otherCollector.id);
      expect(result).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: otherCollector.id } });
    }
  });

  it("getReceivableForCollection returns the receivable when assigned to the asking collector", async () => {
    const result = await getReceivableForCollection(receivableAId, collectorId);
    expect(result).not.toBeNull();
    expect(result!.receivableId).toBe(receivableAId);
    expect(result!.outstandingAmount).toBe(1000);
  });
});

/*
 * Separate describe block, deliberately not nested in the fixture above: a sell-through-backed
 * receivable resolves its docNo through a different source (`KonsiSellThrough.docNo`, not
 * `FieldSalesDelivery.docNo`) and this pins that every collections read surface renders it
 * instead of throwing on the now-optional `delivery` relation.
 */
d("collection queries — sell-through source (test bed only)", () => {
  let token = "";
  let storeId = "";
  let salesmanId = "";
  let collectorId = "";
  let sellThroughId = "";
  let sellThroughRecId = "";
  let submissionId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; salesmanId = ""; collectorId = "";
    sellThroughId = ""; sellThroughRecId = ""; submissionId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-CQST-${token}`, name: `Toko ${token}`, address: "test", termsType: "KONSI" },
    });
    storeId = store.id;
    const salesman = await prisma.user.create({ data: { email: `cqst-sales-${token}@test.local`, name: "sales" } });
    salesmanId = salesman.id;
    const collector = await prisma.user.create({ data: { email: `cqst-collector-${token}@test.local`, name: "collector", role: "ADMIN" } });
    collectorId = collector.id;

    const sellThrough = await prisma.konsiSellThrough.create({
      data: {
        docNo: `TEST-CQST-KST-${token}`,
        storeId,
        method: "SPG_POS",
        closingStocktakeId: `TEST-CQST-STK-${token}`,
        periodStart: new Date("2026-05-01T00:00:00.000+07:00"),
        periodEnd: new Date("2026-05-31T00:00:00.000+07:00"),
        salesmanId,
        createdById: salesmanId,
      },
    });
    sellThroughId = sellThrough.id;

    const sellThroughRec = await prisma.receivable.create({
      data: {
        sellThroughId, storeId,
        invoiceDate: new Date("2026-05-31T00:00:00.000+07:00"),
        dueDate: new Date("2026-06-30T00:00:00.000+07:00"),
        originalAmount: 500, outstandingAmount: 500,
        collectorId,
      },
    });
    sellThroughRecId = sellThroughRec.id;
  });

  afterEach(async () => {
    /* Children of the 1:1 relation to KonsiSellThrough go before their parent. Scoped by
     * receivableId, not submissionId — the one test that creates a submission could fail before
     * assigning submissionId, and a submission left behind under that receivable would still need
     * to go before the receivable delete below. */
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: seededId(sellThroughRecId) } });
    await prisma.receivable.deleteMany({ where: { id: seededId(sellThroughRecId) } });
    await prisma.konsiSellThrough.deleteMany({ where: { id: seededId(sellThroughId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(collectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("listCollectionQueue resolves a sell-through-backed receivable's docNo", async () => {
    const rows = await listCollectionQueue(collectorId);
    const row = rows.find((r) => r.receivableId === sellThroughRecId);
    expect(row).toBeDefined();
    expect(row!.docNo).toBe(`TEST-CQST-KST-${token}`);
  });

  it("getReceivableForCollection resolves a sell-through-backed receivable's docNo", async () => {
    const result = await getReceivableForCollection(sellThroughRecId, collectorId);
    expect(result).not.toBeNull();
    expect(result!.docNo).toBe(`TEST-CQST-KST-${token}`);
  });

  it("listPendingCollections and getCollectionSubmission resolve a sell-through-backed receivable's docNo", async () => {
    const submission = await prisma.collectionSubmission.create({
      data: {
        receivableId: sellThroughRecId,
        collectorId,
        amount: 200,
        method: "CASH",
        paidAt: new Date(),
        status: "PENDING",
      },
    });
    submissionId = submission.id;

    const pending = await listPendingCollections({ collectorId });
    const pendingRow = pending.rows.find((r) => r.id === submissionId);
    expect(pendingRow).toBeDefined();
    expect(pendingRow!.docNo).toBe(`TEST-CQST-KST-${token}`);

    const detail = await getCollectionSubmission(submissionId);
    expect(detail?.docNo).toBe(`TEST-CQST-KST-${token}`);
  });
});
