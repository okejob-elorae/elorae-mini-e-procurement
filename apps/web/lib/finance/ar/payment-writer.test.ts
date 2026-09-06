import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordPayment } from "./payment-writer";
import { voidPayment } from "./void-writer";
import { PaymentError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const paidAt = new Date("2026-03-01T00:00:00.000+07:00");

d("recordPayment (test bed only)", () => {
  let token = "";
  let storeId = "";
  let otherStoreId = "";
  let userId = "";
  let orderAId = "";
  let orderBId = "";
  let orderOtherId = "";
  let orderResidualId = "";
  let deliveryAId = "";
  let deliveryBId = "";
  let deliveryOtherId = "";
  let deliveryResidualId = "";
  let recA = "";
  let recB = "";
  let otherRec = "";
  let recResidual = "";
  let orderRetAId = "";
  let orderRetBId = "";
  let deliveryRetAId = "";
  let deliveryRetBId = "";
  let receivableAId = "";
  let receivableBId = "";
  let returnId = "";

  beforeEach(async () => {
    /*
     * Regenerated per test, not once per describe: Store.code / User.email / FieldSalesOrder.orderNo
     * / FieldSalesDelivery.docNo / Receivable.deliveryId are all @unique on this token. A single
     * leaked afterEach (fixture ids stay "" on a hook failure, so the teardown deletes nothing)
     * would otherwise make every remaining test in this file fail with P2002 in beforeEach on the
     * shared bed, for the rest of the run.
     */
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; otherStoreId = ""; userId = "";
    orderAId = ""; orderBId = ""; orderOtherId = ""; orderResidualId = "";
    deliveryAId = ""; deliveryBId = ""; deliveryOtherId = ""; deliveryResidualId = "";
    recA = ""; recB = ""; otherRec = ""; recResidual = "";
    orderRetAId = ""; orderRetBId = ""; deliveryRetAId = ""; deliveryRetBId = "";
    receivableAId = ""; receivableBId = ""; returnId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-AR-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const other = await prisma.store.create({
      data: { code: `TEST-AR2-${token}`, name: "test2", address: "test", termsType: "PUTUS" },
    });
    otherStoreId = other.id;

    const user = await prisma.user.create({
      data: { email: `ar-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;

    /*
     * Receivable.delivery is a REQUIRED relation under relationMode="prisma" — a deliveryId that
     * does not resolve to a real FieldSalesDelivery throws "Inconsistent query result" the moment a
     * query selects through it (e.g. listReceivables's docNo / order.salesman.name). recordPayment
     * itself never selects through delivery, but a fake string id here still leaves an orphan
     * Receivable behind on the shared bed if the teardown is ever interrupted, so the chain is real
     * rows, not a synthetic string.
     */
    const orderA = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARPW-ORDA-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    orderAId = orderA.id;

    const deliveryA = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARPW-DLVA-${token}`, orderId: orderAId,
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

    const orderB = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARPW-ORDB-${token}`, storeId, salesmanId: userId, subtotal: 500, total: 500 },
    });
    orderBId = orderB.id;

    const deliveryB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARPW-DLVB-${token}`, orderId: orderBId,
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

    const orderOther = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARPW-ORDX-${token}`, storeId: otherStoreId, salesmanId: userId, subtotal: 700, total: 700 },
    });
    orderOtherId = orderOther.id;

    const deliveryOther = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARPW-DLVX-${token}`, orderId: orderOtherId,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: 700, total: 700,
      },
    });
    deliveryOtherId = deliveryOther.id;

    const c = await prisma.receivable.create({
      data: {
        deliveryId: deliveryOtherId, storeId: otherStoreId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: 700, outstandingAmount: 700,
      },
    });
    otherRec = c.id;

    const orderResidual = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARPW-ORDR-${token}`, storeId, salesmanId: userId, subtotal: 1000.5, total: 1000.5 },
    });
    orderResidualId = orderResidual.id;

    const deliveryResidual = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARPW-DLVR-${token}`, orderId: orderResidualId,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: 1000.5, total: 1000.5,
      },
    });
    deliveryResidualId = deliveryResidual.id;

    /* Sub-rupiah residue, to prove PAID requires exactly zero outstanding, not "close enough". */
    const residual = await prisma.receivable.create({
      data: {
        deliveryId: deliveryResidualId, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: 1000.5, outstandingAmount: 1000.5,
      },
    });
    recResidual = residual.id;

    /*
     * Sized well above any single retur-draw test amount (max 100_000) so the ceiling check —
     * which runs before the per-allocation OVER_ALLOCATED check — is what these tests exercise,
     * not an unrelated outstanding-balance refusal.
     */
    const orderRetA = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARPW-ORDRETA-${token}`, storeId, salesmanId: userId, subtotal: 500000, total: 500000 },
    });
    orderRetAId = orderRetA.id;

    const deliveryRetA = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARPW-DLVRETA-${token}`, orderId: orderRetAId,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: 500000, total: 500000,
      },
    });
    deliveryRetAId = deliveryRetA.id;

    const receivableA = await prisma.receivable.create({
      data: {
        deliveryId: deliveryRetAId, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: 500000, outstandingAmount: 500000,
      },
    });
    receivableAId = receivableA.id;

    const orderRetB = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARPW-ORDRETB-${token}`, storeId, salesmanId: userId, subtotal: 500000, total: 500000 },
    });
    orderRetBId = orderRetB.id;

    const deliveryRetB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARPW-DLVRETB-${token}`, orderId: orderRetBId,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: 500000, total: 500000,
      },
    });
    deliveryRetBId = deliveryRetB.id;

    const receivableB = await prisma.receivable.create({
      data: {
        deliveryId: deliveryRetBId, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: 500000, outstandingAmount: 500000,
      },
    });
    receivableBId = receivableB.id;

    /* totalValue 100_000, matching the brief's test cases verbatim. */
    const fieldReturn = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-ARPW-RET-${token}`, storeId, raisedById: userId, totalValue: 100000,
      },
    });
    returnId = fieldReturn.id;
  });

  afterEach(async () => {
    await prisma.paymentAllocation.deleteMany({
      where: {
        receivableId: {
          in: [
            seededId(recA), seededId(recB), seededId(otherRec), seededId(recResidual),
            seededId(receivableAId), seededId(receivableBId),
          ],
        },
      },
    });
    await prisma.payment.deleteMany({ where: { storeId: { in: [seededId(storeId), seededId(otherStoreId)] } } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.receivable.deleteMany({
      where: {
        id: {
          in: [
            seededId(recA), seededId(recB), seededId(otherRec), seededId(recResidual),
            seededId(receivableAId), seededId(receivableBId),
          ],
        },
      },
    });
    await prisma.fieldSalesDelivery.deleteMany({
      where: {
        id: {
          in: [
            seededId(deliveryAId), seededId(deliveryBId), seededId(deliveryOtherId), seededId(deliveryResidualId),
            seededId(deliveryRetAId), seededId(deliveryRetBId),
          ],
        },
      },
    });
    await prisma.fieldSalesOrder.deleteMany({
      where: {
        id: {
          in: [
            seededId(orderAId), seededId(orderBId), seededId(orderOtherId), seededId(orderResidualId),
            seededId(orderRetAId), seededId(orderRetBId),
          ],
        },
      },
    });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(otherStoreId)] } } });
  });

  const base = () => ({
    storeId, paidAt, method: "CASH" as const, recordedById: userId,
  });

  it("settles one receivable in full and marks it PAID", async () => {
    const res = await recordPayment({ ...base(), amount: 1000, allocations: [{ receivableId: recA, amount: 1000 }] });
    expect(res.docNo).toMatch(/^KWT\//);

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(1000);
    expect(Number(after.outstandingAmount)).toBe(0);
    expect(after.status).toBe("PAID");
  });

  it("marks a part-settled receivable PARTIAL", async () => {
    await recordPayment({ ...base(), amount: 400, allocations: [{ receivableId: recA, amount: 400 }] });
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.outstandingAmount)).toBe(600);
    expect(after.status).toBe("PARTIAL");
  });

  it("splits one payment across two receivables", async () => {
    await recordPayment({
      ...base(),
      amount: 1500,
      allocations: [{ receivableId: recA, amount: 1000 }, { receivableId: recB, amount: 500 }],
    });
    const a = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    const b = await prisma.receivable.findUniqueOrThrow({ where: { id: recB } });
    expect(a.status).toBe("PAID");
    expect(b.status).toBe("PAID");
  });

  it("rejects an allocation total that does not equal the amount", async () => {
    const err = await recordPayment({
      ...base(), amount: 1000, allocations: [{ receivableId: recA, amount: 900 }],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("ALLOCATION_MISMATCH");
  });

  it("rejects an allocation larger than the outstanding balance", async () => {
    const err = await recordPayment({
      ...base(), amount: 2000, allocations: [{ receivableId: recA, amount: 2000 }],
    }).catch((e) => e);
    expect(err.code).toBe("OVER_ALLOCATED");
  });

  it("rejects a receivable belonging to another store", async () => {
    const err = await recordPayment({
      ...base(), amount: 700, allocations: [{ receivableId: otherRec, amount: 700 }],
    }).catch((e) => e);
    expect(err.code).toBe("WRONG_STORE");
  });

  it("rejects a zero or negative amount", async () => {
    const err = await recordPayment({
      ...base(), amount: 0, allocations: [{ receivableId: recA, amount: 0 }],
    }).catch((e) => e);
    expect(err.code).toBe("INVALID_AMOUNT");
  });

  it("rejects a negative amount", async () => {
    const err = await recordPayment({
      ...base(), amount: -100, allocations: [{ receivableId: recA, amount: -100 }],
    }).catch((e) => e);
    expect(err.code).toBe("INVALID_AMOUNT");
  });

  it("leaves a sub-rupiah residue at PARTIAL instead of rounding it into PAID", async () => {
    await recordPayment({ ...base(), amount: 1000, allocations: [{ receivableId: recResidual, amount: 1000 }] });
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recResidual } });
    expect(Number(after.outstandingAmount)).toBe(0.5);
    expect(after.status).toBe("PARTIAL");
  });

  it("rejects an allocation naming a receivable that does not exist", async () => {
    const err = await recordPayment({
      ...base(), amount: 100, allocations: [{ receivableId: `does-not-exist-${token}`, amount: 100 }],
    }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("rejects two allocations naming the same receivable", async () => {
    const err = await recordPayment({
      ...base(),
      amount: 1200,
      allocations: [{ receivableId: recA, amount: 600 }, { receivableId: recA, amount: 600 }],
    }).catch((e) => e);
    expect(err.code).toBe("DUPLICATE_ALLOCATION");
  });

  it("rejects a receivable that is WRITTEN_OFF", async () => {
    await prisma.receivable.update({ where: { id: recB }, data: { status: "WRITTEN_OFF" } });
    const err = await recordPayment({
      ...base(), amount: 100, allocations: [{ receivableId: recB, amount: 100 }],
    }).catch((e) => e);
    expect(err.code).toBe("ALREADY_SETTLED");
  });

  it("rejects an empty allocation list", async () => {
    const err = await recordPayment({ ...base(), amount: 100, allocations: [] }).catch((e) => e);
    expect(err.code).toBe("NO_ALLOCATIONS");
  });

  it("rejects a receivable that is already PAID", async () => {
    await recordPayment({ ...base(), amount: 1000, allocations: [{ receivableId: recA, amount: 1000 }] });
    const err = await recordPayment({
      ...base(), amount: 10, allocations: [{ receivableId: recA, amount: 10 }],
    }).catch((e) => e);
    expect(err.code).toBe("ALREADY_SETTLED");
  });

  it("replays an idempotency key without double-applying", async () => {
    const first = await recordPayment({
      ...base(), amount: 400, allocations: [{ receivableId: recA, amount: 400 }], idempotencyKey: `k-${token}`,
    });
    const second = await recordPayment({
      ...base(), amount: 400, allocations: [{ receivableId: recA, amount: 400 }], idempotencyKey: `k-${token}`,
    });
    expect(second.paymentId).toBe(first.paymentId);

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.outstandingAmount)).toBe(600);
  });

  it("refuses a retur-linked payment that would exceed the retur's remaining value", async () => {
    /* retur totalValue is 100_000; a 60_000 draw is already POSTED against it */
    await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 60000,
      recordedById: userId, allocations: [{ receivableId: receivableAId, amount: 60000 }],
      fieldReturnId: returnId, idempotencyKey: `test-draw-1-${token}`,
    });

    await expect(
      recordPayment({
        storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 40001,
        recordedById: userId, allocations: [{ receivableId: receivableBId, amount: 40001 }],
        fieldReturnId: returnId, idempotencyKey: `test-draw-2-${token}`,
      }),
    ).rejects.toMatchObject({ code: "EXCEEDS_REMAINING" });
  });

  it("allows a retur-linked payment that exactly exhausts the remaining value", async () => {
    await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 60000,
      recordedById: userId, allocations: [{ receivableId: receivableAId, amount: 60000 }],
      fieldReturnId: returnId, idempotencyKey: `test-draw-1-${token}`,
    });

    const { paymentId } = await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 40000,
      recordedById: userId, allocations: [{ receivableId: receivableBId, amount: 40000 }],
      fieldReturnId: returnId, idempotencyKey: `test-draw-2-${token}`,
    });

    const row = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { fieldReturnId: true },
    });
    expect(row?.fieldReturnId).toBe(returnId);
  });

  it("ignores VOIDED payments when computing the remaining value", async () => {
    const first = await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 100000,
      recordedById: userId, allocations: [{ receivableId: receivableAId, amount: 100000 }],
      fieldReturnId: returnId, idempotencyKey: `test-draw-1-${token}`,
    });
    await voidPayment({ paymentId: first.paymentId, reason: "test", voidedById: userId });

    const second = await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 100000,
      recordedById: userId, allocations: [{ receivableId: receivableAId, amount: 100000 }],
      fieldReturnId: returnId, idempotencyKey: `test-draw-2-${token}`,
    });
    expect(second.paymentId).not.toBe(first.paymentId);
  });

  it("rejects a draw against a retur with no frozen value yet", async () => {
    await prisma.fieldReturn.update({ where: { id: returnId }, data: { totalValue: null } });
    const err = await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 1000,
      recordedById: userId, allocations: [{ receivableId: receivableAId, amount: 1000 }],
      fieldReturnId: returnId,
    }).catch((e) => e);
    expect(err.code).toBe("NOT_VALUED");
  });

  it("rejects a draw naming a retur that does not exist", async () => {
    const err = await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 1000,
      recordedById: userId, allocations: [{ receivableId: receivableAId, amount: 1000 }],
      fieldReturnId: `does-not-exist-${token}`,
    }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
  });
});
