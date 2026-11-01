import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany, mockFindFirst, mockFindUnique, mockGroupBy, mockItemDecimals } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockGroupBy: vi.fn(),
  mockItemDecimals: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/items/queries", () => ({ itemDecimalsToNumbers: mockItemDecimals }));
vi.mock("@elorae/db", () => {
  const model = {
    findMany: mockFindMany,
    findFirst: mockFindFirst,
    findUnique: mockFindUnique,
    groupBy: mockGroupBy,
  };
  return {
    ItemType: { FABRIC: "FABRIC", ACCESSORIES: "ACCESSORIES", FINISHED_GOOD: "FINISHED_GOOD" },
    prisma: {
      stockLedgerEntry: model,
      item: model,
      itemCategory: model,
      inventoryValue: model,
      stockMovement: model,
    },
  };
});

import {
  getCurrentStockSummary,
  getItemVariantOptions,
  getStockCard,
  getStockCardByCategory,
  getStockCardByType,
} from "./stock-card";

const range = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-31T00:00:00Z") };

const exportsUnderTest: Array<[string, () => Promise<unknown>]> = [
  ["getStockCard", () => getStockCard("item-1", range)],
  ["getItemVariantOptions", () => getItemVariantOptions("item-1")],
  ["getCurrentStockSummary", () => getCurrentStockSummary()],
  ["getStockCardByType", () => getStockCardByType("raw", range)],
  ["getStockCardByCategory", () => getStockCardByCategory("cat-1", range)],
];

function assertNoQueryRan() {
  expect(mockFindMany).not.toHaveBeenCalled();
  expect(mockFindFirst).not.toHaveBeenCalled();
  expect(mockFindUnique).not.toHaveBeenCalled();
  expect(mockGroupBy).not.toHaveBeenCalled();
}

describe("stock-card actions inventory:view gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue(null);
    mockGroupBy.mockResolvedValue([]);
    mockItemDecimals.mockReturnValue({});
  });

  describe.each(exportsUnderTest)("%s", (_name, call) => {
    it("rejects an unauthenticated caller and runs no query", async () => {
      mockAuth.mockResolvedValue(null);
      await expect(call()).rejects.toThrow("FORBIDDEN");
      assertNoQueryRan();
    });

    it("rejects a caller without inventory:view and runs no query", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:view"] } });
      await expect(call()).rejects.toThrow("FORBIDDEN");
      assertNoQueryRan();
    });

    it("lets a caller with inventory:view through to the query", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
      await expect(call()).resolves.toBeDefined();
    });

    it("lets an admin wildcard caller through to the query", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      await expect(call()).resolves.toBeDefined();
    });
  });
});

type LedgerRow = {
  id: string;
  itemId: string;
  variantSku: string;
  qty: number;
  balanceQty: number;
  balanceValue: number | null;
  createdAt: Date;
};

function row(id: string, variantSku: string, qty: number, balanceQty: number, balanceValue: number | null, day: number): LedgerRow {
  return {
    id,
    itemId: "item-1",
    variantSku,
    qty,
    balanceQty,
    balanceValue,
    createdAt: new Date(Date.UTC(2026, 0, day)),
  };
}

/* Last row of each size before the range, newest first - what `distinct: ["variantSku"]`
   hands back. S holds 10, M holds 5: the item opens at 15. */
const openingRows = [row("o-m", "M", 5, 5, 50, -2), row("o-s", "S", 10, 10, 100, -3)];
/* M sells 2 (M → 3), then S receives 4 (S → 14): the item runs 13, then 17. */
const rowsInRange = [row("r-1", "M", -2, 3, 30, 5), row("r-2", "S", 4, 14, 140, 9)];

function routeLedger(opening: LedgerRow[], inRange: LedgerRow[]) {
  mockFindMany.mockImplementation(async (args: { where?: { createdAt?: { lt?: Date; gte?: Date }; type?: unknown } }) => {
    if (args.where?.type) return [{ id: "item-1", sku: "SKU-1", nameId: "Kaos" }];
    if (args.where?.createdAt?.lt) return opening;
    if (args.where?.createdAt?.gte) return inRange;
    return [];
  });
}

describe("stock card balance with no variant picked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
    mockFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue({ id: "item-1", sku: "SKU-1", nameId: "Kaos" });
    mockGroupBy.mockResolvedValue([]);
    mockItemDecimals.mockReturnValue({});
  });

  it("opens, runs and closes on the item's total across every variant", async () => {
    routeLedger(openingRows, rowsInRange);
    const card = await getStockCard("item-1", range);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ["variantSku"], where: expect.objectContaining({ itemId: "item-1", locationType: "MAIN" }) })
    );
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(card.openingBalance).toBe(15);
    expect(card.openingValue).toBe(150);
    expect(card.movements.map((m) => m.balance)).toEqual([13, 17]);
    expect(card.movements.map((m) => m.balanceValue)).toEqual([130, 170]);
    expect(card.closingBalance).toBe(17);
    expect(card.closingValue).toBe(170);
  });

  it("keeps the item's value unrecorded while any variant's value is unrecorded", async () => {
    routeLedger([row("o-m", "M", 5, 5, null, -2), row("o-s", "S", 10, 10, 100, -3)], [row("r-2", "S", 4, 14, 140, 9)]);
    const card = await getStockCard("item-1", range);

    expect(card.openingBalance).toBe(15);
    expect(card.openingValue).toBeNull();
    expect(card.movements[0].balance).toBe(19);
    expect(card.movements[0].balanceValue).toBeNull();
    expect(card.closingValue).toBeNull();
  });

  it("opens at a genuine zero when no variant has history before the range", async () => {
    routeLedger([], [row("r-1", "M", 3, 3, 30, 5)]);
    const card = await getStockCard("item-1", range);

    expect(card.openingBalance).toBe(0);
    expect(card.openingValue).toBe(0);
    expect(card.closingBalance).toBe(3);
    expect(card.closingValue).toBe(30);
  });

  it("reads one variant's own balance when a variant is picked", async () => {
    mockFindFirst.mockResolvedValue(row("o-s", "S", 10, 10, 100, -3));
    routeLedger([], [row("r-2", "S", 4, 14, 140, 9)]);
    const card = await getStockCard("item-1", range, "S");

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variantSku: "S" }) })
    );
    expect(card.openingBalance).toBe(10);
    expect(card.movements[0].balance).toBe(14);
    expect(card.closingBalance).toBe(14);
    expect(card.closingValue).toBe(140);
  });

  it("sums variants the same way on the by-type card", async () => {
    /* The by-type read is not distinct: it gets every older row and keeps the newest per
       variant, so an older S row must not overwrite S's latest. */
    routeLedger([...openingRows, row("o-s-old", "S", 6, 6, 60, -9)], rowsInRange);
    const { items } = await getStockCardByType("finished", range);

    expect(items).toHaveLength(1);
    expect(items[0].openingBalance).toBe(15);
    expect(items[0].openingValue).toBe(150);
    expect(items[0].movements.map((m) => m.balance)).toEqual([13, 17]);
    expect(items[0].closingBalance).toBe(17);
    expect(items[0].closingValue).toBe(170);
  });

  it("converts every Decimal item column through the shared item serializer", async () => {
    routeLedger([], []);
    mockItemDecimals.mockReturnValue({ commissionPerPcs: 2500, kgPerRoll: null });
    const card = await getStockCard("item-1", range);

    expect(mockItemDecimals).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
    expect(card.item).toEqual(expect.objectContaining({ sku: "SKU-1", commissionPerPcs: 2500, kgPerRoll: null }));
  });
});
