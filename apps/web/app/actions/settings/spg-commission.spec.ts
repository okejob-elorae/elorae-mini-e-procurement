import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpgCommissionRateError } from "@/lib/spg-commission/errors";

const { mockAuth, mockSetRate, mockListRates, mockListCategories, mockUserFindMany, mockRevalidate } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockSetRate: vi.fn(),
    mockListRates: vi.fn(),
    mockListCategories: vi.fn(),
    mockUserFindMany: vi.fn(),
    mockRevalidate: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({ prisma: { user: { findMany: mockUserFindMany } } }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/item-categories/queries", () => ({ listItemCategories: mockListCategories }));
vi.mock("@/lib/spg-commission/rates", () => ({
  MAX_AMOUNT_PER_PIECE: 9_999_999_999_999,
  listRates: mockListRates,
  setRate: mockSetRate,
}));

import { getSpgCommissionSettings, setSpgCommissionRate } from "./spg-commission";

const MANAGER = { user: { id: "u1", permissions: ["spg_commission:manage"] } };
const VALID_INPUT = { itemCategoryId: "cat-1", amountPerPiece: 1500, effectiveFrom: "2026-11" };

describe("setSpgCommissionRate", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockSetRate.mockReset();
    mockRevalidate.mockReset();
    mockAuth.mockResolvedValue(MANAGER);
    mockSetRate.mockResolvedValue({});
  });

  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await setSpgCommissionRate(VALID_INPUT)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockSetRate).not.toHaveBeenCalled();
  });

  it("refuses without spg_commission:manage", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["spg_sales:view"] } });
    expect(await setSpgCommissionRate(VALID_INPUT)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockSetRate).not.toHaveBeenCalled();
  });

  it("accepts the admin wildcard", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin", permissions: ["*"] } });
    expect(await setSpgCommissionRate(VALID_INPUT)).toEqual({ ok: true });
    expect(mockSetRate).toHaveBeenCalledWith({ ...VALID_INPUT, actorId: "admin" });
  });

  it.each([
    ["a fraction", 1500.5],
    ["a negative amount", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "1500"],
    ["null", null],
    ["an amount past DECIMAL(15, 2)", 10_000_000_000_000],
  ])("refuses %s as the amount without writing", async (_label, amountPerPiece) => {
    const input = { ...VALID_INPUT, amountPerPiece } as unknown as typeof VALID_INPUT;
    expect(await setSpgCommissionRate(input)).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(mockSetRate).not.toHaveBeenCalled();
  });

  it.each([
    ["month 13", "2026-13"],
    ["a full date", "2026-11-01"],
    ["a number", 202611],
    ["a missing month", undefined],
  ])("refuses %s as the month without writing", async (_label, effectiveFrom) => {
    const input = { ...VALID_INPUT, effectiveFrom } as unknown as typeof VALID_INPUT;
    expect(await setSpgCommissionRate(input)).toEqual({ ok: false, reason: "INVALID_MONTH" });
    expect(mockSetRate).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty id", ""],
    ["a numeric id", 7],
    ["a missing id", undefined],
  ])("refuses %s as the category without writing", async (_label, itemCategoryId) => {
    const input = { ...VALID_INPUT, itemCategoryId } as unknown as typeof VALID_INPUT;
    expect(await setSpgCommissionRate(input)).toEqual({ ok: false, reason: "CATEGORY_NOT_FOUND" });
    expect(mockSetRate).not.toHaveBeenCalled();
  });

  it("refuses a missing payload without writing", async () => {
    const input = undefined as unknown as typeof VALID_INPUT;
    expect(await setSpgCommissionRate(input)).toEqual({ ok: false, reason: "CATEGORY_NOT_FOUND" });
    expect(mockSetRate).not.toHaveBeenCalled();
  });

  it("writes as the session user and revalidates the page", async () => {
    expect(await setSpgCommissionRate({ ...VALID_INPUT, amountPerPiece: 0 })).toEqual({ ok: true });
    expect(mockSetRate).toHaveBeenCalledWith({ ...VALID_INPUT, amountPerPiece: 0, actorId: "u1" });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/settings/spg-commission");
  });

  it("returns the writer's refusal code without revalidating", async () => {
    mockSetRate.mockRejectedValue(new SpgCommissionRateError("MONTH_CLOSED", "2026-09"));
    expect(await setSpgCommissionRate(VALID_INPUT)).toEqual({ ok: false, reason: "MONTH_CLOSED" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("returns UNEXPECTED for any other failure instead of throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mockSetRate.mockRejectedValue(new Error("connection lost"));
      expect(await setSpgCommissionRate(VALID_INPUT)).toEqual({ ok: false, reason: "UNEXPECTED" });
      expect(mockRevalidate).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("getSpgCommissionSettings", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockListRates.mockReset();
    mockListCategories.mockReset();
    mockUserFindMany.mockReset();
    mockAuth.mockResolvedValue(MANAGER);
    mockListCategories.mockResolvedValue([]);
    mockListRates.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses without spg_commission:manage", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["spg_sales:view"] } });
    await expect(getSpgCommissionSettings()).rejects.toThrow("Forbidden");
    expect(mockListRates).not.toHaveBeenCalled();
  });

  it("opens the current WIB month and the next eleven, across a year end", async () => {
    vi.setSystemTime(new Date("2026-11-30T17:30:00.000Z"));
    const settings = await getSpgCommissionSettings();
    expect(settings.currentMonth).toBe("2026-12");
    expect(settings.openMonths).toHaveLength(12);
    expect(settings.openMonths[0]).toBe("2026-12");
    expect(settings.openMonths[1]).toBe("2027-01");
    expect(settings.openMonths[11]).toBe("2027-11");
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it("keeps active categories and inactive ones with rates, with their history and creators", async () => {
    vi.setSystemTime(new Date("2026-10-21T03:00:00.000Z"));
    mockListCategories.mockResolvedValue([
      { id: "cat-a", code: "A", name: "Atasan", isActive: true },
      { id: "cat-b", code: null, name: "Bawahan", isActive: true },
      { id: "cat-old", code: "OLD", name: "Lama", isActive: false },
      { id: "cat-gone", code: "GONE", name: "Kosong", isActive: false },
    ]);
    const createdAt = new Date("2026-10-01T02:00:00.000Z");
    const updatedAt = new Date("2026-10-05T02:00:00.000Z");
    mockListRates.mockResolvedValue([
      { id: "r1", itemCategoryId: "cat-a", amountPerPiece: 2000, effectiveFrom: "2026-11", createdById: "u1", createdAt, updatedAt },
      { id: "r2", itemCategoryId: "cat-a", amountPerPiece: 1500, effectiveFrom: "2026-10", createdById: "u2", createdAt, updatedAt: createdAt },
      { id: "r3", itemCategoryId: "cat-old", amountPerPiece: 500, effectiveFrom: "2026-10", createdById: "u1", createdAt, updatedAt: createdAt },
    ]);
    mockUserFindMany.mockResolvedValue([{ id: "u1", name: "Rina" }]);

    const settings = await getSpgCommissionSettings();

    expect(settings.currentMonth).toBe("2026-10");
    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["u1", "u2"] } },
      select: { id: true, name: true },
    });
    expect(settings.categories.map((category) => category.id)).toEqual(["cat-a", "cat-b", "cat-old"]);
    expect(settings.categories[0].rates).toEqual([
      {
        id: "r1",
        itemCategoryId: "cat-a",
        effectiveFrom: "2026-11",
        amountPerPiece: 2000,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        createdByName: "Rina",
      },
      {
        id: "r2",
        itemCategoryId: "cat-a",
        effectiveFrom: "2026-10",
        amountPerPiece: 1500,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        createdByName: null,
      },
    ]);
    expect(settings.categories[1]).toEqual({ id: "cat-b", code: null, name: "Bawahan", isActive: true, rates: [] });
    expect(settings.categories[2].isActive).toBe(false);
  });
});
