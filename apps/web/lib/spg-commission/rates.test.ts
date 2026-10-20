import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { deleteItemCategoryRecord, ItemCategoryDeleteError } from "@/lib/item-categories/mutations";
import { SpgCommissionRateError } from "./errors";
import { listRates, setRate } from "./rates";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* 2026-10-31T17:30Z is already 1 November in WIB, so the current WIB month is 2026-11. */
const NOW = new Date("2026-10-31T17:30:00.000Z");
const ACTOR = "test-spg-commission-actor";

d("setRate (test bed only)", () => {
  const tag = `TEST-SPGCOM-${Math.random().toString(36).slice(2, 10)}`;
  let categoryId = "";
  let inactiveCategoryId = "";

  beforeEach(async () => {
    categoryId = "";
    inactiveCategoryId = "";
    const category = await prisma.itemCategory.create({ data: { code: `${tag}-A`, name: "Test SPG commission", isActive: true } });
    categoryId = category.id;
    const inactive = await prisma.itemCategory.create({ data: { code: `${tag}-I`, name: "Test SPG commission inactive", isActive: false } });
    inactiveCategoryId = inactive.id;
  });

  afterEach(async () => {
    await prisma.spgCommissionRate.deleteMany({
      where: { itemCategoryId: { in: [categoryId, inactiveCategoryId].map(seededId) } },
    });
    await prisma.itemCategory.deleteMany({ where: { id: { in: [categoryId, inactiveCategoryId].map(seededId) } } });
  });

  it("upserts on the category and month: a second write updates the same row", async () => {
    const first = await setRate({ itemCategoryId: categoryId, amountPerPiece: 1000, effectiveFrom: "2026-11", actorId: ACTOR }, NOW);
    const second = await setRate({ itemCategoryId: categoryId, amountPerPiece: 1500, effectiveFrom: "2026-11", actorId: ACTOR }, NOW);

    expect(second.id).toBe(first.id);
    expect(second.amountPerPiece).toBe(1500);
    const rows = await prisma.spgCommissionRate.findMany({ where: { itemCategoryId: seededId(categoryId) } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amountPerPiece)).toBe(1500);
    expect(rows[0].createdById).toBe(ACTOR);
  });

  it("keeps one row per month and lists them, newest month first", async () => {
    await setRate({ itemCategoryId: categoryId, amountPerPiece: 1000, effectiveFrom: "2026-11", actorId: ACTOR }, NOW);
    await setRate({ itemCategoryId: categoryId, amountPerPiece: 0, effectiveFrom: "2027-01", actorId: ACTOR }, NOW);

    const mine = (await listRates()).filter((r) => r.itemCategoryId === categoryId);
    expect(mine.map((r) => [r.effectiveFrom, r.amountPerPiece])).toEqual([
      ["2027-01", 0],
      ["2026-11", 1000],
    ]);
  });

  it("refuses a month already past in WIB, and accepts the current one", async () => {
    await expect(
      setRate({ itemCategoryId: categoryId, amountPerPiece: 1000, effectiveFrom: "2026-10", actorId: ACTOR }, NOW),
    ).rejects.toMatchObject({ code: "MONTH_CLOSED" });
    await expect(
      setRate({ itemCategoryId: categoryId, amountPerPiece: 1000, effectiveFrom: "2026-11", actorId: ACTOR }, NOW),
    ).resolves.toMatchObject({ effectiveFrom: "2026-11" });
  });

  it("refuses a malformed month", async () => {
    await expect(
      setRate({ itemCategoryId: categoryId, amountPerPiece: 1000, effectiveFrom: "2026-13", actorId: ACTOR }, NOW),
    ).rejects.toMatchObject({ code: "INVALID_MONTH" });
  });

  it("refuses a fractional, negative, non-finite or oversized amount", async () => {
    for (const amountPerPiece of [1500.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e13]) {
      await expect(
        setRate({ itemCategoryId: categoryId, amountPerPiece, effectiveFrom: "2026-11", actorId: ACTOR }, NOW),
      ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    }
    expect(await prisma.spgCommissionRate.count({ where: { itemCategoryId: seededId(categoryId) } })).toBe(0);
  });

  it("refuses an inactive or missing category", async () => {
    await expect(
      setRate({ itemCategoryId: inactiveCategoryId, amountPerPiece: 1000, effectiveFrom: "2026-11", actorId: ACTOR }, NOW),
    ).rejects.toMatchObject({ code: "CATEGORY_INACTIVE" });
    await expect(
      setRate({ itemCategoryId: `${tag}-missing`, amountPerPiece: 1000, effectiveFrom: "2026-11", actorId: ACTOR }, NOW),
    ).rejects.toBeInstanceOf(SpgCommissionRateError);
    await expect(
      setRate({ itemCategoryId: `${tag}-missing`, amountPerPiece: 1000, effectiveFrom: "2026-11", actorId: ACTOR }, NOW),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });
  });

  it("blocks deleting a category that still has a commission rate", async () => {
    await setRate({ itemCategoryId: categoryId, amountPerPiece: 1000, effectiveFrom: "2026-11", actorId: ACTOR }, NOW);

    await expect(deleteItemCategoryRecord(categoryId)).rejects.toBeInstanceOf(ItemCategoryDeleteError);
    await expect(deleteItemCategoryRecord(categoryId)).rejects.toMatchObject({ code: "HAS_COMMISSION_RATES" });
    expect(await prisma.itemCategory.count({ where: { id: seededId(categoryId) } })).toBe(1);
  });
});
