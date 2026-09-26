import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "@/lib/finance/journals/mapping-test-fixture";
import { createSellThrough, resolveSellThroughLine } from "@/lib/konsi-sell-through/writer";
import { createSellThroughFixtures } from "@/lib/konsi-sell-through/test-fixtures";

const { mockAuth, mockFanOut, mockLogPrint } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFanOut: vi.fn(),
  mockLogPrint: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/* Stubbed so neither the order-create nor the journal/nota fan-out can queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: mockFanOut }));
vi.mock("./audit", () => ({ logPrint: mockLogPrint }));

import {
  approveSellThroughAction,
  retrySellThroughJournalsAction,
  recordSellThroughNotaPrinted,
  getSellThroughNotaAction,
  voidSellThroughAction,
} from "./konsi-sell-through";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

const MAPPED_ROLES: PostingRole[] = ["AR", "SALES_REVENUE", "COGS", "INVENTORY", "INVENTORY_VARIANCE"];

d("konsi sell-through actions (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state, setMethod, transferIn, count, onlyLine } = fx;

  let mappingSnapshot: MappingSnapshot | undefined;
  let arId = "";
  let salesRevenueId = "";
  let cogsId = "";
  let inventoryId = "";
  let inventoryVarianceId = "";
  let reportIds: string[] = [];

  const today = () => formatDateOnlyJakarta(new Date());

  beforeEach(async () => {
    reportIds = [];
    mappingSnapshot = undefined;
    arId = "";
    salesRevenueId = "";
    cogsId = "";
    inventoryId = "";
    inventoryVarianceId = "";
    await fx.beforeEach();
    mappingSnapshot = await snapshotMappings(MAPPED_ROLES);

    const mk = async (suffix: string, type: "ASET" | "PENDAPATAN" | "HPP" | "BEBAN") =>
      (await prisma.chartAccount.create({ data: { code: `8${state.run}${suffix}`, name: "t", type, depth: 1, isActive: true } })).id;
    arId = await mk("1", "ASET");
    salesRevenueId = await mk("2", "PENDAPATAN");
    cogsId = await mk("3", "HPP");
    inventoryId = await mk("4", "ASET");
    inventoryVarianceId = await mk("5", "BEBAN");

    const mapRole = (role: PostingRole, chartAccountId: string) =>
      prisma.journalAccountMapping.upsert({ where: { role }, create: { role, chartAccountId }, update: { chartAccountId } });
    await mapRole("AR", arId);
    await mapRole("SALES_REVENUE", salesRevenueId);
    await mapRole("COGS", cogsId);
    await mapRole("INVENTORY", inventoryId);
    await mapRole("INVENTORY_VARIANCE", inventoryVarianceId);

    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: state.userId, permissions: ["stores:manage"] } });
    mockFanOut.mockReset();
    mockLogPrint.mockReset();
    mockLogPrint.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    /**
     * Children before parents: this file's notifications and journals first, then the mappings and
     * chart accounts the journals point at, then the fixture's own teardown — in `finally`, so a
     * `beforeEach` that failed part-way still never leaks the fixture's rows. Notifications carry
     * the report id only inside a Json metadata blob, so each category's rows are matched in JS
     * against this run's report ids and deleted by that explicit id list, never by category alone.
     */
    try {
      const ids = reportIds.map((id) => seededId(id));
      const candidates = await prisma.adminNotification.findMany({
        where: { category: { in: ["JOURNAL_PENDING", "TAX_INVOICE_PENDING"] } },
        select: { id: true, metadata: true },
      });
      const ownNotificationIds = candidates
        .filter((n) => {
          const m = n.metadata as { docId?: string; sellThroughId?: string } | null;
          return ids.includes(m?.docId ?? "") || ids.includes(m?.sellThroughId ?? "");
        })
        .map((n) => n.id);
      if (ownNotificationIds.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: ownNotificationIds } } });

      await prisma.journalLine.deleteMany({ where: { journal: { sourceType: { startsWith: "KONSI_SELLTHRU_" }, sourceId: { in: ids } } } });
      await prisma.journal.deleteMany({ where: { sourceType: { startsWith: "KONSI_SELLTHRU_" }, sourceId: { in: ids } } });
      if (mappingSnapshot) await restoreMappings(mappingSnapshot);
      const chartAccountIds = [arId, salesRevenueId, cogsId, inventoryId, inventoryVarianceId].map((id) => seededId(id));
      await prisma.chartAccount.deleteMany({ where: { id: { in: chartAccountIds } } });
    } finally {
      await fx.afterEach();
    }
  });

  /* A SHELF_COUNT DRAFT billing 4 @ 40000 (unitCost 10000): revenue 160000, COGS 40000, no shrinkage. */
  async function billingDraft(): Promise<string> {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);
    return id;
  }

  const journalTypesFor = async (id: string) =>
    (await prisma.journal.findMany({ where: { sourceId: seededId(id) }, select: { sourceType: true } }))
      .map((j) => j.sourceType)
      .sort();

  async function approvedInvoicedReport(): Promise<string> {
    const id = await billingDraft();
    await approveSellThroughAction({ id, mode: "INVOICE", invoiceDate: today(), salesmanId: state.salesmanId });
    return id;
  }

  /* approveSellThroughAction */

  it("an INVOICE approval posts the report's journals, after which nothing is left to retry", async () => {
    const id = await billingDraft();

    const result = await approveSellThroughAction({ id, mode: "INVOICE", invoiceDate: today(), salesmanId: state.salesmanId });

    expect(result).toEqual({ ok: true });
    expect(await journalTypesFor(id)).toEqual(["KONSI_SELLTHRU_COGS", "KONSI_SELLTHRU_REVENUE"]);
    await expect(retrySellThroughJournalsAction(id)).resolves.toEqual({ ok: false, reason: "NOT_RETRYABLE" });
  }, SLOW);

  it("a BASELINE approval posts no journal", async () => {
    const id = await billingDraft();

    const result = await approveSellThroughAction({ id, mode: "BASELINE", reason: "Billed outside the ERP." });

    expect(result).toEqual({ ok: true });
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(doc).toMatchObject({ status: "APPROVED", baseline: true });
    expect(await journalTypesFor(id)).toEqual([]);
  }, SLOW);

  it("refuses malformed input with INVALID_REQUEST and leaves the report untouched", async () => {
    const id = await billingDraft();
    const payloads = [
      { id, invoiceDate: today(), salesmanId: state.salesmanId },
      { id, mode: "INVOICE", invoiceDate: "2026-13-01", salesmanId: state.salesmanId },
      /* A real-looking day the calendar does not have — it parses, rolled over to 2 March, without the round-trip check. */
      { id, mode: "INVOICE", invoiceDate: "2026-02-30", salesmanId: state.salesmanId },
      { id, mode: "INVOICE", invoiceDate: today(), salesmanId: "" },
    ];

    for (const payload of payloads) {
      await expect(approveSellThroughAction(payload)).resolves.toEqual({ ok: false, reason: "INVALID_REQUEST" });
    }

    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({
      where: { id: seededId(id) },
      include: { receivable: true, taxInvoice: true },
    });
    expect(doc).toMatchObject({ status: "DRAFT", approvedAt: null, invoiceDate: null, total: null });
    expect(doc.receivable).toBeNull();
    expect(doc.taxInvoice).toBeNull();
  }, SLOW);

  /* retrySellThroughJournalsAction */

  it("retries exactly the journal that failed once its account is mapped again", async () => {
    const id = await billingDraft();
    await prisma.journalAccountMapping.delete({ where: { role: "SALES_REVENUE" } });

    await expect(
      approveSellThroughAction({ id, mode: "INVOICE", invoiceDate: today(), salesmanId: state.salesmanId }),
    ).resolves.toEqual({ ok: true });
    /* The approve still succeeded: only the revenue post degraded, and COGS posted beside it. */
    expect(await journalTypesFor(id)).toEqual(["KONSI_SELLTHRU_COGS"]);

    await prisma.journalAccountMapping.create({ data: { role: "SALES_REVENUE", chartAccountId: salesRevenueId } });
    const retry = await retrySellThroughJournalsAction(id);

    expect(retry).toEqual({ ok: true, posted: ["konsi_sell_through_revenue"], stillPending: [] });
    expect(await journalTypesFor(id)).toEqual(["KONSI_SELLTHRU_COGS", "KONSI_SELLTHRU_REVENUE"]);
    await expect(retrySellThroughJournalsAction(id)).resolves.toEqual({ ok: false, reason: "NOT_RETRYABLE" });
  }, SLOW);

  /* recordSellThroughNotaPrinted */

  it("stamps the first nota print and notifies finance once; a reprint notifies nothing", async () => {
    const id = await billingDraft();
    await approveSellThroughAction({ id, mode: "INVOICE", invoiceDate: today(), salesmanId: state.salesmanId });
    const notificationsFor = async () =>
      (await prisma.adminNotification.findMany({ where: { category: "TAX_INVOICE_PENDING" }, select: { metadata: true } })).filter(
        (n) => (n.metadata as { sellThroughId?: string } | null)?.sellThroughId === id,
      ).length;

    await recordSellThroughNotaPrinted(id);
    const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { sellThroughId: seededId(id) } });
    expect(faktur.notaPrintedAt).not.toBeNull();
    expect(faktur.notaPrintedById).toBe(state.userId);
    expect(await notificationsFor()).toBe(1);

    await recordSellThroughNotaPrinted(id);
    expect(await notificationsFor()).toBe(1);
    expect(mockLogPrint).toHaveBeenCalledTimes(2);
  }, SLOW);

  it("does nothing at all for a missing or empty id", async () => {
    const id = await billingDraft();
    await approveSellThroughAction({ id, mode: "INVOICE", invoiceDate: today(), salesmanId: state.salesmanId });

    /**
     * The session carries no permission, so a regression that drops the id guard still returns at
     * the permission check instead of running the widened CAS against every unprinted faktur on the
     * shared bed — and `auth` having been called at all is what the regression shows up as.
     */
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: state.userId, permissions: [] } });

    await recordSellThroughNotaPrinted(undefined);
    await recordSellThroughNotaPrinted("");

    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockLogPrint).not.toHaveBeenCalled();
    const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { sellThroughId: seededId(id) } });
    expect(faktur.notaPrintedAt).toBeNull();
  }, SLOW);

  it("a print that lands after the void stamps nothing and notifies no one", async () => {
    const id = await approvedInvoicedReport();
    await voidSellThroughAction(id, "wrong resolution");
    mockFanOut.mockClear();

    await recordSellThroughNotaPrinted(id);

    const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { sellThroughId: seededId(id) } });
    expect(faktur).toMatchObject({ status: "CANCELLED", notaPrintedAt: null, notaPrintedById: null });
    expect(mockFanOut).not.toHaveBeenCalled();
    const notifications = (
      await prisma.adminNotification.findMany({ where: { category: "TAX_INVOICE_PENDING" }, select: { metadata: true } })
    ).filter((n) => (n.metadata as { sellThroughId?: string } | null)?.sellThroughId === id);
    expect(notifications).toHaveLength(0);
  }, SLOW);

  /* getSellThroughNotaAction */

  it("refuses a nota for a baseline report", async () => {
    const id = await billingDraft();
    await approveSellThroughAction({ id, mode: "BASELINE", reason: "Billed outside the ERP." });

    await expect(getSellThroughNotaAction(id)).resolves.toEqual({ ok: false, reason: "INVALID_STATE" });
  }, SLOW);

  it("refuses a nota for an invoiced report that billed nothing", async () => {
    /* SPG_POS: 2 in, none sold, counted 0 → gap 2 resolved as shrinkage → total 0. */
    await setMethod("SPG_POS");
    await transferIn(2);
    const stocktakeId = await count(0, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);
    const line = await onlyLine(id);
    await resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "confirmed shrinkage", userId: state.userId });
    await expect(
      approveSellThroughAction({ id, mode: "INVOICE", invoiceDate: today(), salesmanId: null }),
    ).resolves.toEqual({ ok: true });

    await expect(getSellThroughNotaAction(id)).resolves.toEqual({ ok: false, reason: "INVALID_STATE" });
  }, SLOW);

  it("puts only the lines that billed something on the nota", async () => {
    const id = await billingDraft();
    await approveSellThroughAction({ id, mode: "INVOICE", invoiceDate: today(), salesmanId: state.salesmanId });
    /**
     * The fixture store carries one item, so a line that billed nothing is added straight onto the
     * frozen report — approve would refuse it as STALE, and the nota read is the only subject here.
     */
    await prisma.konsiSellThroughLine.create({
      data: {
        sellThroughId: id,
        itemId: state.itemId,
        variantSku: `ZERO-${state.run}`,
        productName: "Nothing billed",
        openingQty: 0,
        inQty: 0,
        outQty: 0,
        posSoldQty: 0,
        gapQty: 0,
        closingQty: 0,
        billedQty: 0,
        unitCost: 10000,
        unitPrice: 40000,
        lineTotal: 0,
      },
    });

    const result = await getSellThroughNotaAction(id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nota.lines).toHaveLength(1);
    expect(result.nota.lines[0]).toMatchObject({ billedQty: 4, unitPrice: 40000, lineTotal: 160000 });
    expect(result.nota.total).toBe(160000);
  }, SLOW);

  /* voidSellThroughAction */

  it("a void posts every reversal after commit, after which nothing is left to retry", async () => {
    const id = await approvedInvoicedReport();
    await expect(voidSellThroughAction(id, "wrong resolution")).resolves.toEqual({ ok: true });
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(doc.status).toBe("VOIDED");
    expect(await journalTypesFor(id)).toEqual(["KONSI_SELLTHRU_COGS", "KONSI_SELLTHRU_COGS_VOID", "KONSI_SELLTHRU_REVENUE", "KONSI_SELLTHRU_REVENUE_VOID"]);
    await expect(retrySellThroughJournalsAction(id)).resolves.toEqual({ ok: false, reason: "NOT_RETRYABLE" });
  }, SLOW);

  it("a reversal missing after the void is offered and posted by the retry", async () => {
    const id = await approvedInvoicedReport();
    await voidSellThroughAction(id, "wrong resolution");
    await prisma.journalLine.deleteMany({ where: { journal: { sourceType: "KONSI_SELLTHRU_COGS_VOID", sourceId: id } } });
    await prisma.journal.deleteMany({ where: { sourceType: "KONSI_SELLTHRU_COGS_VOID", sourceId: id } });
    await expect(retrySellThroughJournalsAction(id)).resolves.toEqual({ ok: true, posted: ["konsi_sell_through_cogs_void"], stillPending: [] });
  }, SLOW);

  it("a void of a report whose originals never posted posts nothing and owes nothing", async () => {
    const id = await billingDraft();
    await fx.approve(id);
    await expect(voidSellThroughAction(id, "wrong resolution")).resolves.toEqual({ ok: true });
    expect(await journalTypesFor(id)).toEqual([]);
    await expect(retrySellThroughJournalsAction(id)).resolves.toEqual({ ok: false, reason: "NOT_RETRYABLE" });
  }, SLOW);

  it("refuses a void without stores:manage, and malformed input with INVALID_REQUEST", async () => {
    const id = await approvedInvoicedReport();
    mockAuth.mockResolvedValueOnce({ user: { id: state.userId, permissions: ["stores:view"] } });
    await expect(voidSellThroughAction(id, "x")).resolves.toEqual({ ok: false, reason: "FORBIDDEN" });
    await expect(voidSellThroughAction("", "x")).resolves.toEqual({ ok: false, reason: "INVALID_REQUEST" });
    await expect(voidSellThroughAction(id, 42)).resolves.toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("APPROVED");
  }, SLOW);

  it("passes a writer refusal through, with its detail when it carries one", async () => {
    const id = await approvedInvoicedReport();
    await expect(voidSellThroughAction(id, "  ")).resolves.toEqual({ ok: false, reason: "VOID_REASON_REQUIRED" });
    await expect(voidSellThroughAction(id, "x".repeat(1001))).resolves.toEqual({
      ok: false,
      reason: "VOID_REASON_REQUIRED",
      detail: "REASON_TOO_LONG",
    });
  }, SLOW);

  it("a failure after the void committed still reports success, and the retry offers the reversals it left", async () => {
    const id = await approvedInvoicedReport();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    /* The gaps read is the first journal read after the commit, so only the post-commit steps fail. */
    const originalFindMany = prisma.journal.findMany.bind(prisma.journal);
    const journalSpy = vi.spyOn(prisma.journal, "findMany").mockRejectedValueOnce(new Error("simulated read failure"));
    try {
      await expect(voidSellThroughAction(id, "wrong resolution")).resolves.toEqual({ ok: true });
      expect(errorSpy).toHaveBeenCalledWith("[konsi-sell-through] post-void steps failed", expect.any(Error));
    } finally {
      /**
       * Pin the spy to the bound original, NOT mockRestore: a Prisma model delegate serves findMany
       * through its proxy rather than as an own property, so mockRestore leaves the method undefined
       * for every later read in this file.
       */
      journalSpy.mockImplementation(originalFindMany as unknown as typeof prisma.journal.findMany);
      errorSpy.mockRestore();
    }

    expect((await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } })).status).toBe("VOIDED");
    expect(await journalTypesFor(id)).toEqual(["KONSI_SELLTHRU_COGS", "KONSI_SELLTHRU_REVENUE"]);
    await expect(retrySellThroughJournalsAction(id)).resolves.toEqual({
      ok: true,
      posted: ["konsi_sell_through_revenue_void", "konsi_sell_through_cogs_void"],
      stillPending: [],
    });
  }, SLOW);

  it("refuses a nota for a voided report", async () => {
    const id = await approvedInvoicedReport();
    await voidSellThroughAction(id, "wrong resolution");
    await expect(getSellThroughNotaAction(id)).resolves.toMatchObject({ ok: false, reason: "INVALID_STATE" });
  }, SLOW);
});
