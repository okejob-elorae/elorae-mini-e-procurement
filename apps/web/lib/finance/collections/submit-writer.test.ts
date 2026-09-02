import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { submitCollection, type SubmitCollectionInput } from "./submit-writer";
import { CollectionError } from "./errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * `COLLECTION_PENDING_VERIFICATION` rows scoped to one seeded receivable, matched in JS on
 * `metadata.receivableId` — this MariaDB adapter's JSON-path filtering is unreliable, and this
 * spec shares the dev DB with real notification rows, so a global category count would prove
 * nothing about whether THIS test's writer call created a row.
 */
async function notificationsFor(receivableId: string) {
  const recent = await prisma.adminNotification.findMany({
    where: { category: "COLLECTION_PENDING_VERIFICATION" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return recent.filter((n) => (n.metadata as { receivableId?: string } | null)?.receivableId === receivableId);
}

/** Runs `submitCollection` expecting a `CollectionError`, and returns it for a `.code` assertion. */
async function submitAndCatch(input: SubmitCollectionInput): Promise<CollectionError> {
  try {
    await submitCollection(input);
  } catch (e) {
    if (e instanceof CollectionError) return e;
    throw e;
  }
  throw new Error("expected submitCollection to reject with a CollectionError");
}

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
    const notifs = await notificationsFor(receivableId);
    if (notifs.length > 0) {
      await prisma.adminNotification.deleteMany({ where: { id: { in: notifs.map((n) => n.id) } } });
    }
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
    const sub = await prisma.collectionSubmission.findFirst({ where: { receivableId: seededId(receivableId) } });
    expect(sub!.status).toBe("PENDING");
  });

  it("writes a COLLECTION_PENDING_VERIFICATION AdminNotification scoped to this receivable", async () => {
    await submitCollection(base());
    const notifs = await notificationsFor(receivableId);
    expect(notifs).toHaveLength(1);
  });

  it("rejects a collector who is not the assigned one", async () => {
    const err = await submitAndCatch({ ...base(), collectorId: otherCollectorId });
    expect(err.code).toBe("NOT_ASSIGNED_COLLECTOR");
  });

  it("rejects a non-positive amount", async () => {
    const err = await submitAndCatch({ ...base(), amount: 0 });
    expect(err.code).toBe("INVALID_AMOUNT");
  });

  it("rejects a receivable that does not exist", async () => {
    const err = await submitAndCatch({ ...base(), receivableId: `does-not-exist-${token}` });
    expect(err.code).toBe("NOT_FOUND");
  });

  it("rejects an over-collection netted against an existing PENDING submission", async () => {
    await submitCollection({ ...base(), amount: 700 });
    const err = await submitAndCatch({ ...base(), amount: 400 });
    expect(err.code).toBe("OVER_COLLECTED");
  });

  it("allows a second submission that fits within the remaining (unnetted) balance", async () => {
    await submitCollection({ ...base(), amount: 600 });
    await submitCollection({ ...base(), amount: 400 });
    const subs = await prisma.collectionSubmission.findMany({ where: { receivableId: seededId(receivableId) } });
    expect(subs).toHaveLength(2);
  });

  it("excludes a non-PENDING submission from the netting sum", async () => {
    // Flips status directly — no verify/reject writer exists yet (Tasks 5/6), so this pins the
    // `status: "PENDING"` filter in the netting query without depending on unbuilt code. If that
    // filter were ever dropped, this REJECTED row would still count against the balance and the
    // full-amount submission below would be wrongly rejected as over-collected.
    const { submissionId } = await submitCollection({ ...base(), amount: 700 });
    await prisma.collectionSubmission.update({ where: { id: submissionId }, data: { status: "REJECTED" } });
    await submitCollection({ ...base(), amount: 1000 });
    const subs = await prisma.collectionSubmission.findMany({ where: { receivableId: seededId(receivableId) } });
    expect(subs).toHaveLength(2);
  });

  it("idempotencyKey replay returns the same submission and creates no second row", async () => {
    const key = `test-idem-${token}`;
    const first = await submitCollection({ ...base(), idempotencyKey: key });
    const second = await submitCollection({ ...base(), idempotencyKey: key });
    expect(second.submissionId).toBe(first.submissionId);
    const subs = await prisma.collectionSubmission.findMany({ where: { receivableId: seededId(receivableId) } });
    expect(subs).toHaveLength(1);
  });

  it("rejects a PAID receivable", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PAID", outstandingAmount: 0 } });
    const err = await submitAndCatch(base());
    expect(err.code).toBe("ALREADY_SETTLED");
  });

  it("refuses RETUR_OFFSET even though the type system would normally block it", async () => {
    const err = await submitAndCatch({ ...base(), method: "RETUR_OFFSET" as unknown as "CASH" });
    expect(err.code).toBe("INVALID_METHOD");
    const subs = await prisma.collectionSubmission.findMany({ where: { receivableId: seededId(receivableId) } });
    expect(subs).toHaveLength(0);
  });
});
