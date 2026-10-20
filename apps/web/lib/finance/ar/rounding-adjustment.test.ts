import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordPayment, recordRoundingAdjustment } from "./payment-writer";
import { voidPayment } from "./void-writer";
import { postPaymentReceiptJournal, postPaymentVoidJournal } from "./payment-journal";
import { PaymentError } from "./errors";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const invoiceDate = new Date("2026-03-01T00:00:00.000+07:00");

d("recordRoundingAdjustment (test bed only)", () => {
  let token = "";
  let seq = 0;
  let storeId = "";
  let userId = "";
  let roundingAccountId = "";
  let arAccountId = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let receivableIds: string[] = [];
  let mappingSnapshot: MappingSnapshot | undefined;

  beforeEach(async () => {
    /**
     * Regenerated per test: Store.code, User.email, the order and delivery doc numbers and the
     * chart account codes are all unique on this token, so one leaked teardown cannot make the
     * next test collide in this hook.
     */
    token = Math.random().toString(36).slice(2, 10);
    seq = 0;
    storeId = ""; userId = ""; roundingAccountId = ""; arAccountId = "";
    orderIds = []; deliveryIds = []; receivableIds = [];
    mappingSnapshot = undefined;
    mappingSnapshot = await snapshotMappings(["ROUNDING_EXPENSE", "AR"]);

    const store = await prisma.store.create({
      data: { code: `TEST-RND-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const user = await prisma.user.create({
      data: { email: `rnd-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;

    const account = async (suffix: string, type: "ASET" | "BEBAN") =>
      (await prisma.chartAccount.create({
        data: { code: `9R${token}${suffix}`, name: "t", type, depth: 1, isActive: true },
      })).id;
    roundingAccountId = await account("1", "BEBAN");
    arAccountId = await account("2", "ASET");
    for (const [role, chartAccountId] of [["ROUNDING_EXPENSE", roundingAccountId], ["AR", arAccountId]] as const) {
      await prisma.journalAccountMapping.upsert({
        where: { role },
        create: { role, chartAccountId },
        update: { chartAccountId },
      });
    }
  });

  afterEach(async () => {
    /* Live config first, so no bookkeeping delete below can stand between a failure and restoring it. */
    if (mappingSnapshot) await restoreMappings(mappingSnapshot);
    const paymentIds = (
      await prisma.payment.findMany({ where: { storeId: seededId(storeId) }, select: { id: true } })
    ).map((p) => p.id);
    const sourceIds = [...paymentIds, ...deliveryIds];
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: { in: sourceIds.map(seededId) } } } });
    await prisma.journal.deleteMany({ where: { sourceId: { in: sourceIds.map(seededId) } } });
    await prisma.collectionSubmission.deleteMany({ where: { receivableId: { in: receivableIds.map(seededId) } } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds.map(seededId) } } });
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    /* Receivables before the delivery they hang off (an optional 1:1 under relationMode = "prisma"). */
    await prisma.receivable.deleteMany({ where: { id: { in: receivableIds.map(seededId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds.map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds.map(seededId) } } });
    await prisma.chartAccount.deleteMany({
      where: { id: { in: [seededId(roundingAccountId), seededId(arAccountId)] } },
    });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  /**
   * A putus invoice of `original` with `outstanding` left on it, its revenue journal standing so
   * the receipt gate treats it as in the ledger. A bare journal row stands in for the real post:
   * the gate checks only that it exists.
   */
  async function makeReceivable(original: number, outstanding: number): Promise<string> {
    const n = ++seq;
    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-RND-ORD-${token}-${n}`, storeId, salesmanId: userId, subtotal: original, total: original },
    });
    orderIds.push(order.id);
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-RND-DLV-${token}-${n}`, orderId: order.id,
        deliveredAt: invoiceDate, deliveredById: userId,
        invoiceDate, dueDate: invoiceDate,
        subtotal: original, total: original,
      },
    });
    deliveryIds.push(delivery.id);
    const receivable = await prisma.receivable.create({
      data: {
        deliveryId: delivery.id, storeId,
        invoiceDate, dueDate: invoiceDate,
        originalAmount: original,
        paidAmount: original - outstanding,
        outstandingAmount: outstanding,
        status: outstanding === original ? "OUTSTANDING" : "PARTIAL",
      },
    });
    receivableIds.push(receivable.id);
    await prisma.journal.create({
      data: {
        date: invoiceDate, description: "fixture", sourceType: "FIELD_DELIVERY_REVENUE",
        sourceId: delivery.id, postedById: userId,
      },
    });
    return receivable.id;
  }

  const adjust = (receivableId: string, eventId: string = crypto.randomUUID()) =>
    recordRoundingAdjustment({ receivableId, actorId: userId, eventId });

  const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof PaymentError ? e.code : e));

  it("closes a sub-rupiah residue to PAID with a balanced DR ROUNDING_EXPENSE / CR AR journal", async () => {
    const receivableId = await makeReceivable(1000.4, 0.4);
    const res = await adjust(receivableId);
    expect(res.alreadyApplied).toBe(false);

    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(Number(after.outstandingAmount)).toBe(0);
    expect(Number(after.paidAmount)).toBe(1000.4);
    expect(after.status).toBe("PAID");

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: res.paymentId },
      include: { allocations: true },
    });
    expect(payment.method).toBe("ROUNDING_ADJUSTMENT");
    expect(Number(payment.amount)).toBe(0.4);
    expect(payment.allocations).toHaveLength(1);

    const posted = await postPaymentReceiptJournal(res.paymentId, userId);
    expect(posted).toMatchObject({ ok: true });
    const journal = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_RECEIPT", sourceId: res.paymentId } },
      include: { lines: true },
    });
    const debit = journal.lines.find((l) => l.chartAccountId === roundingAccountId);
    const credit = journal.lines.find((l) => l.chartAccountId === arAccountId);
    expect(Number(debit?.debit)).toBe(0.4);
    expect(Number(credit?.credit)).toBe(0.4);
    const totalDebit = journal.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = journal.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 6);
  });

  it("replays the same event as the same payment without writing off twice", async () => {
    const receivableId = await makeReceivable(500.25, 0.25);
    const eventId = crypto.randomUUID();
    const first = await adjust(receivableId, eventId);
    const second = await adjust(receivableId, eventId);
    expect(second).toMatchObject({ paymentId: first.paymentId, alreadyApplied: true });
    expect(await prisma.payment.count({ where: { storeId } })).toBe(1);
  });

  it("refuses a second event against a receivable the first already closed", async () => {
    const receivableId = await makeReceivable(500.25, 0.25);
    await adjust(receivableId);
    expect(await codeOf(adjust(receivableId))).toBe("ALREADY_SETTLED");
  });

  it.each([
    ["exactly one rupiah", 1],
    ["more than one rupiah", 1.5],
    ["a whole real balance", 250],
  ])("refuses %s outstanding as NOT_A_RESIDUE", async (_label, outstanding) => {
    const receivableId = await makeReceivable(1000, outstanding);
    expect(await codeOf(adjust(receivableId))).toBe("NOT_A_RESIDUE");
    expect(await prisma.payment.count({ where: { storeId } })).toBe(0);
  });

  it("refuses a receivable with nothing outstanding", async () => {
    const receivableId = await makeReceivable(1000, 0);
    await prisma.receivable.update({ where: { id: receivableId }, data: { status: "PARTIAL" } });
    expect(await codeOf(adjust(receivableId))).toBe("NOT_A_RESIDUE");
  });

  it.each(["WRITTEN_OFF", "VOIDED"] as const)("refuses a %s receivable as ALREADY_SETTLED", async (status) => {
    const receivableId = await makeReceivable(1000.4, 0.4);
    await prisma.receivable.update({ where: { id: receivableId }, data: { status } });
    expect(await codeOf(adjust(receivableId))).toBe("ALREADY_SETTLED");
    expect(await prisma.payment.count({ where: { storeId } })).toBe(0);
  });

  it("refuses while a collection submission is still pending against the residue", async () => {
    const receivableId = await makeReceivable(1000.4, 0.4);
    await prisma.collectionSubmission.create({
      data: { receivableId, collectorId: userId, amount: 0.4, method: "CASH", paidAt: invoiceDate },
    });
    expect(await codeOf(adjust(receivableId))).toBe("PENDING_CLAIM");
    expect(await prisma.payment.count({ where: { storeId } })).toBe(0);
  });

  it("refuses a malformed event id before reading anything", async () => {
    const receivableId = await makeReceivable(1000.4, 0.4);
    expect(await codeOf(adjust(receivableId, "not-a-uuid"))).toBe("INVALID_EVENT_ID");
  });

  /**
   * The residue is read before `postPayment`'s transaction opens. A balance that moved in between
   * must refuse inside the transaction, not write off the stale figure: the pre-read is stubbed
   * to return 0,40 while the row really holds 0,70.
   */
  it("re-proves the residue inside the transaction and refuses a stale pre-read", async () => {
    const receivableId = await makeReceivable(1000.7, 0.7);
    const original = prisma.receivable.findUnique.bind(prisma.receivable);
    const spy = vi
      .spyOn(prisma.receivable, "findUnique")
      .mockImplementation(original as unknown as typeof prisma.receivable.findUnique)
      .mockResolvedValueOnce({ id: receivableId, storeId, outstandingAmount: 0.4, status: "PARTIAL" } as never);
    try {
      expect(await codeOf(adjust(receivableId))).toBe("NOT_A_RESIDUE");
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.receivable.findUnique);
    }
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(Number(after.outstandingAmount)).toBe(0.7);
    expect(await prisma.payment.count({ where: { storeId } })).toBe(0);
  });

  it("is refused by recordPayment from any other caller, whatever the amount or allocations", async () => {
    const receivableId = await makeReceivable(1000.4, 0.4);
    const otherId = await makeReceivable(1000.3, 0.3);
    const generic = (amount: number, allocations: Array<{ receivableId: string; amount: number }>) =>
      recordPayment({
        storeId,
        paidAt: new Date(),
        method: "ROUNDING_ADJUSTMENT" as unknown as "CASH",
        amount,
        recordedById: userId,
        allocations,
      });
    expect(await codeOf(generic(0.4, [{ receivableId, amount: 0.4 }]))).toBe("METHOD_NOT_ALLOWED");
    expect(await codeOf(generic(5, [{ receivableId, amount: 5 }]))).toBe("METHOD_NOT_ALLOWED");
    expect(
      await codeOf(generic(0.7, [{ receivableId, amount: 0.4 }, { receivableId: otherId, amount: 0.3 }])),
    ).toBe("METHOD_NOT_ALLOWED");
    expect(await prisma.payment.count({ where: { storeId } })).toBe(0);
  });

  it("is undone by an ordinary void that restores the residue and mirrors the journal", async () => {
    const receivableId = await makeReceivable(1000.4, 0.4);
    const res = await adjust(receivableId);
    await postPaymentReceiptJournal(res.paymentId, userId);

    const voided = await voidPayment({ paymentId: res.paymentId, reason: "posted by mistake", voidedById: userId });
    expect(voided.voided).toBe(true);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(Number(after.outstandingAmount)).toBe(0.4);
    expect(after.status).toBe("PARTIAL");

    const reversal = await postPaymentVoidJournal(res.paymentId, userId);
    expect(reversal).toMatchObject({ ok: true });
    const journal = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_VOID", sourceId: res.paymentId } },
      include: { lines: true },
    });
    expect(Number(journal.lines.find((l) => l.chartAccountId === roundingAccountId)?.credit)).toBe(0.4);
    expect(Number(journal.lines.find((l) => l.chartAccountId === arAccountId)?.debit)).toBe(0.4);

    /* A replay of the voided event refuses; a fresh event writes the restored residue off again. */
    const replay = await prisma.payment.findUniqueOrThrow({ where: { id: res.paymentId }, select: { idempotencyKey: true } });
    const eventId = (replay.idempotencyKey ?? "").replace(`rounding-${receivableId}-`, "");
    expect(await codeOf(adjust(receivableId, eventId))).toBe("PAYMENT_VOIDED");
    const again = await adjust(receivableId);
    expect(again.paymentId).not.toBe(res.paymentId);
  });
});
