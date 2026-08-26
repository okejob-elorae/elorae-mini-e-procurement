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
   * Regenerated per test, not once per describe: Store.code / User.email / FieldSalesOrder.orderNo
   * / FieldSalesDelivery.docNo / Receivable.deliveryId are all @unique on this token. A single
   * leaked afterEach (fixture ids stay "" on a hook failure, so the teardown deletes nothing)
   * would otherwise make every remaining test in this file fail with P2002 in beforeEach on the
   * shared bed, for the rest of the run.
   */
  let token = "";
  let storeId = "";
  let userId = "";
  let orderAId = "";
  let orderBId = "";
  let deliveryAId = "";
  let deliveryBId = "";
  let recA = "";
  let recB = "";
  let paymentId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; userId = ""; orderAId = ""; orderBId = ""; deliveryAId = ""; deliveryBId = "";
    recA = ""; recB = ""; paymentId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-VOID-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `void-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;

    /*
     * Receivable.delivery is a REQUIRED relation under relationMode="prisma" — a deliveryId that
     * does not resolve to a real FieldSalesDelivery throws "Inconsistent query result" the moment a
     * query selects through it (e.g. listReceivables's docNo / order.salesman.name). voidPayment
     * itself never selects through delivery, but a fake string id here still leaves an orphan
     * Receivable behind on the shared bed if the teardown is ever interrupted, so the chain is real
     * rows, not a synthetic string.
     */
    const orderA = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARVW-ORDA-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    orderAId = orderA.id;

    const deliveryA = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARVW-DLVA-${token}`, orderId: orderAId,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: 1000, total: 1000,
      },
    });
    deliveryAId = deliveryA.id;

    const a = await prisma.receivable.create({
      data: {
        deliveryId: deliveryAId, storeId,
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
    await prisma.paymentAllocation.deleteMany({
      where: { receivableId: { in: [seededId(recA), seededId(recB)] } },
    });
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.receivable.deleteMany({
      where: { id: { in: [seededId(recA), seededId(recB)] } },
    });
    await prisma.fieldSalesDelivery.deleteMany({
      where: { id: { in: [seededId(deliveryAId), seededId(deliveryBId)] } },
    });
    await prisma.fieldSalesOrder.deleteMany({
      where: { id: { in: [seededId(orderAId), seededId(orderBId)] } },
    });
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

  it("marks the payment VOIDED with the trimmed reason and actor", async () => {
    /* Leading/trailing whitespace on the input proves the STORED reason is the trimmed form, not the raw input. */
    await voidPayment({ paymentId, reason: "  wrong amount keyed  ", voidedById: userId });
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

  it("short-circuits a second void without restoring twice", async () => {
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

  it("rejects a reason with no visible content", async () => {
    /* U+200B ZERO WIDTH SPACE (Cf) and U+2800 BRAILLE PATTERN BLANK both survive .trim() but render blank. */
    const err = await voidPayment({
      paymentId, reason: "\u200B\u2800", voidedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("MISSING_REASON");
  });

  it("refuses to void a payment against a written-off receivable", async () => {
    await prisma.receivable.update({ where: { id: recA }, data: { status: "WRITTEN_OFF" } });

    const err = await voidPayment({ paymentId, reason: "trying to void", voidedById: userId }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("ALREADY_SETTLED");

    /* The refusal is total: the flip and the write-off status both stand, untouched. */
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("POSTED");

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(400);
    expect(Number(after.outstandingAmount)).toBe(600);
    expect(after.status).toBe("WRITTEN_OFF");
  });

  it("restores both receivables when one payment is split across them", async () => {
    const orderB = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARVW-ORDB-${token}`, storeId, salesmanId: userId, subtotal: 500, total: 500 },
    });
    orderBId = orderB.id;

    const deliveryB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARVW-DLVB-${token}`, orderId: orderBId,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: 500, total: 500,
      },
    });
    deliveryBId = deliveryB.id;

    const b = await prisma.receivable.create({
      data: {
        deliveryId: deliveryBId, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: 500, outstandingAmount: 500,
      },
    });
    recB = b.id;

    /* recA is already at paidAmount 400 / outstanding 600 from beforeEach; this adds 100 more to it. */
    const split = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 300, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 100 }, { receivableId: recB, amount: 200 }],
    });

    await voidPayment({ paymentId: split.paymentId, reason: "split reversal", voidedById: userId });

    const afterA = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    const afterB = await prisma.receivable.findUniqueOrThrow({ where: { id: recB } });

    /* recA: back to its beforeEach state (400/600), only the split payment's slice is reversed. */
    expect(Number(afterA.paidAmount)).toBe(400);
    expect(Number(afterA.outstandingAmount)).toBe(600);
    expect(afterA.status).toBe("PARTIAL");

    /* recB: back to its own pre-split state (0/500) — a bug that only processed allocations[0] would leave this at 200/300. */
    expect(Number(afterB.paidAmount)).toBe(0);
    expect(Number(afterB.outstandingAmount)).toBe(500);
    expect(afterB.status).toBe("OUTSTANDING");
  });
});
