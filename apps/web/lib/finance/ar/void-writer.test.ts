import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordPayment } from "./payment-writer";
import { voidPayment } from "./void-writer";
import { PaymentError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const paidAt = new Date("2026-03-01T00:00:00.000+07:00");

d("voidPayment (test bed only)", () => {
  /*
   * Regenerated per test, not once per describe: Store.code / User.email / Receivable.deliveryId
   * are all @unique on this token. A single leaked afterEach (fixture ids stay "" on a hook
   * failure, so the teardown deletes nothing) would otherwise make every remaining test in this
   * file fail with P2002 in beforeEach on the shared bed, for the rest of the run.
   */
  let token = "";
  let storeId = "";
  let userId = "";
  let recA = "";
  let paymentId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; userId = ""; recA = ""; paymentId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-VOID-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `void-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;

    const a = await prisma.receivable.create({
      data: {
        deliveryId: `test-dlv-v-${token}`, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: 1000, outstandingAmount: 1000,
      },
    });
    recA = a.id;

    const p = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 400, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 400 }],
    });
    paymentId = p.paymentId;
  });

  afterEach(async () => {
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: seededId(paymentId) } } });
    await prisma.journal.deleteMany({ where: { sourceId: seededId(paymentId) } });
    await prisma.paymentAllocation.deleteMany({ where: { receivableId: seededId(recA) } });
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.receivable.deleteMany({ where: { id: seededId(recA) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("restores the outstanding balance and reverts the status", async () => {
    const res = await voidPayment({ paymentId, reason: "wrong amount keyed", voidedById: userId });
    expect(res.voided).toBe(true);

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.outstandingAmount)).toBe(1000);
    expect(Number(after.paidAmount)).toBe(0);
    expect(after.status).toBe("OUTSTANDING");
  });

  it("takes a fully settled receivable back to PARTIAL when another payment remains", async () => {
    const second = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 600, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 600 }],
    });
    const settled = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(settled.status).toBe("PAID");

    await voidPayment({ paymentId: second.paymentId, reason: "duplicate", voidedById: userId });
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.outstandingAmount)).toBe(600);
    expect(after.status).toBe("PARTIAL");
  });

  it("marks the payment VOIDED with its reason and actor", async () => {
    await voidPayment({ paymentId, reason: "wrong amount keyed", voidedById: userId });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe("VOIDED");
    expect(p.voidReason).toBe("wrong amount keyed");
    expect(p.voidedById).toBe(userId);
    expect(p.voidedAt).not.toBeNull();
  });

  it("keeps the allocations as the record of what the voided payment claimed", async () => {
    await voidPayment({ paymentId, reason: "wrong amount keyed", voidedById: userId });
    const allocations = await prisma.paymentAllocation.findMany({ where: { paymentId } });
    expect(allocations).toHaveLength(1);
  });

  it("is a no-op on a second void and restores nothing twice", async () => {
    await voidPayment({ paymentId, reason: "first", voidedById: userId });
    const second = await voidPayment({ paymentId, reason: "second", voidedById: userId });
    expect(second.voided).toBe(false);

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.outstandingAmount)).toBe(1000);
  });

  it("rejects an unknown payment", async () => {
    const err = await voidPayment({
      paymentId: `missing-${token}`, reason: "x", voidedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("rejects a blank void reason", async () => {
    const err = await voidPayment({ paymentId, reason: "   ", voidedById: userId }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("MISSING_REASON");

    /* The refusal is total: the beforeEach payment (400 against a 1000 receivable) is untouched. */
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("POSTED");

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(400);
    expect(Number(after.outstandingAmount)).toBe(600);
  });
});
