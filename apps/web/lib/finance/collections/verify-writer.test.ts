import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitCollection } from "./submit-writer";
import { verifyCollection } from "./verify-writer";
import * as paymentWriter from "@/lib/finance/ar/payment-writer";
import { PaymentError } from "@/lib/finance/ar/errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

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
    const notifs = await notificationsFor(receivableId);
    if (notifs.length > 0) {
      await prisma.adminNotification.deleteMany({ where: { id: { in: notifs.map((n) => n.id) } } });
    }
    await prisma.paymentAllocation.deleteMany({ where: { receivableId: seededId(receivableId) } });
    /*
     * Scoped on storeId, NOT derived from CollectionSubmission.paymentId — that column is exactly
     * what stays null in the orphaned-payment case (a payment committed, then the submission
     * landed on REJECTED), so a linkage-derived cleanup leaves the orphan behind. Under
     * relationMode = "prisma" there is no DB FK to catch it, and the row survives with dangling
     * required store/recordedBy relations once this teardown deletes those.
     */
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: seededId(receivableId) } });
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
    const spy = vi.spyOn(paymentWriter, "recordPayment");
    const first = await verifyCollection({ submissionId, verifiedById: adminId });
    const second = await verifyCollection({ submissionId, verifiedById: adminId });
    /*
     * Asserts the short-circuit itself, not just its downstream effect: the second call must
     * report alreadyVerified and must NOT have called recordPayment a second time (recordPayment's
     * own idempotency check is a separate safety net covered by the replay test above).
     *
     * The paymentId assertion is load-bearing, not decoration: this path used to return no payment
     * id at all, so `verifyCollectionAction` skipped the receipt journal entirely on any retry and
     * a crashed verify left the payment permanently un-journaled.
     */
    expect(second).toEqual({ ok: true, paymentId: first.paymentId, alreadyVerified: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const allocations = await prisma.paymentAllocation.findMany({ where: { receivableId } });
    expect(allocations).toHaveLength(1);
    spy.mockRestore();
  });

  it("a receivable settled elsewhere surfaces its own reason and leaves the submission PENDING", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PAID", outstandingAmount: 0 } });
    let caught: unknown;
    try {
      await verifyCollection({ submissionId, verifiedById: adminId });
    } catch (e) {
      caught = e;
    }
    // Specifically the ALREADY_SETTLED guard inside recordPayment, not just "something threw" —
    // a future change that swallowed the real error and threw something generic would pass a
    // bare rejects.toThrow() but must fail this.
    expect(caught).toBeInstanceOf(PaymentError);
    expect((caught as PaymentError).code).toBe("ALREADY_SETTLED");
    const sub = await prisma.collectionSubmission.findUnique({ where: { id: submissionId } });
    expect(sub!.status).toBe("PENDING");
  });

  it("partial verification leaves the receivable PARTIAL and the assignment standing", async () => {
    await verifyCollection({ submissionId, verifiedById: adminId });
    const r = await prisma.receivable.findUnique({ where: { id: receivableId } });
    expect(r!.status).toBe("PARTIAL");
    expect(r!.collectorId).toBe(collectorId);
  });

  it("a submission rejected between payment-post and CAS-flip throws instead of reporting false success", async () => {
    const realRecordPayment = paymentWriter.recordPayment;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(paymentWriter, "recordPayment").mockImplementation(async (recordInput) => {
      const result = await realRecordPayment(recordInput);
      /*
       * Simulates a concurrent rejectCollection landing in the window between recordPayment
       * committing and verifyCollection's own CAS running. Sets exactly the fields the real
       * reject-writer sets (status + rejectReason) — CollectionSubmission has no rejectedById
       * or rejectedAt column.
       */
      await prisma.collectionSubmission.update({
        where: { id: submissionId },
        data: { status: "REJECTED", rejectReason: "simulated concurrent reject" },
      });
      return result;
    });
    let orphanLogCount = 0;
    try {
      await expect(verifyCollection({ submissionId, verifiedById: adminId })).rejects.toMatchObject({ code: "NOT_PENDING" });
      /*
       * Filtered to this writer's own message rather than a bare call count — unrelated console.error
       * noise from the adapter would otherwise turn a real pass into a flake.
       */
      orphanLogCount = consoleErrorSpy.mock.calls.filter((args) =>
        String(args[0]).includes("[verifyCollection] orphaned payment"),
      ).length;
    } finally {
      spy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    /*
     * The payment above is real and committed despite the throw — this is the orphan the comment
     * on verifyCollection describes, surfaced loudly rather than hidden. Teardown catches it only
     * because this file's afterEach scopes the Payment delete on storeId; a cleanup derived from
     * CollectionSubmission.paymentId would leak this exact row.
     */
    const orphanPayment = await prisma.payment.findFirst({ where: { idempotencyKey: `collection-${submissionId}` } });
    expect(orphanPayment).not.toBeNull();
    expect(Number(orphanPayment!.amount)).toBe(400);
    const sub = await prisma.collectionSubmission.findUnique({ where: { id: submissionId } });
    expect(sub!.status).toBe("REJECTED");
    expect(sub!.paymentId).toBeNull();
    expect(orphanLogCount).toBe(1);
  });
});
