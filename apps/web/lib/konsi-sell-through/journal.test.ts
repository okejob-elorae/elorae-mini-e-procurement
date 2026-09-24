import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "@/lib/finance/journals/mapping-test-fixture";
import {
  sellThroughCostTotals,
  postSellThroughRevenueJournal,
  postSellThroughCogsJournal,
  postSellThroughShrinkageJournal,
  sellThroughJournalGaps,
} from "./journal";
import { createSellThrough, resolveSellThroughLine } from "./writer";
import { createSellThroughFixtures } from "./test-fixtures";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the order-create fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

const MAPPED_ROLES: PostingRole[] = ["AR", "SALES_REVENUE", "COGS", "INVENTORY", "INVENTORY_VARIANCE"];

d("konsi sell-through journals (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state, setMethod, transferIn, count, onlyLine } = fx;

  let mappingSnapshot: MappingSnapshot | undefined;
  let arId = "";
  let salesRevenueId = "";
  let cogsId = "";
  let inventoryId = "";
  let inventoryVarianceId = "";
  let reportIds: string[] = [];

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
      (await prisma.chartAccount.create({ data: { code: `9${state.run}${suffix}`, name: "t", type, depth: 1, isActive: true } })).id;
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
  });

  afterEach(async () => {
    /**
     * Journals are the record this file's own writes leave behind — cleared BEFORE the mappings and
     * chart accounts they point at, and before the fixture's own afterEach tears the report down.
     * The fixture teardown runs in `finally`, so a `beforeEach` that failed part-way (no snapshot
     * yet, or no chart accounts) still never leaks the fixture's rows.
     */
    try {
      const ids = reportIds.map((id) => seededId(id));
      await prisma.journalLine.deleteMany({ where: { journal: { sourceType: { startsWith: "KONSI_SELLTHRU_" }, sourceId: { in: ids } } } });
      await prisma.journal.deleteMany({ where: { sourceType: { startsWith: "KONSI_SELLTHRU_" }, sourceId: { in: ids } } });
      if (mappingSnapshot) await restoreMappings(mappingSnapshot);
      const chartAccountIds = [arId, salesRevenueId, cogsId, inventoryId, inventoryVarianceId].map((id) => seededId(id));
      await prisma.chartAccount.deleteMany({ where: { id: { in: chartAccountIds } } });
    } finally {
      await fx.afterEach();
    }
  });

  it("sellThroughCostTotals sums billed and shrinkage cost at the line's unit cost, rounded", () => {
    expect(
      sellThroughCostTotals([
        { billedQty: 4, shrinkageQty: 0, unitCost: 10000 },
        { billedQty: 1.5, shrinkageQty: 2, unitCost: 333.34 },
      ]),
    ).toEqual({ cogs: 40500.01, shrinkage: 666.68 });
    /* 1.5 × 333.34 = 500.01 → cogs 40500.01; 2 × 333.34 = 666.68 (values chosen off the half-cent boundary) */
  });

  it("posts revenue Dr AR / Cr SALES_REVENUE for the total and COGS Dr COGS / Cr INVENTORY at unit cost, dated on the invoice date", async () => {
    /* SHELF_COUNT report billing 4 @ 50000, unitCost 10000 → revenue 200000, cogs 40000 */
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);
    await fx.approve(id);
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });
    expect(Number(doc.total)).toBe(200000);

    const rev = await postSellThroughRevenueJournal(id, state.userId);
    const cogs = await postSellThroughCogsJournal(id, state.userId);
    expect(rev).toMatchObject({ ok: true, created: true });
    expect(cogs).toMatchObject({ ok: true, created: true });

    const journals = await prisma.journal.findMany({ where: { sourceId: id }, include: { lines: true } });
    expect(journals).toHaveLength(2);
    const revenueJournal = journals.find((j) => j.sourceType === "KONSI_SELLTHRU_REVENUE");
    const cogsJournal = journals.find((j) => j.sourceType === "KONSI_SELLTHRU_COGS");
    expect(revenueJournal).toBeDefined();
    expect(cogsJournal).toBeDefined();
    expect(revenueJournal!.date.toISOString()).toBe(doc.invoiceDate!.toISOString());
    expect(cogsJournal!.date.toISOString()).toBe(doc.invoiceDate!.toISOString());
    expect(Number(revenueJournal!.lines.find((l) => l.chartAccountId === arId)!.debit)).toBe(200000);
    expect(Number(revenueJournal!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(0);
    expect(Number(revenueJournal!.lines.find((l) => l.chartAccountId === salesRevenueId)!.credit)).toBe(200000);
    expect(Number(revenueJournal!.lines.find((l) => l.chartAccountId === salesRevenueId)!.debit)).toBe(0);
    expect(Number(cogsJournal!.lines.find((l) => l.chartAccountId === cogsId)!.debit)).toBe(40000);
    expect(Number(cogsJournal!.lines.find((l) => l.chartAccountId === inventoryId)!.credit)).toBe(40000);
  }, SLOW);

  it("returns NOTHING_TO_POST for shrinkage when nothing shrank, and for all three on a baseline report", async () => {
    /**
     * The store's first report bills 4 of 6 and is approved as a baseline, so a billed amount
     * exists and only the baseline guard stops the posters.
     */
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const baselineStocktake = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id: baselineId } = await createSellThrough({ closingStocktakeId: baselineStocktake, createdById: state.userId });
    reportIds.push(baselineId);
    expect(Number((await onlyLine(baselineId)).billedQty)).toBe(4);
    await fx.approveBaseline(baselineId);
    await expect(postSellThroughRevenueJournal(baselineId, state.userId)).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
    await expect(postSellThroughCogsJournal(baselineId, state.userId)).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
    await expect(postSellThroughShrinkageJournal(baselineId, state.userId)).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
    expect(await sellThroughJournalGaps(baselineId)).toEqual([]);

    /* The second report of the chain bills a real amount but shrinks nothing (SHELF_COUNT never carries a shrinkageQty). */
    await fx.tick();
    await transferIn(4);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);
    await fx.approve(id);
    await expect(postSellThroughShrinkageJournal(id, state.userId)).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
  }, SLOW);

  it("a report billing 0 with shrinkage posts only its shrinkage journal", async () => {
    /* SPG_POS: 2 in, POS 0, counted 0 → gap 2 → resolve SHRINKAGE → approve with salesmanId null */
    await setMethod("SPG_POS");
    await transferIn(2);
    const stocktakeId = await count(0, { cause: "SHRINKAGE", reason: "two units missing" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);
    const line = await onlyLine(id);
    expect(Number(line.gapQty)).toBe(2);
    expect(Number(line.billedQty)).toBe(0);
    expect(line.suggestedResolution).toBe("SHRINKAGE");

    await resolveSellThroughLine({ lineId: line.id, resolution: "SHRINKAGE", reason: "confirmed shrinkage", userId: state.userId });
    const resolved = await onlyLine(id);
    expect(Number(resolved.billedQty)).toBe(0);
    expect(Number(resolved.shrinkageQty)).toBe(2);

    await fx.approve(id, { salesmanId: null });
    const doc = await prisma.konsiSellThrough.findUniqueOrThrow({
      where: { id: seededId(id) },
      include: { receivable: true, taxInvoice: true },
    });
    expect(Number(doc.total)).toBe(0);
    expect(doc.salesmanId).toBeNull();
    expect(doc.receivable).toBeNull();
    expect(doc.taxInvoice).toBeNull();

    /* A zero amount is never owed: only the shrinkage journal is a gap. */
    expect(await sellThroughJournalGaps(id)).toEqual(["konsi_sell_through_shrinkage"]);

    /* revenue & cogs → NOTHING_TO_POST; shrinkage → ok, Dr INVENTORY_VARIANCE 20000 / Cr INVENTORY 20000 */
    await expect(postSellThroughRevenueJournal(id, state.userId)).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
    await expect(postSellThroughCogsJournal(id, state.userId)).resolves.toMatchObject({ ok: false, code: "NOTHING_TO_POST" });
    const shrinkage = await postSellThroughShrinkageJournal(id, state.userId);
    expect(shrinkage).toMatchObject({ ok: true, created: true });

    const journal = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "KONSI_SELLTHRU_SHRINKAGE", sourceId: id } },
      include: { lines: true },
    });
    expect(Number(journal.lines.find((l) => l.chartAccountId === inventoryVarianceId)!.debit)).toBe(20000);
    expect(Number(journal.lines.find((l) => l.chartAccountId === inventoryId)!.credit)).toBe(20000);
    expect(await sellThroughJournalGaps(id)).toEqual([]);
  }, SLOW);

  it("sellThroughJournalGaps lists each owed kind until its journal lands, skipping a zero amount", async () => {
    /* SHELF_COUNT billing 4 with no shrinkage: revenue and COGS are owed, shrinkage never is. */
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);

    /* A DRAFT owes nothing yet. */
    expect(await sellThroughJournalGaps(id)).toEqual([]);

    await fx.approve(id);
    expect(await sellThroughJournalGaps(id)).toEqual(["konsi_sell_through_revenue", "konsi_sell_through_cogs"]);

    await postSellThroughRevenueJournal(id, state.userId);
    expect(await sellThroughJournalGaps(id)).toEqual(["konsi_sell_through_cogs"]);

    await postSellThroughCogsJournal(id, state.userId);
    expect(await sellThroughJournalGaps(id)).toEqual([]);
  }, SLOW);

  it("re-posting is idempotent: the second call returns created: false and writes no second journal", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);
    await fx.approve(id);

    const first = await postSellThroughRevenueJournal(id, state.userId);
    const second = await postSellThroughRevenueJournal(id, state.userId);
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    if (first.ok && second.ok) expect(second.journalId).toBe(first.journalId);
    expect(await prisma.journal.count({ where: { sourceType: "KONSI_SELLTHRU_REVENUE", sourceId: id } })).toBe(1);
  }, SLOW);

  it("an unmapped role returns UNMAPPED_ROLE naming it", async () => {
    await setMethod("SHELF_COUNT");
    await transferIn(6);
    const stocktakeId = await count(2, { cause: "UNRECORDED_SALE", reason: "sold off the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    reportIds.push(id);
    await fx.approve(id);

    await prisma.journalAccountMapping.delete({ where: { role: "SALES_REVENUE" } });
    await expect(postSellThroughRevenueJournal(id, state.userId)).resolves.toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "SALES_REVENUE" });
  }, SLOW);
});
