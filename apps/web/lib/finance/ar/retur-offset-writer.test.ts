import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { applyReturnOffset } from "./retur-offset-writer";
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
  let deliveryId = "";
  let receivableId = "";
  let otherOrderId = "";
  let otherDeliveryId = "";
  let otherReceivableId = "";
  /* Set only by the "splits across two receivables" test — describe-scoped so the shared
     afterEach (not the test itself) deletes it, after payments/allocations are cleared. A test
     deleting its own extra receivable inline races the still-live PaymentAllocation row that
     points at it: relationMode="prisma" emulates a required-relation check on delete, so deleting
     a Receivable a PaymentAllocation still references throws. */
  let secondDeliveryId = "";
  let secondReceivableId = "";
  let returId = "";

  async function makeReturn(overrides: Partial<{
    status: "PENDING_APPROVAL" | "APPROVED";
    valuationStatus: "PENDING" | "VALUED";
    offsetStatus: "AVAILABLE" | "APPLIED";
    totalValue: number | null;
    offsetPaymentId: string | null;
  }> = {}): Promise<string> {
    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-ROW-RET-${token}`, storeId, raisedById: userId,
        status: overrides.status ?? "APPROVED",
        valuationStatus: overrides.valuationStatus ?? "VALUED",
        offsetStatus: overrides.offsetStatus ?? "AVAILABLE",
        totalValue: overrides.totalValue === undefined ? 1000 : overrides.totalValue,
        offsetPaymentId: overrides.offsetPaymentId ?? null,
        approvedAt: new Date(), approvedById: userId,
      },
    });
    await prisma.fieldReturnLine.create({
      data: { returnId: ret.id, itemId, qty: 5, reason: "UNSOLD" },
    });
    return ret.id;
  }

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; otherStoreId = ""; userId = ""; uomId = ""; itemId = "";
    orderId = ""; deliveryId = ""; receivableId = "";
    otherOrderId = ""; otherDeliveryId = ""; otherReceivableId = "";
    secondDeliveryId = ""; secondReceivableId = ""; returId = "";

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
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ROW-DLV-${token}`, orderId, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date("2026-05-01"), subtotal: 1000, total: 1000,
      },
    });
    deliveryId = delivery.id;
    const receivable = await prisma.receivable.create({
      data: {
        deliveryId, storeId, invoiceDate: new Date(), dueDate: new Date("2026-05-01"),
        originalAmount: 1000, outstandingAmount: 1000,
      },
    });
    receivableId = receivable.id;

    /*
     * Receivable.deliveryId is @unique, so a cross-store receivable needs its OWN delivery (and
     * therefore its own order) — it cannot reuse the storeId-scoped delivery above.
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
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: { in: [] } } } });
    const payments = await prisma.payment.findMany({ where: { storeId: { in: [seededId(storeId), seededId(otherStoreId)] } }, select: { id: true } });
    const paymentIds = payments.map((p) => p.id);
    if (paymentIds.length) {
      await prisma.fieldReturn.updateMany({ where: { offsetPaymentId: { in: paymentIds } }, data: { offsetPaymentId: null } });
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returId) } });
    await prisma.receivable.deleteMany({
      where: { id: { in: [seededId(receivableId), seededId(otherReceivableId), seededId(secondReceivableId)] } },
    });
    await prisma.fieldSalesDelivery.deleteMany({
      where: { id: { in: [seededId(deliveryId), seededId(otherDeliveryId), seededId(secondDeliveryId)] } },
    });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: [seededId(orderId), seededId(otherOrderId)] } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(otherStoreId)] } } });
  });

  it("refuses a return that is not APPROVED", async () => {
    returId = await makeReturn({ status: "PENDING_APPROVAL", valuationStatus: "PENDING", totalValue: null });
    const err = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("RETURN_NOT_APPROVED");
  });

  it("refuses a return that is APPROVED but not VALUED", async () => {
    returId = await makeReturn({ valuationStatus: "PENDING", totalValue: null });
    const err = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("NOT_VALUED");
  });

  it("refuses when the allocations don't sum to the return's totalValue", async () => {
    returId = await makeReturn({ totalValue: 1000 });
    const err = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 700 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("ALLOCATION_MISMATCH");
  });

  it("refuses when the return's value exceeds the store's total outstanding", async () => {
    await prisma.receivable.update({ where: { id: receivableId }, data: { outstandingAmount: 400 } });
    returId = await makeReturn({ totalValue: 1000 });
    const err = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("INSUFFICIENT_OUTSTANDING");
  });

  it("refuses a cross-store receivable via recordPayment's own guard", async () => {
    returId = await makeReturn({ totalValue: 1000 });
    const err = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId: otherReceivableId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("WRONG_STORE");
  });

  it("creates a RETUR_OFFSET payment, decrements the receivable, and flips offsetStatus to APPLIED", async () => {
    returId = await makeReturn({ totalValue: 1000 });
    const result = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    });
    expect(result.ok).toBe(true);
    expect(result.alreadyApplied).toBeUndefined();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.method).toBe("RETUR_OFFSET");
    expect(Number(payment.amount)).toBe(1000);

    const receivable = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(Number(receivable.outstandingAmount)).toBe(0);
    expect(receivable.status).toBe("PAID");

    const ret = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: returId } });
    expect(ret.offsetStatus).toBe("APPLIED");
    expect(ret.offsetPaymentId).toBe(result.paymentId);
  });

  it("a second call for the same return returns the same payment and creates nothing new", async () => {
    returId = await makeReturn({ totalValue: 1000 });
    const first = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    });
    const err = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    /* offsetStatus is already APPLIED by the time this second call's own guard runs. */
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("ALREADY_APPLIED");

    const payments = await prisma.payment.findMany({ where: { storeId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].id).toBe(first.paymentId);
  });

  it("refuses re-application when the idempotency key resolves to a voided payment", async () => {
    returId = await makeReturn({ totalValue: 1000 });
    const first = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    });
    /*
     * Simulates what Task 7's void-writer will do: void the payment, release the retur back to
     * AVAILABLE. Task 7 hasn't landed yet, so this manually reproduces its effect to prove THIS
     * writer's own re-application guard holds regardless of what releases the retur.
     */
    await prisma.payment.update({ where: { id: first.paymentId }, data: { status: "VOIDED" } });
    await prisma.fieldReturn.update({ where: { id: returId }, data: { offsetStatus: "AVAILABLE", offsetPaymentId: null } });
    await prisma.receivable.update({ where: { id: receivableId }, data: { outstandingAmount: 1000, status: "OUTSTANDING" } });

    const err = await applyReturnOffset({
      returnId: returId, allocations: [{ receivableId, amount: 1000 }], appliedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("PAYMENT_VOIDED");
  });

  it("splits across two of the store's receivables when allocations name both", async () => {
    const secondDelivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ROW-DLV2-${token}`, orderId, deliveredAt: new Date(), deliveredById: userId,
        invoiceDate: new Date(), dueDate: new Date("2026-05-01"), subtotal: 500, total: 500,
      },
    });
    secondDeliveryId = secondDelivery.id;
    const secondReceivable = await prisma.receivable.create({
      data: {
        deliveryId: secondDeliveryId, storeId, invoiceDate: new Date(), dueDate: new Date("2026-05-01"),
        originalAmount: 500, outstandingAmount: 500,
      },
    });
    secondReceivableId = secondReceivable.id;

    returId = await makeReturn({ totalValue: 1200 });
    const result = await applyReturnOffset({
      returnId: returId,
      allocations: [{ receivableId, amount: 1000 }, { receivableId: secondReceivableId, amount: 200 }],
      appliedById: userId,
    });
    expect(result.ok).toBe(true);

    const first = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    const second = await prisma.receivable.findUniqueOrThrow({ where: { id: secondReceivableId } });
    expect(Number(first.outstandingAmount)).toBe(0);
    expect(Number(second.outstandingAmount)).toBe(300);

    /* No inline cleanup here — secondReceivableId/secondDeliveryId are torn down by the shared
       afterEach, AFTER it clears the PaymentAllocation row this test's payment created against
       secondReceivable. Deleting inline, before that row is gone, throws under
       relationMode="prisma"'s emulated required-relation check. */
  });
});
