import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany, mockFindFirst, mockFindUnique, mockGroupBy } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockGroupBy: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
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
