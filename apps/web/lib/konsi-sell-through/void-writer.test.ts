import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createSellThrough, cancelSellThrough } from "./writer";
import { voidSellThrough } from "./void-writer";
import { createSellThroughFixtures } from "./test-fixtures";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the order-create fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

d("konsi sell-through void (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state, setMethod, transferIn, count, tick, spgSell } = fx;

  let settlementIds: string[] = [];
  let submissionIds: string[] = [];

  beforeEach(async () => {
    settlementIds = [];
    submissionIds = [];
    await fx.beforeEach();
  });

  afterEach(async () => {
    try {
      await prisma.storeSettlementInvoice.deleteMany({ where: { settlementId: { in: settlementIds.map((id) => seededId(id)) } } });
      await prisma.storeSettlement.deleteMany({ where: { id: { in: settlementIds.map((id) => seededId(id)) } } });
      await prisma.collectionSubmission.deleteMany({ where: { id: { in: submissionIds.map((id) => seededId(id)) } } });
    } finally {
      await fx.afterEach();
    }
  });

  /* SHELF_COUNT: 6 in, 2 counted with an unrecorded-sale cause → the line bills 4 × 40,000 = 160,000. */
  async function invoicedReport() {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const report = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await fx.approve(report.id);
    return { id: report.id, stocktakeId };
  }

  const voidIt = (id: string, reason = "Wrong resolution on the only line.") =>
    voidSellThrough({ id, voidedById: state.userId, reason });

  const receivableOf = (id: string) => prisma.receivable.findUniqueOrThrow({ where: { sellThroughId: seededId(id) } });

  it("voids an invoiced report: report, receivable and faktur flip, both keys are freed, one audit row", async () => {
    const { id, stocktakeId } = await invoicedReport();
    await expect(voidIt(id)).resolves.toEqual({ id, closingStocktakeId: stocktakeId });

    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) }, include: { receivable: true, taxInvoice: true } });
    expect(doc).toMatchObject({ status: "VOIDED", voidedById: state.userId, voidReason: "Wrong resolution on the only line.", stocktakeKey: null, chainKey: null, closingStocktakeId: stocktakeId });
    expect(doc.voidedAt).toBeInstanceOf(Date);
    expect(doc.receivable?.status).toBe("VOIDED");
    expect(Number(doc.receivable?.outstandingAmount)).toBe(0);
    expect(Number(doc.receivable?.originalAmount)).toBe(160000);
    expect(doc.taxInvoice?.status).toBe("CANCELLED");

    const audits = await prisma.auditLog.findMany({ where: { entityType: "KonsiSellThrough", entityId: id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "KONSI_SELL_THROUGH_VOID", userId: state.userId, reason: "Wrong resolution on the only line." });
  }, SLOW);

  it("cancels an already-issued faktur too, keeping its number", async () => {
    const { id } = await invoicedReport();
    await prisma.taxInvoice.update({ where: { sellThroughId: id }, data: { status: "SENT_TO_STORE", invoiceNo: "010.000-26.00000001" } });
    await voidIt(id);
    const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { sellThroughId: seededId(id) } });
    expect(faktur).toMatchObject({ status: "CANCELLED", invoiceNo: "010.000-26.00000001" });
  }, SLOW);

  it("voids a baseline report, which has no receivable or faktur", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const report = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await fx.approveBaseline(report.id);
    await voidIt(report.id);
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(report.id) } })).status).toBe("VOIDED");
  }, SLOW);

  it("refuses a blank or over-long reason before touching anything", async () => {
    const { id } = await invoicedReport();
    await expect(voidIt(id, "   ")).rejects.toMatchObject({ code: "VOID_REASON_REQUIRED" });
    await expect(voidIt(id, "x".repeat(1001))).rejects.toMatchObject({ code: "VOID_REASON_REQUIRED", detail: "REASON_TOO_LONG" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("APPROVED");
  }, SLOW);

  it("refuses NOT_FOUND for a report that does not exist", async () => {
    await expect(voidIt(`missing-${state.run}`)).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  it("refuses INVALID_STATE for a DRAFT, and a second void writes no second audit row", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const draft = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await expect(voidIt(draft.id)).rejects.toMatchObject({ code: "INVALID_STATE" });

    await fx.approve(draft.id);
    await voidIt(draft.id);
    await expect(voidIt(draft.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await prisma.auditLog.count({ where: { entityType: "KonsiSellThrough", entityId: draft.id } })).toBe(1);
  }, SLOW);

  it("refuses HAS_SUCCESSOR naming a DRAFT or APPROVED later report, changes nothing, and voids once the later report is gone", async () => {
    const first = await invoicedReport();
    await tick();
    await spgSell(1);
    await tick();
    const secondCount = await count(1);
    const second = await createSellThrough({ closingStocktakeId: secondCount, createdById: state.userId });
    const secondDoc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(second.id) } });

    await expect(voidIt(first.id)).rejects.toMatchObject({ code: "HAS_SUCCESSOR", detail: secondDoc.docNo });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(first.id) } })).status).toBe("APPROVED");
    expect((await receivableOf(first.id)).status).toBe("OUTSTANDING");

    await fx.approve(second.id);
    await expect(voidIt(first.id)).rejects.toMatchObject({ code: "HAS_SUCCESSOR", detail: secondDoc.docNo });

    await voidIt(second.id);
    await expect(voidIt(first.id)).resolves.toMatchObject({ id: first.id });
  }, SLOW);

  it("a cancelled later report does not block the void", async () => {
    const first = await invoicedReport();
    await tick();
    await spgSell(1);
    await tick();
    const secondCount = await count(1);
    const second = await createSellThrough({ closingStocktakeId: secondCount, createdById: state.userId });
    await cancelSellThrough({ id: second.id, cancelledById: state.userId, reason: "wrong count" });
    await expect(voidIt(first.id)).resolves.toMatchObject({ id: first.id });
  }, SLOW);

  it("refuses HAS_PAYMENTS while the receivable carries a payment, and ALREADY_SETTLED for a written-off one", async () => {
    const { id } = await invoicedReport();
    const r = await receivableOf(id);
    await prisma.receivable.update({ where: { id: r.id }, data: { paidAmount: 1000, outstandingAmount: 159000, status: "PARTIAL" } });
    await expect(voidIt(id)).rejects.toMatchObject({ code: "HAS_PAYMENTS" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("APPROVED");

    await prisma.receivable.update({ where: { id: r.id }, data: { paidAmount: 0, outstandingAmount: 0, status: "WRITTEN_OFF" } });
    await expect(voidIt(id)).rejects.toMatchObject({ code: "ALREADY_SETTLED" });
  }, SLOW);

  it("refuses SETTLEMENT_PENDING naming the settlement, and COLLECTION_PENDING for a pending collection", async () => {
    const { id } = await invoicedReport();
    const r = await receivableOf(id);
    const settlement = await prisma.storeSettlement.create({
      data: {
        docNo: `TEST-BKM-${state.run}`,
        storeId: state.storeId,
        salesmanId: state.salesmanId,
        expectedAmount: 160000,
        actualAmount: 160000,
        varianceAmount: 0,
        invoices: { create: [{ receivableId: r.id, amount: 160000 }] },
      },
    });
    settlementIds.push(settlement.id);
    await expect(voidIt(id)).rejects.toMatchObject({ code: "SETTLEMENT_PENDING", detail: `TEST-BKM-${state.run}` });

    await prisma.storeSettlement.update({ where: { id: settlement.id }, data: { status: "REJECTED" } });
    const submission = await prisma.collectionSubmission.create({
      data: { receivableId: r.id, collectorId: state.salesmanId, amount: 1000, method: "CASH", paidAt: new Date() },
    });
    submissionIds.push(submission.id);
    await expect(voidIt(id)).rejects.toMatchObject({ code: "COLLECTION_PENDING" });
  }, SLOW);

  it("after a void, the same count creates a report chained to the report before, and its approve invoices afresh", async () => {
    const first = await invoicedReport();
    await tick();
    await spgSell(1);
    await tick();
    const secondCount = await count(1);
    const second = await createSellThrough({ closingStocktakeId: secondCount, createdById: state.userId });
    await fx.approve(second.id);

    await voidIt(second.id);
    const corrected = await createSellThrough({ closingStocktakeId: secondCount, createdById: state.userId });
    expect(corrected.id).not.toBe(second.id);
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(corrected.id) }, include: { lines: true } });
    expect(doc).toMatchObject({ status: "DRAFT", previousId: first.id, chainKey: `${state.storeId}:${first.id}`, stocktakeKey: secondCount });

    const voidedLines = await prisma.konsiSellThroughLine.findMany({ where: { sellThroughId: seededId(second.id) }, orderBy: { id: "asc" } });
    expect(doc.lines.map((l) => [Number(l.openingQty), Number(l.billedQty)])).toEqual(voidedLines.map((l) => [Number(l.openingQty), Number(l.billedQty)]));

    await fx.approve(corrected.id);
    expect(await prisma.receivable.count({ where: { sellThroughId: corrected.id, status: "OUTSTANDING" } })).toBe(1);
    expect(await prisma.receivable.count({ where: { sellThroughId: second.id, status: "VOIDED" } })).toBe(1);
    expect(await prisma.taxInvoice.count({ where: { sellThroughId: corrected.id, status: "PENDING" } })).toBe(1);
  }, SLOW);
});
