import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitCollection } from "./submit-writer";
import { listCollectionQueue, getReceivableForCollection } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

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
