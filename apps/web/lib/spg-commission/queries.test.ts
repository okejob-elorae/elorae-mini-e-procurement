import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createSellThrough, resolveSellThroughLine } from "@/lib/konsi-sell-through/writer";
import { voidSellThrough } from "@/lib/konsi-sell-through/void-writer";
import { createSellThroughFixtures } from "@/lib/konsi-sell-through/test-fixtures";
import { recordSpgSale } from "@/lib/spg/sale-writer";
import { wibYearMonth } from "./month";
import { getCommissionRecap } from "./queries";
import { shiftYearMonth } from "./recap-display";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the order-create fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

const RATE = 1500;

/* Distinct from RATE so a reversal is seen to mirror the approval month's rate, not the void month's. */
const PREVIOUS_MONTH_RATE = 2500;

d("getCommissionRecap (test bed only)", () => {
  const fx = createSellThroughFixtures();
  const { state, tick, setMethod, transferIn, count, onlyLine } = fx;

  let categoryId = "";
  let noRateCategoryId = "";
  let spgAId = "";
  let spgBId = "";

  beforeEach(async () => {
    categoryId = "";
    noRateCategoryId = "";
    spgAId = "";
    spgBId = "";
    await fx.beforeEach();

    const category = await prisma.itemCategory.create({ data: { code: `TEST-SPGREC-${state.run}`, name: "Test SPG recap jenis", isActive: true } });
    categoryId = category.id;
    const noRate = await prisma.itemCategory.create({ data: { code: `TEST-SPGREC-NR-${state.run}`, name: "Test SPG recap unrated", isActive: true } });
    noRateCategoryId = noRate.id;
    /* Effective long before any report here, so every approval month resolves to it. */
    await prisma.spgCommissionRate.create({
      data: { itemCategoryId: categoryId, amountPerPiece: RATE, effectiveFrom: "2000-01", createdById: "test-spg-commission-recap" },
    });
    await prisma.item.update({ where: { id: state.itemId }, data: { categoryId } });

    const spgA = await prisma.user.create({ data: { email: `test-spgrec-a-${state.run}@example.com`, name: "Test SPG A" } });
    spgAId = spgA.id;
    const spgB = await prisma.user.create({ data: { email: `test-spgrec-b-${state.run}@example.com`, name: "Test SPG B" } });
    spgBId = spgB.id;

    await setMethod("SPG_POS");
  });

  afterEach(async () => {
    try {
      await fx.afterEach();
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [spgAId, spgBId].map(seededId) } } });
      await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: { in: [categoryId, noRateCategoryId].map(seededId) } } });
      await prisma.itemCategory.deleteMany({ where: { id: { in: [categoryId, noRateCategoryId].map(seededId) } } });
    }
  });

  /* One POS sale by the given SPG through the real writer, which writes the SpgSale store ledger row at a KONSI store. */
  const sell = async (salesmanId: string, qty: number) => {
    const res = await recordSpgSale({ salesmanId, storeId: state.storeId, lines: [{ itemId: state.itemId, variantSku: null, qty }] });
    if (!res.ok) throw new Error(`recordSpgSale refused the fixture sale: ${res.code}`);
    await tick();
    return res.spgSaleId;
  };

  const recap = (yearMonth: string) => getCommissionRecap(yearMonth, prisma, { storeIds: [state.storeId] });

  const reportOf = (id: string) => prisma.konsiSellThrough.findUniqueOrThrow({ where: { id: seededId(id) } });

  /* 10 in; SPG A sells 3 and SPG B 1; the shelf holds the expected 6, so the line has no gap and bills POS 4. */
  async function approvedReport() {
    await transferIn(10);
    await sell(spgAId, 3);
    await sell(spgBId, 1);
    const stocktakeId = await count(6);
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await fx.approve(id);
    return reportOf(id);
  }

  it("earns each SPG's POS pieces at the category rate in the approval month, and a void reverses them in the void's month", async () => {
    const report = await approvedReport();
    const earnedMonth = wibYearMonth(report.approvedAt!);

    const earned = await recap(earnedMonth);
    const rowA = earned.rows.find((r) => r.salesmanId === spgAId);
    const rowB = earned.rows.find((r) => r.salesmanId === spgBId);
    expect(rowA).toEqual({ salesmanId: spgAId, storeIds: [state.storeId], pieces: 3, earned: 3 * RATE, reversed: 0, net: 3 * RATE, noRatePieces: 0 });
    expect(rowB).toEqual({ salesmanId: spgBId, storeIds: [state.storeId], pieces: 1, earned: RATE, reversed: 0, net: RATE, noRatePieces: 0 });
    expect(earned.rows).toHaveLength(2);
    expect(earned.detail.filter((r) => r.salesmanId === spgAId)).toEqual([
      { salesmanId: spgAId, categoryId, pieces: 3, earned: 3 * RATE, reversed: 0, net: 3 * RATE, noRatePieces: 0 },
    ]);
    expect(earned.noRate).toEqual([]);
    expect(earned.spgNames[spgAId]).toBe("Test SPG A");
    expect(earned.storeNames[state.storeId]).toBe("Test Sell-through Store");
    expect(earned.categoryNames[categoryId]).toBe("Test SPG recap jenis");
    /* The fixture's own user sold nothing here and so earns nothing. */
    expect(earned.rows.find((r) => r.salesmanId === state.userId)).toBeUndefined();

    await voidSellThrough({ id: report.id, voidedById: state.userId, reason: "Recount needed." });
    const voided = await reportOf(report.id);
    const voidMonth = wibYearMonth(voided.voidedAt!);

    const reversed = await recap(voidMonth);
    const reversals = reversed.events.filter((e) => e.sellThroughId === report.id && e.kind === "REVERSED");
    expect(reversals.map((e) => [e.salesmanId, e.pieces, e.ratePerPiece, e.amount]).sort()).toEqual(
      [
        [spgAId, -3, RATE, -3 * RATE],
        [spgBId, -1, RATE, -RATE],
      ].sort(),
    );
    if (voidMonth === earnedMonth) {
      expect(reversed.rows.find((r) => r.salesmanId === spgAId)).toMatchObject({ pieces: 0, earned: 3 * RATE, reversed: -3 * RATE, net: 0 });
    } else {
      expect(reversed.rows.find((r) => r.salesmanId === spgAId)).toMatchObject({ pieces: -3, earned: 0, reversed: -3 * RATE, net: -3 * RATE });
      expect((await recap(earnedMonth)).rows.find((r) => r.salesmanId === spgAId)).toMatchObject({ net: 3 * RATE });
    }
  }, SLOW);

  it("books a report approved last month and voided this month as EARNED there and only REVERSED here, at the approval month's rate", async () => {
    const report = await approvedReport();
    await voidSellThrough({ id: report.id, voidedById: state.userId, reason: "Recount needed." });
    const voidMonth = wibYearMonth((await reportOf(report.id)).voidedAt!);
    const approvalMonth = shiftYearMonth(voidMonth, -1);
    /* Mid-month at noon WIB, so the moved approval sits well inside the previous WIB month. */
    await prisma.konsiSellThrough.update({
      where: { id: report.id },
      data: { approvedAt: new Date(`${approvalMonth}-15T12:00:00+07:00`) },
    });
    /* Written directly: `setRate` closes past months, a UI rule this case has to step around to back-date one. */
    await prisma.spgCommissionRate.createMany({
      data: [
        { itemCategoryId: categoryId, amountPerPiece: PREVIOUS_MONTH_RATE, effectiveFrom: approvalMonth, createdById: "test-spg-commission-recap" },
        { itemCategoryId: categoryId, amountPerPiece: RATE, effectiveFrom: voidMonth, createdById: "test-spg-commission-recap" },
      ],
    });

    const earned = await recap(approvalMonth);
    expect(earned.events.filter((e) => e.sellThroughId === report.id).map((e) => [e.kind, e.salesmanId, e.pieces, e.amount]).sort()).toEqual(
      [
        ["EARNED", spgAId, 3, 3 * PREVIOUS_MONTH_RATE],
        ["EARNED", spgBId, 1, PREVIOUS_MONTH_RATE],
      ].sort(),
    );
    expect(earned.rows.find((r) => r.salesmanId === spgAId)).toMatchObject({ pieces: 3, earned: 3 * PREVIOUS_MONTH_RATE, reversed: 0, net: 3 * PREVIOUS_MONTH_RATE });

    const reversed = await recap(voidMonth);
    expect(reversed.events.filter((e) => e.sellThroughId === report.id).map((e) => [e.kind, e.salesmanId, e.pieces, e.ratePerPiece, e.amount]).sort()).toEqual(
      [
        ["REVERSED", spgAId, -3, PREVIOUS_MONTH_RATE, -3 * PREVIOUS_MONTH_RATE],
        ["REVERSED", spgBId, -1, PREVIOUS_MONTH_RATE, -PREVIOUS_MONTH_RATE],
      ].sort(),
    );
    expect(reversed.rows.find((r) => r.salesmanId === spgAId)).toMatchObject({ pieces: -3, earned: 0, reversed: -3 * PREVIOUS_MONTH_RATE, net: -3 * PREVIOUS_MONTH_RATE });
    expect(reversed.rows.find((r) => r.salesmanId === spgBId)).toMatchObject({ pieces: -1, earned: 0, reversed: -PREVIOUS_MONTH_RATE, net: -PREVIOUS_MONTH_RATE });
  }, SLOW);

  it("reads only the stores in scope: an empty store list reads nothing", async () => {
    const report = await approvedReport();
    const none = await getCommissionRecap(wibYearMonth(report.approvedAt!), prisma, { storeIds: [] });
    expect(none.rows).toEqual([]);
    expect(none.events).toEqual([]);
  }, SLOW);

  it("a REDUCE-resolved surplus confirms only the billed pieces, split largest-remainder", async () => {
    await transferIn(10);
    await sell(spgAId, 3);
    await sell(spgBId, 1);
    /* Expected 6 on the shelf, 7 counted: a surplus of 1, held until resolved. */
    const stocktakeId = await count(7, { reason: "one more on the shelf" });
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    const line = await onlyLine(id);
    expect(Number(line.posSoldQty)).toBe(4);
    expect(Number(line.gapQty)).toBe(-1);
    await resolveSellThroughLine({ lineId: line.id, resolution: "REDUCE", reason: "POS over-recorded one", userId: state.userId });
    expect(Number((await onlyLine(id)).billedQty)).toBe(3);
    await fx.approve(id);

    const report = await reportOf(id);
    const result = await recap(wibYearMonth(report.approvedAt!));
    /* 3 over 3:1 → quotas 2.25 and 0.75; the spare piece goes to the larger remainder, B's. */
    expect(result.events.filter((e) => e.sellThroughId === id).map((e) => [e.salesmanId, e.pieces]).sort()).toEqual(
      [
        [spgAId, 2],
        [spgBId, 1],
      ].sort(),
    );
  }, SLOW);

  /**
   * Report 1 (A 3, B 1) approved, then a late sale by A whose store row is stamped just before A's
   * first counted sale: its insert ran before the counted rows, its commit landed after report 1's
   * approval. Re-read live, report 1's own share would be the first 4 units — A's 4 — and B's
   * counted unit would pass to report 2, which carries the 1 late unit and is approved.
   */
  async function lateRowAmongCountedChain() {
    await transferIn(10);
    const firstSaleId = await sell(spgAId, 3);
    await sell(spgBId, 1);
    const firstCount = await count(6);
    const created = await createSellThrough({ closingStocktakeId: firstCount, createdById: state.userId });
    await fx.approve(created.id);
    const first = await reportOf(created.id);
    await tick();
    const lateSaleId = await sell(spgAId, 1);
    const saleRow = (saleId: string) =>
      prisma.stockLedgerEntry.findFirstOrThrow({
        where: { locationType: "STORE", locationId: seededId(state.storeId), refType: "SpgSale", refId: seededId(saleId) },
      });
    const firstRow = await saleRow(firstSaleId);
    const lateRow = await saleRow(lateSaleId);
    await prisma.stockLedgerEntry.update({ where: { id: lateRow.id }, data: { createdAt: new Date(firstRow.createdAt.getTime() - 1) } });
    await tick();
    /* StoreStock 6 − 1 = 5 and the shelf holds 5: the count matches and writes no row. */
    const secondCount = await count(5);
    const second = await createSellThrough({ closingStocktakeId: secondCount, createdById: state.userId });
    const line = await onlyLine(second.id);
    expect(Number(line.posSoldQty)).toBe(1);
    expect(Number(line.latePosSoldQty)).toBe(1);
    await fx.approve(second.id);
    const secondDoc = await reportOf(second.id);
    return { first, secondDoc };
  }

  it("pins report 1's split by its snapshot when a late row sorts among its counted rows, and credits the late unit to the SPG who sold it", async () => {
    const { first, secondDoc } = await lateRowAmongCountedChain();

    const firstEvents = (await recap(wibYearMonth(first.approvedAt!))).events.filter((e) => e.sellThroughId === first.id);
    expect(firstEvents.map((e) => [e.salesmanId, e.pieces]).sort()).toEqual(
      [
        [spgAId, 3],
        [spgBId, 1],
      ].sort(),
    );
    const secondEvents = (await recap(wibYearMonth(secondDoc.approvedAt!))).events.filter((e) => e.sellThroughId === secondDoc.id);
    expect(secondEvents.map((e) => [e.kind, e.salesmanId, e.pieces, e.amount])).toEqual([["EARNED", spgAId, 1, RATE]]);
  }, SLOW);

  it("a report with no marker after a snapshotted one still cuts its late share by difference, never positionally", async () => {
    const { secondDoc } = await lateRowAmongCountedChain();
    /* Test-only: report 2 as an older image would have approved it — no marker, no rows — after report 1 was snapshotted. */
    await prisma.konsiSellThroughSpgShare.deleteMany({ where: { sellThroughId: seededId(secondDoc.id) } });
    await prisma.konsiSellThrough.update({ where: { id: seededId(secondDoc.id) }, data: { spgSplitSnapshotAt: null } });

    /* Positionally the late unit would be the 5th of report 1's window — B's counted sale; by difference it is A's. */
    const events = (await recap(wibYearMonth(secondDoc.approvedAt!))).events.filter((e) => e.sellThroughId === secondDoc.id);
    expect(events.map((e) => [e.kind, e.salesmanId, e.pieces, e.amount])).toEqual([["EARNED", spgAId, 1, RATE]]);
  }, SLOW);

  it("weighs a snapshotted report by its stored share rows, and a report with no snapshot marker by the live ledger", async () => {
    const report = await approvedReport();
    const month = wibYearMonth(report.approvedAt!);
    const piecesOf = async () =>
      (await recap(month)).events
        .filter((e) => e.sellThroughId === report.id)
        .map((e) => [e.salesmanId, e.pieces])
        .sort();

    /* Rewritten test-only to a split the ledger does not hold, so the recap is seen to read the rows. */
    await prisma.konsiSellThroughSpgShare.updateMany({ where: { sellThroughId: seededId(report.id), salesmanId: seededId(spgAId) }, data: { units: 1 } });
    await prisma.konsiSellThroughSpgShare.updateMany({ where: { sellThroughId: seededId(report.id), salesmanId: seededId(spgBId) }, data: { units: 3 } });
    expect(await piecesOf()).toEqual(
      [
        [spgAId, 1],
        [spgBId, 3],
      ].sort(),
    );

    /* A report approved before the snapshot existed carries no marker: its split is derived from the ledger, its rows ignored. */
    await prisma.konsiSellThrough.update({ where: { id: seededId(report.id) }, data: { spgSplitSnapshotAt: null } });
    expect(await piecesOf()).toEqual(
      [
        [spgAId, 3],
        [spgBId, 1],
      ].sort(),
    );
  }, SLOW);

  it("a baseline report earns nothing", async () => {
    await transferIn(10);
    await sell(spgAId, 2);
    const stocktakeId = await count(8);
    const { id } = await createSellThrough({ closingStocktakeId: stocktakeId, createdById: state.userId });
    await fx.approveBaseline(id);

    const result = await recap(wibYearMonth((await reportOf(id)).approvedAt!));
    expect(result.rows).toEqual([]);
    expect(result.events).toEqual([]);
  }, SLOW);

  it("an item in a category with no rate earns 0 and is flagged with its category's name", async () => {
    await prisma.item.update({ where: { id: state.itemId }, data: { categoryId: noRateCategoryId } });
    const report = await approvedReport();

    const result = await recap(wibYearMonth(report.approvedAt!));
    expect(result.rows.find((r) => r.salesmanId === spgAId)).toMatchObject({ pieces: 3, earned: 0, net: 0, noRatePieces: 3 });
    expect(result.noRate).toEqual([{ categoryId: noRateCategoryId, categoryName: "Test SPG recap unrated", pieces: 4 }]);
  }, SLOW);
});
