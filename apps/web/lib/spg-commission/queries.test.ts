import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createSellThrough, resolveSellThroughLine } from "@/lib/konsi-sell-through/writer";
import { voidSellThrough } from "@/lib/konsi-sell-through/void-writer";
import { createSellThroughFixtures } from "@/lib/konsi-sell-through/test-fixtures";
import { recordSpgSale } from "@/lib/spg/sale-writer";
import { wibYearMonth } from "./month";
import { getCommissionRecap } from "./queries";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Stubbed so the order-create fan-out cannot queue push notifications on the shared dev DB. */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Every case drives several real serializable writers end to end, well past vitest's 5s default. */
const SLOW = 60_000;

const RATE = 1500;

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

  it("credits a late carry-forward sale to its SPG on the report that billed it, and leaves the earlier report's split alone", async () => {
    const first = await approvedReport();
    await tick();
    /* A sale by B whose store row is then stamped at report 1's boundary: inside its window, committed after its approval. */
    const lateSaleId = await sell(spgBId, 1);
    const lateRow = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { locationType: "STORE", locationId: seededId(state.storeId), refType: "SpgSale", refId: seededId(lateSaleId) },
    });
    await prisma.stockLedgerEntry.update({ where: { id: lateRow.id }, data: { createdAt: first.periodEnd } });
    await tick();
    /* StoreStock 6 − 1 = 5 and the shelf holds 5: the count matches and writes no row. */
    const secondCount = await count(5);
    const second = await createSellThrough({ closingStocktakeId: secondCount, createdById: state.userId });
    const line = await onlyLine(second.id);
    expect(Number(line.posSoldQty)).toBe(1);
    expect(Number(line.latePosSoldQty)).toBe(1);
    await fx.approve(second.id);
    const secondDoc = await reportOf(second.id);

    const firstEvents = (await recap(wibYearMonth(first.approvedAt!))).events.filter((e) => e.sellThroughId === first.id);
    expect(firstEvents.map((e) => [e.salesmanId, e.pieces]).sort()).toEqual(
      [
        [spgAId, 3],
        [spgBId, 1],
      ].sort(),
    );
    const secondEvents = (await recap(wibYearMonth(secondDoc.approvedAt!))).events.filter((e) => e.sellThroughId === second.id);
    expect(secondEvents.map((e) => [e.kind, e.salesmanId, e.pieces, e.amount])).toEqual([["EARNED", spgBId, 1, RATE]]);
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
