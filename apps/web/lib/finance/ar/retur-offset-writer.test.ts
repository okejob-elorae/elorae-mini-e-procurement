import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { applyReturnOffset } from "./retur-offset-writer";
import { recordPayment } from "./payment-writer";
import { voidPayment } from "./void-writer";
import { PaymentError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("applyReturnOffset (test bed only)", () => {
  let token = "";
  let storeId = "";
  let otherStoreId = "";
  let userId = "";
  let uomId = "";
  let itemId = "";
  let orderId = "";
  let deliveryAId = "";
  let deliveryBId = "";
  let receivableAId = "";
  let receivableBId = "";
  let otherOrderId = "";
  let otherDeliveryId = "";
  let otherReceivableId = "";
  let returnId = "";

  async function makeReturn(overrides: Partial<{
    status: "PENDING_APPROVAL" | "APPROVED";
    valuationStatus: "PENDING" | "VALUED";
    offsetStatus: "AVAILABLE" | "APPLIED";
    totalValue: number | null;
  }> = {}): Promise<string> {
    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-ROW-RET-${token}`, storeId, raisedById: userId,
        status: overrides.status ?? "APPROVED",
        valuationStatus: overrides.valuationStatus ?? "VALUED",
        offsetStatus: overrides.offsetStatus ?? "AVAILABLE",
        totalValue: overrides.totalValue === undefined ? 100000 : overrides.totalValue,
        approvedAt: new Date(), approvedById: userId,
      },
    });
    /* Tracked for teardown BEFORE the line create — a throw in between would otherwise orphan a
       FieldReturn row on the shared test bed with nothing holding its id. */
    returnId = ret.id;
    await prisma.fieldReturnLine.create({
      data: { returnId: ret.id, itemId, qty: 5, reason: "UNSOLD" },
    });
    return ret.id;
  }

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; otherStoreId = ""; userId = ""; uomId = ""; itemId = "";
    orderId = ""; deliveryAId = ""; deliveryBId = ""; receivableAId = ""; receivableBId = "";
    otherOrderId = ""; otherDeliveryId = ""; otherReceivableId = ""; returnId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-ROW-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const otherStore = await prisma.store.create({
      data: { code: `TEST-ROW-OTH-${token}`, name: "other", address: "test", termsType: "PUTUS" },
    });
    otherStoreId = otherStore.id;
    const user = await prisma.user.create({ data: { email: `row-${token}@test.local`, name: "test", role: "ADMIN" } });
    userId = user.id;
    const uom = await prisma.uOM.create({ data: { code: `TEST-ROW-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-ROW-ITEM-${token}`, nameId: "t", nameEn: "t", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;

    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ROW-ORD-${token}`, storeId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    orderId = order.id;

    const deliveryA = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ROW-DLV-A-${token}`, orderId, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date("2026-05-01"), subtotal: 100000, total: 100000,
      },
    });
    deliveryAId = deliveryA.id;
    const receivableA = await prisma.receivable.create({
      data: {
        deliveryId: deliveryAId, storeId, invoiceDate: new Date(), dueDate: new Date("2026-05-01"),
        originalAmount: 100000, outstandingAmount: 100000,
      },
    });
    receivableAId = receivableA.id;

    /*
     * A second receivable of the SAME store, standing by for the draw-down tests that split a
     * retur's value across two of its receivables in one call, or across two separate draws.
     * Receivable.deliveryId is @unique, so it needs its own delivery.
     */
    const deliveryB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ROW-DLV-B-${token}`, orderId, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date("2026-05-01"), subtotal: 100000, total: 100000,
      },
    });
    deliveryBId = deliveryB.id;
    const receivableB = await prisma.receivable.create({
      data: {
        deliveryId: deliveryBId, storeId, invoiceDate: new Date(), dueDate: new Date("2026-05-01"),
        originalAmount: 100000, outstandingAmount: 100000,
      },
    });
    receivableBId = receivableB.id;

    /*
     * Receivable.deliveryId is @unique, so a cross-store receivable needs its OWN delivery (and
     * therefore its own order) — it cannot reuse the storeId-scoped deliveries above.
     */
    const otherOrder = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ROW-OTH-ORD-${token}`, storeId: otherStoreId, salesmanId: userId, subtotal: 1000, total: 1000 },
    });
    otherOrderId = otherOrder.id;
    const otherDelivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ROW-OTH-DLV-${token}`, orderId: otherOrderId, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date("2026-05-01"), subtotal: 1000, total: 1000,
      },
    });
    otherDeliveryId = otherDelivery.id;
    const otherReceivable = await prisma.receivable.create({
      data: {
        deliveryId: otherDeliveryId, storeId: otherStoreId, invoiceDate: new Date(), dueDate: new Date("2026-05-01"),
        originalAmount: 1000, outstandingAmount: 1000,
      },
    });
    otherReceivableId = otherReceivable.id;
  });

  afterEach(async () => {
    const payments = await prisma.payment.findMany({ where: { storeId: { in: [seededId(storeId), seededId(otherStoreId)] } }, select: { id: true } });
    const paymentIds = payments.map((p) => p.id);
    if (paymentIds.length) {
      await prisma.payment.updateMany({ where: { id: { in: paymentIds } }, data: { fieldReturnId: null } });
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.receivable.deleteMany({
      where: { id: { in: [seededId(receivableAId), seededId(receivableBId), seededId(otherReceivableId)] } },
    });
    await prisma.fieldSalesDelivery.deleteMany({
      where: { id: { in: [seededId(deliveryAId), seededId(deliveryBId), seededId(otherDeliveryId)] } },
    });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: [seededId(orderId), seededId(otherOrderId)] } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(otherStoreId)] } } });
  });

  it("refuses a return that does not exist", async () => {
    const err = await applyReturnOffset({
      returnId: `does-not-exist-${token}`, eventId: "evt-1", drawAmount: 1000,
      allocations: [{ receivableId: receivableAId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("refuses a return that is not APPROVED", async () => {
    returnId = await makeReturn({ status: "PENDING_APPROVAL", valuationStatus: "PENDING", totalValue: null });
    const err = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 1000,
      allocations: [{ receivableId: receivableAId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("RETURN_NOT_APPROVED");
  });

  it("refuses a return that is APPROVED but not VALUED", async () => {
    returnId = await makeReturn({ valuationStatus: "PENDING", totalValue: null });
    const err = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 1000,
      allocations: [{ receivableId: receivableAId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("NOT_VALUED");
  });

  it("refuses when the draw exceeds the store's total outstanding", async () => {
    await prisma.receivable.update({ where: { id: receivableAId }, data: { outstandingAmount: 200 } });
    await prisma.receivable.update({ where: { id: receivableBId }, data: { outstandingAmount: 200 } });
    returnId = await makeReturn();
    const err = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 1000,
      allocations: [{ receivableId: receivableAId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("INSUFFICIENT_OUTSTANDING");
  });

  it("refuses a cross-store receivable via recordPayment's own guard", async () => {
    returnId = await makeReturn();
    const err = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 1000,
      allocations: [{ receivableId: otherReceivableId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("WRONG_STORE");
    const payments = await prisma.payment.findMany({ where: { storeId } });
    expect(payments).toHaveLength(0);
  });

  it("draws part of a retur and leaves it AVAILABLE with the remainder", async () => {
    returnId = await makeReturn();
    await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });

    const ret = await prisma.fieldReturn.findUnique({
      where: { id: returnId },
      select: { offsetStatus: true, appliedValue: true },
    });
    expect(ret?.offsetStatus).toBe("AVAILABLE");
    expect(Number(ret?.appliedValue)).toBe(40000);
  });

  it("flips to APPLIED only when the final draw exhausts the value", async () => {
    returnId = await makeReturn();
    await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });
    await applyReturnOffset({
      returnId, eventId: "evt-2", drawAmount: 60000,
      allocations: [{ receivableId: receivableBId, amount: 60000 }], appliedById: userId,
    });

    const ret = await prisma.fieldReturn.findUnique({
      where: { id: returnId },
      select: { offsetStatus: true, appliedValue: true },
    });
    expect(ret?.offsetStatus).toBe("APPLIED");
    expect(Number(ret?.appliedValue)).toBe(100000);
  });

  it("refuses a draw larger than what is left", async () => {
    returnId = await makeReturn();
    await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 60000,
      allocations: [{ receivableId: receivableAId, amount: 60000 }], appliedById: userId,
    });

    await expect(
      applyReturnOffset({
        returnId, eventId: "evt-2", drawAmount: 40001,
        allocations: [{ receivableId: receivableBId, amount: 40001 }], appliedById: userId,
      }),
    ).rejects.toMatchObject({ code: "EXCEEDS_REMAINING" });
  });

  it("refuses allocations that do not sum to the requested draw", async () => {
    returnId = await makeReturn();
    await expect(
      applyReturnOffset({
        returnId, eventId: "evt-1", drawAmount: 40000,
        allocations: [{ receivableId: receivableAId, amount: 39000 }], appliedById: userId,
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_MISMATCH" });
  });

  it("splits a single draw across two of the store's receivables", async () => {
    returnId = await makeReturn();
    const result = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 60000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }, { receivableId: receivableBId, amount: 20000 }],
      appliedById: userId,
    });
    expect(result.ok).toBe(true);

    const a = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableAId } });
    const b = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableBId } });
    expect(Number(a.outstandingAmount)).toBe(60000);
    expect(Number(b.outstandingAmount)).toBe(80000);

    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(ret.offsetStatus).toBe("AVAILABLE");
    expect(Number(ret.appliedValue)).toBe(60000);
  });

  it("is idempotent for a replayed eventId", async () => {
    returnId = await makeReturn();
    const first = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });
    const replay = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });

    expect(replay.paymentId).toBe(first.paymentId);
    const ret = await prisma.fieldReturn.findUnique({
      where: { id: returnId }, select: { appliedValue: true },
    });
    expect(Number(ret?.appliedValue)).toBe(40000);
  });

  it("recovers cleanly when a crash left a payment posted but the retur was never projected", async () => {
    returnId = await makeReturn();
    /*
     * Simulates a crash between recordPayment committing and projectReturnOffset running: calls
     * recordPayment directly with the same deterministic key and fieldReturnId applyReturnOffset
     * would use, so a real POSTED payment exists and the receivable is already decremented, but
     * the retur's own appliedValue/offsetStatus were never recomputed — exactly the state a real
     * crash in that window leaves behind.
     */
    const crashed = await recordPayment({
      storeId, paidAt: new Date(), method: "RETUR_OFFSET", amount: 40000, recordedById: userId,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], reference: "crash-sim",
      idempotencyKey: `returoffset-${returnId}-evt-1`,
      fieldReturnId: returnId,
    });

    const result = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });
    expect(result.ok).toBe(true);
    expect(result.paymentId).toBe(crashed.paymentId);
    expect(result.alreadyApplied).toBe(true);

    const payments = await prisma.payment.findMany({ where: { storeId } });
    expect(payments).toHaveLength(1);

    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(ret.offsetStatus).toBe("AVAILABLE");
    expect(Number(ret.appliedValue)).toBe(40000);
  });

  it("refuses a replay of an event whose payment was voided", async () => {
    returnId = await makeReturn();
    const first = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });
    await voidPayment({ paymentId: first.paymentId, reason: "test", voidedById: userId });

    await expect(
      applyReturnOffset({
        returnId, eventId: "evt-1", drawAmount: 40000,
        allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_VOIDED" });
  });

  it("allows a fresh eventId to re-draw after a void", async () => {
    returnId = await makeReturn();
    const first = await applyReturnOffset({
      returnId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });
    await voidPayment({ paymentId: first.paymentId, reason: "test", voidedById: userId });

    const second = await applyReturnOffset({
      returnId, eventId: "evt-2", drawAmount: 40000,
      allocations: [{ receivableId: receivableAId, amount: 40000 }], appliedById: userId,
    });
    expect(second.paymentId).not.toBe(first.paymentId);
  });
});
