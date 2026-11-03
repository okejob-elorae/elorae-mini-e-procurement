import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * A flagged delivery reads as late only while its cutover-gated nota journal can still post, so the
 * gate reads the GL cutover. It is shared live config; this stub stands in for the bed's row.
 */
const h = vi.hoisted(() => ({ mulai: new Date("2026-01-01T00:00:00.000+07:00") as Date | null }));
vi.mock("@/lib/finance/sales/sweep", async (asli) => ({
  ...(await asli<typeof import("@/lib/finance/sales/sweep")>()),
  readGlCutover: vi.fn(async () => h.mulai),
}));

import { postPaymentReceiptJournal, postPaymentVoidJournal } from "./payment-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";
import { penandaBebanRetur } from "@/lib/receivables/penanda-beban";

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
  let arStoreId = "";
  let arConsignmentId = "";
  let paymentIds: string[] = [];
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let sellThroughIds: string[] = [];
  let cycleIds: string[] = [];
  let receivableIds: string[] = [];
  let notificationIds: string[] = [];
  let mappingSnapshot: MappingSnapshot | undefined;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    seq = 0;
    storeId = ""; userId = ""; paymentId = "";
    cashId = ""; bankId = ""; revId = ""; arId = ""; arStoreId = ""; arConsignmentId = "";
    paymentIds = []; orderIds = []; deliveryIds = []; sellThroughIds = []; cycleIds = []; receivableIds = []; notificationIds = [];
    h.mulai = new Date("2026-01-01T00:00:00.000+07:00");
    mappingSnapshot = undefined;
    mappingSnapshot = await snapshotMappings(["CASH", "BANK", "SALES_REVENUE", "AR", "AR_STORE", "AR_CONSIGNMENT"]);

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
    arStoreId = await mk(`9${token}5`, "ASET");
    arConsignmentId = await mk(`9${token}6`, "ASET");
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
    await map("AR_STORE", arStoreId);
    await map("AR_CONSIGNMENT", arConsignmentId);
  });

  afterEach(async () => {
    /* Live config first, so no bookkeeping delete below can stand between a failure and restoring it. */
    if (mappingSnapshot) await restoreMappings(mappingSnapshot);
    const journalSourceIds = [...paymentIds, ...deliveryIds, ...sellThroughIds, ...cycleIds].map(seededId);
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: { in: journalSourceIds.map(seededId) } } } });
    await prisma.journal.deleteMany({ where: { sourceId: { in: journalSourceIds.map(seededId) } } });
    await prisma.adminNotification.deleteMany({ where: { id: { in: notificationIds.map(seededId) } } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds.map(seededId) } } });
    await prisma.payment.deleteMany({ where: { storeId: seededId(storeId) } });
    /* Receivables before the delivery or report they hang off (an optional 1:1 under relationMode = "prisma"). */
    await prisma.receivable.deleteMany({ where: { id: { in: receivableIds.map(seededId) } } });
    /* After its receivable: `Receivable.consignmentCycle` is `onDelete: Restrict`. */
    await prisma.consignmentCycle.deleteMany({ where: { id: { in: cycleIds.map(seededId) } } });
    await prisma.konsiSellThrough.deleteMany({ where: { id: { in: sellThroughIds.map(seededId) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds.map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds.map(seededId) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [cashId, bankId, revId, arId, arStoreId, arConsignmentId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  /*
   * The gate only checks that the invoice's revenue journal exists, so a bare row stands in for the
   * real post. A bare row carries no AR_STORE line, which is the old shape: its receipt credits AR.
   */
  async function journalSource(sourceType: "FIELD_DELIVERY_REVENUE" | "KONSI_SELLTHRU_REVENUE", sourceId: string) {
    await prisma.journal.create({
      data: { date: paidAt, description: "fixture", sourceType, sourceId, postedById: userId },
    });
  }

  /*
   * An invoice journal in today's shape: the store receivable debited and tagged with its role —
   * AR_STORE for a putus nota, AR_CONSIGNMENT for a konsi sell-through report.
   */
  async function storeInvoiceJournal(sourceType: "FIELD_DELIVERY" | "KONSI_SELLTHRU_REVENUE", sourceId: string, amount: number) {
    const role = sourceType === "KONSI_SELLTHRU_REVENUE" ? "AR_CONSIGNMENT" : "AR_STORE";
    await prisma.journal.create({
      data: {
        date: paidAt,
        description: "fixture",
        sourceType,
        sourceId,
        postedById: userId,
        lines: {
          create: [
            { chartAccountId: role === "AR_STORE" ? arStoreId : arConsignmentId, debit: amount, credit: 0, memo: role, storeId },
            { chartAccountId: revId, debit: 0, credit: amount, memo: "SALES_REVENUE", storeId },
          ],
        },
      },
    });
  }

  /* The old pair's COGS half on its own — the revenue half then completes it, which no cutover gates. */
  async function cogsHalf(deliveryId: string) {
    await prisma.journal.create({
      data: { date: paidAt, description: "fixture", sourceType: "FIELD_DELIVERY_COGS", sourceId: deliveryId, postedById: userId },
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

  /*
   * A konsi cycle bill as the cycle lock writes it: DELIVERY-sourced, backed by its cycle, flagged
   * `isConsignment`, both column families. `cycleJournal` stands its `CONSIGNMENT_CYCLE` journal in
   * today's shape (AR_CONSIGNMENT tagged with its role and the store).
   */
  async function makeCycleReceivable(
    amount: number,
    opts: { cycleJournal: boolean; invoiceDate?: Date },
  ): Promise<{ receivableId: string; cycleId: string }> {
    const n = ++seq;
    const cycle = await prisma.consignmentCycle.create({
      data: { noKonsi: `TEST-PJ-KONSI-${token}-${n}`, storeId, periodYear: 2026, periodMonth: n },
    });
    cycleIds.push(cycle.id);
    const invoiceDate = opts.invoiceDate ?? paidAt;
    const receivable = await prisma.receivable.create({
      data: {
        consignmentCycleId: cycle.id, isConsignment: true, storeId,
        invoiceNo: cycle.noKonsi,
        invoiceDate, dueDate: invoiceDate,
        amount, outstanding: amount, originalAmount: amount, outstandingAmount: amount,
      },
    });
    receivableIds.push(receivable.id);
    if (opts.cycleJournal) {
      await prisma.journal.create({
        data: {
          date: invoiceDate,
          description: "fixture",
          sourceType: "CONSIGNMENT_CYCLE",
          sourceId: cycle.id,
          postedById: userId,
          lines: {
            create: [
              { chartAccountId: arConsignmentId, debit: amount, credit: 0, memo: "AR_CONSIGNMENT", storeId },
              { chartAccountId: revId, debit: 0, credit: amount, memo: "SALES_REVENUE", storeId },
            ],
          },
        },
      });
    }
    return { receivableId: receivable.id, cycleId: cycle.id };
  }

  /*
   * A return-charge invoice, as `tulisPiutangManual` writes it when a return's shortfall is billed
   * to the store: MANUAL, backed by nothing, its charge named in the note. It never gets a journal
   * of its own — the NRI's return journal leaves its value on AR_STORE.
   */
  async function makeReturnChargeReceivable(amount: number): Promise<string> {
    const n = ++seq;
    const receivable = await prisma.receivable.create({
      data: {
        storeId,
        invoiceNo: `TEST-PJ-BEBAN-${token}-${n}`,
        source: "MANUAL",
        invoiceDate: paidAt, dueDate: paidAt,
        amount, outstanding: amount,
        originalAmount: amount, outstandingAmount: amount,
        note: `Selisih retur ditanggung toko. ${penandaBebanRetur(`TEST-PJ-${token}-c${n}`)}`,
      },
    });
    receivableIds.push(receivable.id);
    return receivable.id;
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

  it("a konsi cycle bill paid through the office credits AR_CONSIGNMENT, with its store, once the cycle journal stands", async () => {
    const { receivableId } = await makeCycleReceivable(400, { cycleJournal: true });
    paymentId = await createPayment("TRANSFER", 400, [{ receivableId, amount: 400 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === bankId)!.debit)).toBe(400);
    expect(j!.lines.find((l) => l.chartAccountId === arConsignmentId)).toMatchObject({ memo: "AR_CONSIGNMENT", storeId });
    expect(Number(j!.lines.find((l) => l.chartAccountId === arConsignmentId)!.credit)).toBe(400);
    expect(j!.lines.find((l) => l.chartAccountId === arStoreId)).toBeUndefined();
  });

  it("a konsi cycle bill without its journal is late on or after the cutover and outside before it", async () => {
    const late = await makeCycleReceivable(400, { cycleJournal: false });
    paymentId = await createPayment("TRANSFER", 400, [{ receivableId: late.receivableId, amount: 400 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_REVENUE_NOT_POSTED_YET" });

    h.mulai = new Date("2026-06-01T00:00:00.000+07:00");
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" });
    h.mulai = null;
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" });
    expect(await journalCountFor(paymentId)).toBe(0);
  });

  it("an invoice whose nota journal debited AR_STORE is credited back on AR_STORE, with its store", async () => {
    const { receivableId, deliveryId } = await makeReceivable(400, { revenueJournal: false });
    await storeInvoiceJournal("FIELD_DELIVERY", deliveryId, 400);
    paymentId = await createPayment("TRANSFER", 400, [{ receivableId, amount: 400 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === bankId)!.debit)).toBe(400);
    expect(j!.lines.find((l) => l.chartAccountId === arStoreId)).toMatchObject({ storeId });
    expect(Number(j!.lines.find((l) => l.chartAccountId === arStoreId)!.credit)).toBe(400);
    expect(j!.lines.find((l) => l.chartAccountId === arId)).toBeUndefined();
  });

  it("a flagged delivery whose nota journal can never post (dated before the cutover) is outside, so the rest posts", async () => {
    const inLedger = await makeReceivable(300, { revenueJournal: true });
    const stranded = await makeReceivable(200, { revenueJournal: false, pendingFlag: true });
    h.mulai = new Date("2026-06-01T00:00:00.000+07:00");
    paymentId = await createPayment("CASH", 500, [
      { receivableId: inLedger.receivableId, amount: 300 },
      { receivableId: stranded.receivableId, amount: 200 },
    ]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === cashId)!.debit)).toBe(300);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(300);
    expect(j!.description).toContain("sebagian");
  });

  it("with no GL cutover set, a flagged delivery's nota journal can never post either", async () => {
    const stranded = await makeReceivable(200, { revenueJournal: false, pendingFlag: true });
    h.mulai = null;
    paymentId = await createPayment("CASH", 200, [{ receivableId: stranded.receivableId, amount: 200 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" });
    expect(await journalCountFor(paymentId)).toBe(0);
  });

  it("a flagged delivery holding the old pair's COGS half is still late before the cutover — its revenue half completes ungated", async () => {
    const pending = await makeReceivable(200, { revenueJournal: false, pendingFlag: true });
    await cogsHalf(pending.deliveryId);
    h.mulai = new Date("2026-06-01T00:00:00.000+07:00");
    paymentId = await createPayment("CASH", 200, [{ receivableId: pending.receivableId, amount: 200 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_REVENUE_NOT_POSTED_YET" });
    expect(await journalCountFor(paymentId)).toBe(0);
  });

  it("a payment settling an old-shape invoice and a current one credits each the account its journal debited", async () => {
    const old = await makeReceivable(300, { revenueJournal: true });
    const current = await makeReceivable(200, { revenueJournal: false });
    await storeInvoiceJournal("FIELD_DELIVERY", current.deliveryId, 200);
    const report = await makeSellThroughReceivable(100, { revenueJournal: false });
    await storeInvoiceJournal("KONSI_SELLTHRU_REVENUE", report.sellThroughId, 100);
    paymentId = await createPayment("CASH", 600, [
      { receivableId: old.receivableId, amount: 300 },
      { receivableId: current.receivableId, amount: 200 },
      { receivableId: report.receivableId, amount: 100 },
    ]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === cashId)!.debit)).toBe(600);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(300);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arStoreId)!.credit)).toBe(200);
    /* A konsi sell-through report's receivable sits on AR_CONSIGNMENT, so its share is credited there. */
    expect(Number(j!.lines.find((l) => l.chartAccountId === arConsignmentId)!.credit)).toBe(100);
    expect(j!.lines.find((l) => l.chartAccountId === arConsignmentId)).toMatchObject({ memo: "AR_CONSIGNMENT", storeId });
    expect(j!.description).not.toContain("sebagian");

    /* The reversal mirrors the store dimension too, so the per-store receivable balance nets back. */
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt } });
    expect(await postPaymentVoidJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const reversal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_VOID", sourceId: paymentId } },
      include: { lines: true },
    });
    expect(reversal!.lines.find((l) => l.chartAccountId === arStoreId)).toMatchObject({ storeId });
    expect(Number(reversal!.lines.find((l) => l.chartAccountId === arStoreId)!.debit)).toBe(200);
    expect(Number(reversal!.lines.find((l) => l.chartAccountId === arConsignmentId)!.debit)).toBe(100);
  });

  it("a return-charge invoice with no journal of its own is credited on AR_STORE with its store once a cutover is set", async () => {
    const receivableId = await makeReturnChargeReceivable(250);
    paymentId = await createPayment("TRANSFER", 250, [{ receivableId, amount: 250 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toMatchObject({ ok: true, created: true });
    const j = await receiptOf(paymentId);
    expect(Number(j!.lines.find((l) => l.chartAccountId === bankId)!.debit)).toBe(250);
    expect(j!.lines.find((l) => l.chartAccountId === arStoreId)).toMatchObject({ memo: "AR_STORE", storeId });
    expect(Number(j!.lines.find((l) => l.chartAccountId === arStoreId)!.credit)).toBe(250);
    expect(j!.lines.find((l) => l.chartAccountId === arId)).toBeUndefined();
    expect(j!.description).not.toContain("sebagian");
  });

  it("with no GL cutover set, a return-charge invoice is outside the ledger", async () => {
    const receivableId = await makeReturnChargeReceivable(250);
    h.mulai = null;
    paymentId = await createPayment("TRANSFER", 250, [{ receivableId, amount: 250 }]);
    expect(await postPaymentReceiptJournal(paymentId, userId)).toEqual({ ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" });
    expect(await journalCountFor(paymentId)).toBe(0);
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
      let settled = false;
      const receipt = postPaymentReceiptJournal(paymentId, userId);
      receipt.then(
        () => (settled = true),
        () => (settled = true),
      );
      /*
       * The receipt must still be waiting on the row lock when the void commits. An unlocked
       * implementation never waits, so it settles inside this window and the assertion below names
       * the regression directly, instead of leaving it to the journal count after the fact.
       */
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);
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
