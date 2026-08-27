import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitCollection } from "./submit-writer";
import { rejectCollection } from "./reject-writer";
import { CollectionError } from "./errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("rejectCollection (test bed only)", () => {
  let token = "";
  let storeId = "";
  let adminId = "";
  let collectorId = "";
  let orderId = "";
  let deliveryId = "";
  let receivableId = "";
  let submissionId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; adminId = ""; collectorId = "";
    orderId = ""; deliveryId = ""; receivableId = ""; submissionId = "";

    const store = await prisma.store.create({ data: { code: `TEST-CRW-${token}`, name: "test", address: "test", termsType: "PUTUS" } });
    storeId = store.id;
    const admin = await prisma.user.create({ data: { email: `crw-admin-${token}@test.local`, name: "admin", role: "ADMIN" } });
    adminId = admin.id;
    const collector = await prisma.user.create({ data: { email: `crw-collector-${token}@test.local`, name: "collector", role: "ADMIN" } });
    collectorId = collector.id;

    const order = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-CRW-ORD-${token}`, storeId, salesmanId: adminId, subtotal: 1000, total: 1000 } });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-CRW-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 1000, total: 1000 } });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({ data: { deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 1000, outstandingAmount: 1000, collectorId } });
    receivableId = receivable.id;

    const sub = await submitCollection({ receivableId, collectorId, amount: 400, method: "CASH", paidAt: new Date() });
    submissionId = sub.submissionId;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(submissionId) } });
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: seededId(receivableId) } });
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(adminId), seededId(collectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("rejects a PENDING submission with a reason, moves no money", async () => {
    await rejectCollection({ submissionId, reason: "wrong amount claimed", rejectedById: adminId });
    const sub = await prisma.collectionSubmission.findUnique({ where: { id: submissionId } });
    expect(sub!.status).toBe("REJECTED");
    expect(sub!.rejectReason).toBe("wrong amount claimed");
    const r = await prisma.receivable.findUnique({ where: { id: receivableId } });
    expect(Number(r!.outstandingAmount)).toBe(1000);
  });

  it("rejects a blank reason", async () => {
    await expect(rejectCollection({ submissionId, reason: "   ", rejectedById: adminId })).rejects.toBeInstanceOf(CollectionError);
  });

  it("CAS refuses a non-PENDING submission", async () => {
    await rejectCollection({ submissionId, reason: "first rejection", rejectedById: adminId });
    await expect(rejectCollection({ submissionId, reason: "second attempt", rejectedById: adminId })).rejects.toBeInstanceOf(CollectionError);
  });

  it("writes an AuditLog row on rejection", async () => {
    await rejectCollection({ submissionId, reason: "wrong amount claimed", rejectedById: adminId });
    const log = await prisma.auditLog.findFirst({ where: { entityId: submissionId, action: "COLLECTION_REJECT" } });
    expect(log).not.toBeNull();
    expect(log!.userId).toBe(adminId);
    expect(log!.entityType).toBe("CollectionSubmission");
    expect(log!.reason).toBe("wrong amount claimed");
  });
});
