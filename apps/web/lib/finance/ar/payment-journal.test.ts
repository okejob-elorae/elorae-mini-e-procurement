import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { postPaymentReceiptJournal, postPaymentVoidJournal } from "./payment-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const paidAt = new Date("2026-03-01T00:00:00.000+07:00");
const voidedAt = new Date("2026-03-05T00:00:00.000+07:00");

d("payment-journal (test bed only)", () => {
  let token = 0;
  let seq = 0;
  let storeId = "";
  let userId = "";
  let paymentId = "";
  let cashId = "";
  let bankId = "";
  let revId = "";
  let arId = "";
  let paymentIds: string[] = [];
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let sellThroughIds: string[] = [];
  let receivableIds: string[] = [];
  let notificationIds: string[] = [];
  let mappingSnapshot: MappingSnapshot | undefined;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    seq = 0;
    storeId = ""; userId = ""; paymentId = "";
    cashId = ""; bankId = ""; revId = ""; arId = "";
    paymentIds = []; orderIds = []; deliveryIds = []; sellThroughIds = []; receivableIds = []; notificationIds = [];
    mappingSnapshot = undefined;
    mappingSnapshot = await snapshotMappings(["CASH", "BANK", "SALES_REVENUE", "AR"]);

    const store = await prisma.store.create({
      data: { code: `TEST-PJ-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const user = await prisma.user.create({
      data: { email: `pj-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;

    const mk = async (code: string, type: "ASET" | "PENDAPATAN") =>
      (await prisma.chartAccount.create({ data: { code, name: "t", type, depth: 1, isActive: true } })).id;
    cashId = await mk(`9${token}1`, "ASET");
    bankId = await mk(`9${token}2`, "ASET");
    revId = await mk(`9${token}3`, "PENDAPATAN");
    arId = await mk(`9${token}4`, "ASET");
    const map = async (role: string, id: string) =>
      prisma.journalAccountMapping.upsert({
        where: { role: role as never },
        create: { role: role as never, chartAccountId: id },
        update: { chartAccountId: id },
      });
    await map("CASH", cashId);
    await map("BANK", bankId);
    await map("SALES_REVENUE", revId);
    await map("AR", arId);
  });

  afterEach(async () => {
    /* Live config first, so no bookkeeping delete below can stand between a failure and restoring it. */
    if (mappingSnapshot) await restoreMappings(mappingSnapshot);
    const journalSourceIds = [...paymentIds, ...deliveryIds, ...sellThroughIds].map(seededId);
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: { in: journalSourceIds } } } });
    await prisma.journal.deleteMany({ where: { sourceId: { in: journalSourceIds } } });
    await prisma.adminNotification.deleteMany({ where: { id: { in: notificationIds.map(seededId) } } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds.map(seededId) } } });
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    /* Receivables before the delivery or report they hang off (an optional 1:1 under relationMode = "prisma"). */
    await prisma.receivable.deleteMany({ where: { id: { in: receivableIds.map(seededId) } } });
    await prisma.konsiSellThrough.deleteMany({ where: { id: { in: sellThroughIds.map(seededId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds.map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds.map(seededId) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [cashId, bankId, revId, arId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  /* The gate only checks that the invoice's revenue journal exists, so a bare row stands in for the real post. */
  async function journalSource(sourceType: "FIELD_DELIVERY_REVENUE" | "KONSI_SELLTHRU_REVENUE", sourceId: string) {
    await prisma.journal.create({
      data: { date: paidAt, description: "fixture", sourceType, sourceId, postedById: userId },
    });
  }

  /**
   * A putus invoice: order → delivery → receivable. `revenueJournal` puts it on the ledger;
   * `pendingFlag` stages a delivery whose revenue post was attempted and failed, which is what the
   * gate reads as "not posted yet" rather than "outside the ledger".
   */
  async function makeReceivable(
    amount: number,
    opts: { revenueJournal: boolean; pendingFlag?: boolean },
  ): Promise<{ receivableId: string; deliveryId: string }> {
    const n = ++seq;
    const order = await prisma.fieldSalesOrder.create({
      data: { orderNo: `TEST-PJ-ORD-${token}-${n}`, storeId, salesmanId: userId, subtotal: amount, total: amount },
    });
    orderIds.push(order.id);
    const delivery = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-PJ-DLV-${token}-${n}`, orderId: order.id,
        deliveredAt: paidAt, deliveredById: userId,
        invoiceDate: paidAt, dueDate: paidAt,
        subtotal: amount, total: amount,
      },
    });
    deliveryIds.push(delivery.id);
    const receivable = await prisma.receivable.create({
      data: {
        deliveryId: delivery.id, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: amount, outstandingAmount: amount,
      },
    });
    receivableIds.push(receivable.id);
    if (opts.revenueJournal) await journalSource("FIELD_DELIVERY_REVENUE", delivery.id);
    if (opts.pendingFlag) {
      const flag = await prisma.adminNotification.create({
        data: {
          category: "JOURNAL_PENDING",
          severity: "WARNING",
          title: "t",
          message: "t",
          metadata: { docId: delivery.id, kind: "field_delivery_revenue", reason: "UNMAPPED_ROLE", role: null },
        },
      });
      notificationIds.push(flag.id);
    }
    return { receivableId: receivable.id, deliveryId: delivery.id };
  }

  /* A konsi invoice backed by a bare sell-through report — the gate reads only the report's revenue journal. */
  async function makeSellThroughReceivable(
    amount: number,
    opts: { revenueJournal: boolean },
  ): Promise<{ receivableId: string; sellThroughId: string }> {
    const n = ++seq;
    const report = await prisma.konsiSellThrough.create({
      data: {
        docNo: `TEST-PJ-KST-${token}-${n}`,
        storeId,
        method: "SPG_POS",
        closingStocktakeId: `TEST-PJ-STK-${token}-${n}`,
        periodEnd: paidAt,
        createdById: userId,
      },
    });
    sellThroughIds.push(report.id);
    const receivable = await prisma.receivable.create({
      data: {
        sellThroughId: report.id, storeId,
        invoiceDate: paidAt, dueDate: paidAt,
        originalAmount: amount, outstandingAmount: amount,
      },
    });
    receivableIds.push(receivable.id);
    if (opts.revenueJournal) await journalSource("KONSI_SELLTHRU_REVENUE", report.id);
    return { receivableId: receivable.id, sellThroughId: report.id };
  }

  async function createPayment(
    method: "CASH" | "TRANSFER" | "RETUR_OFFSET",
    amount: number,
    allocations: Array<{ receivableId: string; amount: number }>,
  ): Promise<string> {
    const p = await prisma.payment.create({
      data: {
        docNo: `TEST-PJ-DOC-${token}-${++seq}`, storeId, paidAt, method, amount, recordedById: userId,
        allocations: { create: allocations },
      },
    });
    paymentIds.push(p.id);
    return p.id;
  }

  const receiptOf = (id: string) =>
    prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_RECEIPT", sourceId: id } },
      include: { lines: true },
    });

  const journalCountFor = (id: string) => prisma.journal.count({ where: { sourceId: id } });

  it("debits SALES_REVENUE (not CASH/BANK) for a RETUR_OFFSET receipt", async () => {
    const { receivableId } = await makeReceivable(500, { revenueJournal: true });
    paymentId = await createPayment("RETUR_OFFSET", 500, [{ receivableId, amount: 500 }]);
    const result = await postPaymentReceiptJournal(paymentId, userId);
    expect(result).toMatchObject({ ok: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === revId)!.debit)).toBe(500);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(500);
  });

  it("void reversal mirrors it: credits SALES_REVENUE back, debits AR", async () => {
    const { receivableId } = await makeReceivable(500, { revenueJournal: true });
    paymentId = await createPayment("RETUR_OFFSET", 500, [{ receivableId, amount: 500 }]);
    await postPaymentReceiptJournal(paymentId, userId);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt: new Date() } });
    const result = await postPaymentVoidJournal(paymentId, userId);
    expect(result).toMatchObject({ ok: true });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_VOID", sourceId: paymentId } },
      include: { lines: true },
    });
    expect(Number(j!.lines.find((l) => l.chartAccountId === revId)!.credit)).toBe(500);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.debit)).toBe(500);
  });

  it("CASH still debits CASH, not SALES_REVENUE (unchanged)", async () => {
    const { receivableId } = await makeReceivable(300, { revenueJournal: true });
    paymentId = await createPayment("CASH", 300, [{ receivableId, amount: 300 }]);
    await postPaymentReceiptJournal(paymentId, userId);
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === cashId)!.debit)).toBe(300);
  });

  it("TRANSFER still debits BANK, not SALES_REVENUE (unchanged)", async () => {
    const { receivableId } = await makeReceivable(300, { revenueJournal: true });
    paymentId = await createPayment("TRANSFER", 300, [{ receivableId, amount: 300 }]);
    await postPaymentReceiptJournal(paymentId, userId);
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === bankId)!.debit)).toBe(300);
  });

  it("every allocation in the ledger → posts the full amount under the plain description", async () => {
    const a = await makeReceivable(300, { revenueJournal: true });
    const b = await makeReceivable(200, { revenueJournal: true });
    paymentId = await createPayment("CASH", 500, [
      { receivableId: a.receivableId, amount: 300 },
      { receivableId: b.receivableId, amount: 200 },
    ]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === cashId)!.debit)).toBe(500);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(500);
    expect(j!.description).toBe(`Pembayaran TEST-PJ-DOC-${token}-${seq}`);
  });

  it("one allocation outside the ledger → posts only the in-ledger part and says it is partial", async () => {
    const inLedger = await makeReceivable(300, { revenueJournal: true });
    const outside = await makeReceivable(200, { revenueJournal: false });
    paymentId = await createPayment("CASH", 500, [
      { receivableId: inLedger.receivableId, amount: 300 },
      { receivableId: outside.receivableId, amount: 200 },
    ]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === cashId)!.debit)).toBe(300);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(300);
    expect(j!.description).toContain("sebagian");
  });

  it("every allocation outside the ledger → refuses RECEIVABLE_OUTSIDE_LEDGER and posts nothing", async () => {
    const outside = await makeReceivable(500, { revenueJournal: false });
    paymentId = await createPayment("CASH", 500, [{ receivableId: outside.receivableId, amount: 500 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" });
    expect(await journalCountFor(paymentId)).toBe(0);
  });

  it("an allocation whose invoice journal failed and is pending → refuses the whole payment, then posts in full once it lands", async () => {
    const inLedger = await makeReceivable(300, { revenueJournal: true });
    const pending = await makeReceivable(200, { revenueJournal: false, pendingFlag: true });
    paymentId = await createPayment("CASH", 500, [
      { receivableId: inLedger.receivableId, amount: 300 },
      { receivableId: pending.receivableId, amount: 200 },
    ]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({
      ok: false,
      code: "RECEIVABLE_REVENUE_NOT_POSTED_YET",
    });
    expect(await journalCountFor(paymentId)).toBe(0);

    await journalSource("FIELD_DELIVERY_REVENUE", pending.deliveryId);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(500);
    expect(j!.description).not.toContain("sebagian");
  });

  it("a sell-through invoice is pending without its revenue journal and in the ledger with it", async () => {
    const report = await makeSellThroughReceivable(400, { revenueJournal: false });
    paymentId = await createPayment("TRANSFER", 400, [{ receivableId: report.receivableId, amount: 400 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({
      ok: false,
      code: "RECEIVABLE_REVENUE_NOT_POSTED_YET",
    });

    await journalSource("KONSI_SELLTHRU_REVENUE", report.sellThroughId);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === bankId)!.debit)).toBe(400);
  });

  it("a payment with no allocations → refuses RECEIVABLE_OUTSIDE_LEDGER", async () => {
    paymentId = await createPayment("CASH", 500, []);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" });
    expect(await journalCountFor(paymentId)).toBe(0);
  });

  it("a re-post returns the standing receipt without re-gating, even after the gate inputs changed", async () => {
    const inLedger = await makeReceivable(300, { revenueJournal: true });
    const outside = await makeReceivable(200, { revenueJournal: false });
    paymentId = await createPayment("CASH", 500, [
      { receivableId: inLedger.receivableId, amount: 300 },
      { receivableId: outside.receivableId, amount: 200 },
    ]);
    const first = await postPaymentReceiptJournal(paymentId, userId);
    expect(first).toMatchObject({ ok: true, created: true });

    await journalSource("FIELD_DELIVERY_REVENUE", outside.deliveryId);
    const second = await postPaymentReceiptJournal(paymentId, userId);
    expect(second).toMatchObject({ ok: true, created: false });
    if (first.ok && second.ok) expect(second.journalId).toBe(first.journalId);
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(300);
  });

  it("the void reversal mirrors a partial receipt line for line, dated voidedAt", async () => {
    const inLedger = await makeReceivable(300, { revenueJournal: true });
    const outside = await makeReceivable(200, { revenueJournal: false });
    paymentId = await createPayment("CASH", 500, [
      { receivableId: inLedger.receivableId, amount: 300 },
      { receivableId: outside.receivableId, amount: 200 },
    ]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true });
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt } });

    expect(await postPaymentVoidJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const receipt = await receiptOf(paymentId);
    const reversal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_VOID", sourceId: paymentId } },
      include: { lines: true },
    });
    expect(reversal!.sourceType).toBe("PAYMENT_VOID");
    expect(reversal!.date.toISOString()).toBe(voidedAt.toISOString());
    const shape = (lines: Array<{ chartAccountId: string; debit: unknown; credit: unknown }>) =>
      lines
        .map((l) => ({ account: l.chartAccountId, debit: Number(l.debit), credit: Number(l.credit) }))
        .sort((x, y) => x.account.localeCompare(y.account));
    expect(shape(reversal!.lines)).toEqual(
      shape(receipt!.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: l.credit, credit: l.debit }))),
    );
    expect(Number(reversal!.lines.find((l) => l.chartAccountId === arId)!.debit)).toBe(300);
    expect(Number(reversal!.lines.find((l) => l.chartAccountId === cashId)!.credit)).toBe(300);
  });

  it("a void with no standing receipt → NOTHING_TO_POST and posts nothing", async () => {
    const outside = await makeReceivable(500, { revenueJournal: false });
    paymentId = await createPayment("CASH", 500, [{ receivableId: outside.receivableId, amount: 500 }]);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt } });
    expect(await postPaymentVoidJournal(paymentId, userId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    expect(await journalCountFor(paymentId)).toBe(0);
  });

  it("a receipt for a VOIDED payment that never had one → NOTHING_TO_POST", async () => {
    const inLedger = await makeReceivable(500, { revenueJournal: true });
    paymentId = await createPayment("CASH", 500, [{ receivableId: inLedger.receivableId, amount: 500 }]);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt } });
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    expect(await journalCountFor(paymentId)).toBe(0);
  });

  /**
   * A void that commits while the receipt is being decided. The transaction below plays the void:
   * it locks the payment row and flips it to VOIDED, then holds its commit open while the receipt
   * starts. A receipt that read the status without the row lock would see the committed POSTED
   * row, post, and leave a receipt the void never reversed; the locked receipt waits for the void
   * to commit and then reads VOIDED.
   */
  it("a receipt attempted while a void is committing posts nothing", async () => {
    const inLedger = await makeReceivable(500, { revenueJournal: true });
    paymentId = await createPayment("CASH", 500, [{ receivableId: inLedger.receivableId, amount: 500 }]);

    let voidFlipped!: () => void;
    const flipped = new Promise<void>((resolve) => (voidFlipped = resolve));
    let releaseVoid!: () => void;
    const released = new Promise<void>((resolve) => (releaseVoid = resolve));
    const voiding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT \`id\` FROM \`Payment\` WHERE \`id\` = ${paymentId} FOR UPDATE`;
        await tx.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt } });
        voidFlipped();
        await released;
      },
      { timeout: 20_000 },
    );

    try {
      await Promise.race([flipped, voiding]);
      const receipt = postPaymentReceiptJournal(paymentId, userId);
      /* Long enough for an unlocked read to have decided and posted before the void commits. */
      await new Promise((resolve) => setTimeout(resolve, 500));
      releaseVoid();
      await voiding;
      expect(await receipt).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    } finally {
      releaseVoid();
      await voiding.catch(() => undefined);
    }
    expect(await journalCountFor(paymentId)).toBe(0);
  });
});
