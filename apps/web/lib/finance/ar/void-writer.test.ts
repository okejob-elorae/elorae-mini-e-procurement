import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordPayment } from "./payment-writer";
import { voidPayment } from "./void-writer";
import { applyReturnOffset } from "./retur-offset-writer";
import { PaymentError } from "./errors";
import { returComponentKey, simpleComponentKey } from "@/lib/finance/ar-settlement/approve-writer";

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
  let returId = "";
  let settlementIds: string[] = [];

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = ""; userId = ""; orderAId = ""; orderBId = ""; deliveryAId = ""; deliveryBId = "";
    recA = ""; recB = ""; paymentId = ""; returId = ""; settlementIds = [];

    const store = await prisma.store.create({
      data: { code: `TEST-VOID-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;

    const user = await prisma.user.create({
      data: { email: `void-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;

    /*
     * relationMode="prisma" puts no FK behind Receivable.deliveryId — a deliveryId that does not
     * resolve to a real FieldSalesDelivery reads back with neither source relation, and
     * resolveReceivableSource throws ReceivableSourceMissingError wherever the row is resolved
     * (e.g. listReceivables's docNo / order.salesman.name). voidPayment itself never resolves the
     * source, but a fake string id here still leaves an orphan Receivable behind on the shared bed
     * if the teardown is ever interrupted, so the chain is real rows, not a synthetic string.
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
    /*
     * Deleted BEFORE fieldReturn, not relying on Prisma's emulated SetNull (relationMode =
     * "prisma") to clear Payment.fieldReturnId — a real FK would enforce that ordering, but under
     * emulation a failed clear throws and leaks every fixture below onto the shared :3308 bed.
     */
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    /*
     * Deductions before both the settlement and the retur they reference, for the same emulated
     * `relationMode = "prisma"` reason as the payments above.
     */
    await prisma.storeSettlementDeduction.deleteMany({
      where: { settlementId: { in: settlementIds.map(seededId) } },
    });
    await prisma.storeSettlement.deleteMany({ where: { id: { in: settlementIds.map(seededId) } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returId) } });
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

  it("refuses to void a payment against a voided receivable", async () => {
    await prisma.receivable.update({ where: { id: recA }, data: { status: "VOIDED" } });

    const err = await voidPayment({ paymentId, reason: "trying to void", voidedById: userId }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("ALREADY_SETTLED");

    /* The refusal is total: the flip and the voided status both stand, untouched. */
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("POSTED");

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(400);
    expect(Number(after.outstandingAmount)).toBe(600);
    expect(after.status).toBe("VOIDED");
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

  it("re-projects appliedValue down by the voided draw and leaves the rest applied", async () => {
    const orderB = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-ARVW-ORDB-${token}`, storeId, salesmanId: userId, subtotal: 100000, total: 100000 },
    });
    orderBId = orderB.id;

    const deliveryB = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-ARVW-DLVB-${token}`, orderId: orderBId,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: 100000, total: 100000,
      },
    });
    deliveryBId = deliveryB.id;

    const b = await prisma.receivable.create({
      data: {
        deliveryId: deliveryBId, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: 100000, outstandingAmount: 100000,
      },
    });
    recB = b.id;

    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-VOID-RET-${token}`, storeId, raisedById: userId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 100000, approvedAt: paidAt, approvedById: userId,
      },
    });
    returId = ret.id;

    const first = await applyReturnOffset({
      returnId: returId, eventId: "evt-1", drawAmount: 40000,
      allocations: [{ receivableId: recB, amount: 40000 }], appliedById: userId,
    });
    await applyReturnOffset({
      returnId: returId, eventId: "evt-2", drawAmount: 60000,
      allocations: [{ receivableId: recB, amount: 60000 }], appliedById: userId,
    });

    await voidPayment({ paymentId: first.paymentId, reason: "test", voidedById: userId });

    const released = await prisma.fieldReturn.findUnique({
      where: { id: returId },
      select: { offsetStatus: true, appliedValue: true },
    });
    expect(Number(released?.appliedValue)).toBe(60000);
    expect(released?.offsetStatus).toBe("AVAILABLE");

    /* The history link: the voided draw keeps pointing at its retur (the register reads it to show
     * the drawn-then-voided attempt), while the projection above already excluded its amount. */
    const voided = await prisma.payment.findUniqueOrThrow({
      where: { id: first.paymentId },
      select: { status: true, fieldReturnId: true },
    });
    expect(voided.status).toBe("VOIDED");
    expect(voided.fieldReturnId).toBe(returId);
  });

  it("leaves a payment with no retur behind it untouched", async () => {
    const cash = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 100,
      recordedById: userId, allocations: [{ receivableId: recA, amount: 100 }],
    });
    const result = await voidPayment({ paymentId: cash.paymentId, reason: "test", voidedById: userId });
    expect(result.voided).toBe(true);
  });

  it("voiding a CASH payment leaves every retur untouched (zero-rows no-op)", async () => {
    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-VOID-RET2-${token}`, storeId, raisedById: userId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE", totalValue: 100,
      },
    });
    returId = ret.id;

    await voidPayment({ paymentId, reason: "wrong amount keyed", voidedById: userId });

    const untouched = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: returId } });
    expect(untouched.offsetStatus).toBe("AVAILABLE");
    const untouchedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(untouchedPayment.fieldReturnId).toBeNull();
  });

  /** A store settlement row only; its components are posted by each test under the real keys. */
  async function seedSettlement(status: "PENDING" | "APPROVED" | "REJECTED"): Promise<{ id: string; docNo: string }> {
    const settlement = await prisma.storeSettlement.create({
      data: {
        docNo: `TEST-VOID-STL-${status}-${token}`,
        storeId,
        salesmanId: userId,
        expectedAmount: 300,
        actualAmount: 300,
        varianceAmount: 0,
        status,
      },
      select: { id: true, docNo: true },
    });
    settlementIds.push(settlement.id);
    return settlement;
  }

  /** What the refusal must leave behind: nothing written, the beforeEach 400 plus the component's 300 still applied. */
  async function expectComponentUntouched(componentId: string): Promise<void> {
    const component = await prisma.payment.findUniqueOrThrow({ where: { id: componentId } });
    expect(component.status).toBe("POSTED");
    expect(component.voidedAt).toBeNull();
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(700);
    expect(Number(after.outstandingAmount)).toBe(300);
    expect(after.status).toBe("PARTIAL");
    expect(await prisma.journal.count({ where: { sourceType: "PAYMENT_VOID", sourceId: componentId } })).toBe(0);
  }

  it("refuses SETTLEMENT_COMPONENT, naming the settlement, for a cash component of an APPROVED settlement", async () => {
    const settlement = await seedSettlement("APPROVED");
    const component = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 300, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 300 }],
      idempotencyKey: simpleComponentKey(settlement.id, "CASH"),
    });

    const err = await voidPayment({
      paymentId: component.paymentId, reason: "wrong amount keyed", voidedById: userId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("SETTLEMENT_COMPONENT");
    expect(err.detail).toBe(settlement.docNo);

    await expectComponentUntouched(component.paymentId);
  });

  it("refuses SETTLEMENT_COMPONENT for a retur draw of an APPROVED settlement and leaves the retur drawn", async () => {
    const settlement = await seedSettlement("APPROVED");
    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-VOID-STLRET-${token}`, storeId, raisedById: userId,
        status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE",
        totalValue: 1000, approvedAt: paidAt, approvedById: userId,
      },
    });
    returId = ret.id;
    const deduction = await prisma.storeSettlementDeduction.create({
      data: { settlementId: settlement.id, type: "RETUR_OFFSET", amount: 300, fieldReturnId: returId },
    });
    /* The event id is the deduction row's id, exactly as `approveSettlement` draws it. */
    const draw = await applyReturnOffset({
      returnId: returId, eventId: deduction.id, drawAmount: 300,
      allocations: [{ receivableId: recA, amount: 300 }], appliedById: userId,
    });
    const drawn = await prisma.payment.findUniqueOrThrow({ where: { id: draw.paymentId } });
    expect(drawn.idempotencyKey).toBe(returComponentKey(returId, deduction.id));

    const err = await voidPayment({ paymentId: draw.paymentId, reason: "test", voidedById: userId }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("SETTLEMENT_COMPONENT");
    expect(err.detail).toBe(settlement.docNo);

    await expectComponentUntouched(draw.paymentId);
    const retur = await prisma.fieldReturn.findUniqueOrThrow({
      where: { id: returId },
      select: { appliedValue: true },
    });
    expect(Number(retur.appliedValue)).toBe(300);
  });

  /* The admin-fee key pins that the lookup covers the method-mapped keys, not only CASH. */
  it("refuses SETTLEMENT_COMPONENT for an admin-fee component of an APPROVED settlement", async () => {
    const settlement = await seedSettlement("APPROVED");
    const component = await recordPayment({
      storeId, paidAt, method: "ADMIN_FEE", amount: 300, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 300 }],
      idempotencyKey: simpleComponentKey(settlement.id, "ADMIN_FEE"),
    });

    const err = await voidPayment({ paymentId: component.paymentId, reason: "test", voidedById: userId }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("SETTLEMENT_COMPONENT");
    expect(err.detail).toBe(settlement.docNo);

    await expectComponentUntouched(component.paymentId);
  });

  /*
   * A half-run approval: the document is still PENDING but this component already posted. The void
   * goes through — the resume then refuses `COMPONENT_VOIDED` (pinned in the approve-writer spec),
   * which makes void-each-then-reject that settlement's safe exit.
   */
  it("voids a posted component of a PENDING settlement", async () => {
    const settlement = await seedSettlement("PENDING");
    const component = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 300, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 300 }],
      idempotencyKey: simpleComponentKey(settlement.id, "CASH"),
    });

    const result = await voidPayment({ paymentId: component.paymentId, reason: "half-run", voidedById: userId });
    expect(result.voided).toBe(true);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(400);
  });

  /*
   * A REJECTED settlement's posted components are the orphans the approval screen lists, and
   * voiding them is their remedy — the reject guard means a REJECTED document holds none it did
   * not already strand, so nothing is left for a void to desynchronise.
   */
  it("voids a posted component left behind by a REJECTED settlement", async () => {
    const settlement = await seedSettlement("REJECTED");
    const component = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 300, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 300 }],
      idempotencyKey: simpleComponentKey(settlement.id, "CASH"),
    });

    const result = await voidPayment({ paymentId: component.paymentId, reason: "orphan", voidedById: userId });
    expect(result.voided).toBe(true);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(400);
  });

  /*
   * Keyed on purpose: an unkeyed payment returns before the settlement read, so only a keyed one
   * proves the match does not over-reach to an APPROVED settlement it is not a component of.
   */
  it("voids a keyed payment that is no settlement's component even while the store has an APPROVED settlement", async () => {
    await seedSettlement("APPROVED");
    const keyed = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 300, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 300 }],
      idempotencyKey: `test-void-manual-${token}`,
    });
    const result = await voidPayment({ paymentId: keyed.paymentId, reason: "wrong amount keyed", voidedById: userId });
    expect(result.voided).toBe(true);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: recA } });
    expect(Number(after.paidAmount)).toBe(400);
  });

  /* The idempotent replay stays ahead of the refusal: an already-voided component still reads as a no-op. */
  it("still short-circuits an already-voided component of an APPROVED settlement", async () => {
    const settlement = await seedSettlement("APPROVED");
    const component = await recordPayment({
      storeId, paidAt, method: "CASH", amount: 300, recordedById: userId,
      allocations: [{ receivableId: recA, amount: 300 }],
      idempotencyKey: simpleComponentKey(settlement.id, "CASH"),
    });
    await prisma.payment.update({ where: { id: component.paymentId }, data: { status: "VOIDED" } });

    const result = await voidPayment({ paymentId: component.paymentId, reason: "again", voidedById: userId });
    expect(result.voided).toBe(false);
  });
});
