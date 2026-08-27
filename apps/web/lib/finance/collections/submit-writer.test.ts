import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitCollection } from "./submit-writer";
import { CollectionError } from "./errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("submitCollection (test bed only)", () => {
  let token = "";
  let storeId = "";
  let adminId = "";
  let collectorId = "";
  let otherCollectorId = "";
  let orderId = "";
  let deliveryId = "";
  let receivableId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; adminId = ""; collectorId = ""; otherCollectorId = "";
    orderId = ""; deliveryId = ""; receivableId = "";

    const store = await prisma.store.create({ data: { code: `TEST-CSW-${token}`, name: "test", address: "test", termsType: "PUTUS" } });
    storeId = store.id;
    const admin = await prisma.user.create({ data: { email: `csw-admin-${token}@test.local`, name: "admin", role: "ADMIN" } });
    adminId = admin.id;
    const collector = await prisma.user.create({ data: { email: `csw-collector-${token}@test.local`, name: "collector", role: "ADMIN" } });
    collectorId = collector.id;
    const otherCollector = await prisma.user.create({ data: { email: `csw-other-${token}@test.local`, name: "other", role: "ADMIN" } });
    otherCollectorId = otherCollector.id;

    const order = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-CSW-ORD-${token}`, storeId, salesmanId: adminId, subtotal: 1000, total: 1000 } });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-CSW-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 1000, total: 1000 } });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({ data: { deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 1000, outstandingAmount: 1000, collectorId } });
    receivableId = receivable.id;
  });

  afterEach(async () => {
    await prisma.adminNotification.deleteMany({ where: { metadata: { path: "$.receivableId", equals: seededId(receivableId) } } }).catch(() => {});
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: seededId(receivableId) } });
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(adminId), seededId(collectorId), seededId(otherCollectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  const base = () => ({ receivableId, collectorId, amount: 400, method: "CASH" as const, paidAt: new Date() });

  it("creates a PENDING submission and moves no money", async () => {
    await submitCollection(base());
    const r = await prisma.receivable.findUnique({ where: { id: receivableId } });
    expect(Number(r!.outstandingAmount)).toBe(1000);
    expect(r!.status).toBe("OUTSTANDING");
    const sub = await prisma.collectionSubmission.findFirst({ where: { receivableId } });
    expect(sub!.status).toBe("PENDING");
  });

  it("writes a COLLECTION_PENDING_VERIFICATION AdminNotification", async () => {
    await submitCollection(base());
    const notif = await prisma.adminNotification.findFirst({ where: { category: "COLLECTION_PENDING_VERIFICATION" } });
    expect(notif).not.toBeNull();
  });

  it("rejects a collector who is not the assigned one", async () => {
    await expect(submitCollection({ ...base(), collectorId: otherCollectorId })).rejects.toBeInstanceOf(CollectionError);
  });

  it("rejects a non-positive amount", async () => {
    await expect(submitCollection({ ...base(), amount: 0 })).rejects.toBeInstanceOf(CollectionError);
  });

  it("rejects an over-collection netted against an existing PENDING submission", async () => {
    await submitCollection({ ...base(), amount: 700 });
    await expect(submitCollection({ ...base(), amount: 400 })).rejects.toBeInstanceOf(CollectionError);
  });

  it("allows a second submission that fits within the remaining (unnetted) balance", async () => {
    await submitCollection({ ...base(), amount: 600 });
    await submitCollection({ ...base(), amount: 400 });
    const subs = await prisma.collectionSubmission.findMany({ where: { receivableId } });
    expect(subs).toHaveLength(2);
  });

  it("idempotencyKey replay returns the same submission and creates no second row", async () => {
    const key = `test-idem-${token}`;
    const first = await submitCollection({ ...base(), idempotencyKey: key });
    const second = await submitCollection({ ...base(), idempotencyKey: key });
    expect(second.submissionId).toBe(first.submissionId);
    const subs = await prisma.collectionSubmission.findMany({ where: { receivableId } });
    expect(subs).toHaveLength(1);
  });

  it("rejects a PAID receivable", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PAID", outstandingAmount: 0 } });
    await expect(submitCollection(base())).rejects.toBeInstanceOf(CollectionError);
  });
});
