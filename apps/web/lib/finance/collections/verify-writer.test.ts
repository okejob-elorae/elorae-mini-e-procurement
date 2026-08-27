import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitCollection } from "./submit-writer";
import { verifyCollection } from "./verify-writer";
import { CollectionError } from "./errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("verifyCollection (test bed only)", () => {
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

    const store = await prisma.store.create({ data: { code: `TEST-CVW-${token}`, name: "test", address: "test", termsType: "PUTUS" } });
    storeId = store.id;
    const admin = await prisma.user.create({ data: { email: `cvw-admin-${token}@test.local`, name: "admin", role: "ADMIN" } });
    adminId = admin.id;
    const collector = await prisma.user.create({ data: { email: `cvw-collector-${token}@test.local`, name: "collector", role: "ADMIN" } });
    collectorId = collector.id;

    const order = await prisma.fieldSalesOrder.create({ data: { orderNo: `TEST-CVW-ORD-${token}`, storeId, salesmanId: adminId, subtotal: 1000, total: 1000 } });
    orderId = order.id;
    const delivery = await prisma.fieldSalesDelivery.create({ data: { docNo: `TEST-CVW-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: adminId, invoiceDate: new Date(), dueDate: new Date(), subtotal: 1000, total: 1000 } });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({ data: { deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date(), originalAmount: 1000, outstandingAmount: 1000, collectorId } });
    receivableId = receivable.id;

    const sub = await submitCollection({ receivableId, collectorId, amount: 400, method: "CASH", paidAt: new Date() });
    submissionId = sub.submissionId;
  });

  afterEach(async () => {
    await prisma.paymentAllocation.deleteMany({ where: { receivableId: seededId(receivableId) } });
    const subRows = await prisma.collectionSubmission.findMany({ where: { receivableId: seededId(receivableId) }, select: { paymentId: true } });
    const paymentIds = subRows.map((s) => s.paymentId).filter((id): id is string => id !== null);
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: seededId(receivableId) } });
    if (paymentIds.length > 0) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.receivable.deleteMany({ where: { id: seededId(receivableId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(adminId), seededId(collectorId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("creates a Payment and drops outstanding by the exact amount", async () => {
    await verifyCollection({ submissionId, verifiedById: adminId });
    const r = await prisma.receivable.findUnique({ where: { id: receivableId } });
    expect(Number(r!.outstandingAmount)).toBe(600);
    expect(r!.status).toBe("PARTIAL");
    const sub = await prisma.collectionSubmission.findUnique({ where: { id: submissionId } });
    expect(sub!.status).toBe("VERIFIED");
    expect(sub!.paymentId).not.toBeNull();
    const payment = await prisma.payment.findUnique({ where: { id: sub!.paymentId! } });
    expect(Number(payment!.amount)).toBe(400);
  });

  it("replaying a half-completed verify creates no second payment (deterministic key)", async () => {
    await verifyCollection({ submissionId, verifiedById: adminId });
    const first = await prisma.collectionSubmission.findUnique({ where: { id: submissionId } });
    // Simulate the crash-between-steps case: force the submission back to PENDING without
    // touching the payment, then re-run verify — it must return the SAME payment, not create one.
    await prisma.collectionSubmission.update({ where: { id: submissionId }, data: { status: "PENDING", paymentId: null, verifiedById: null, verifiedAt: null } });
    await verifyCollection({ submissionId, verifiedById: adminId });
    const second = await prisma.collectionSubmission.findUnique({ where: { id: submissionId } });
    expect(second!.paymentId).toBe(first!.paymentId);
    const allPaymentsForReceivable = await prisma.paymentAllocation.findMany({ where: { receivableId } });
    expect(allPaymentsForReceivable).toHaveLength(1);
  });

  it("an already-VERIFIED submission is a no-op (no second payment)", async () => {
    await verifyCollection({ submissionId, verifiedById: adminId });
    await verifyCollection({ submissionId, verifiedById: adminId });
    const allocations = await prisma.paymentAllocation.findMany({ where: { receivableId } });
    expect(allocations).toHaveLength(1);
  });

  it("a receivable settled elsewhere surfaces its own reason and leaves the submission PENDING", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PAID", outstandingAmount: 0 } });
    await expect(verifyCollection({ submissionId, verifiedById: adminId })).rejects.toThrow();
    const sub = await prisma.collectionSubmission.findUnique({ where: { id: submissionId } });
    expect(sub!.status).toBe("PENDING");
  });

  it("partial verification leaves the receivable PARTIAL and the assignment standing", async () => {
    await verifyCollection({ submissionId, verifiedById: adminId });
    const r = await prisma.receivable.findUnique({ where: { id: receivableId } });
    expect(r!.status).toBe("PARTIAL");
    expect(r!.collectorId).toBe(collectorId);
  });
});
