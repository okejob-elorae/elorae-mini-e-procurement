import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany, mockFindUnique, mockFindRow } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindRow: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  moveMainStock: vi.fn(),
  prisma: { inventoryValue: { findMany: mockFindMany, findUnique: mockFindUnique } },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/inventory/costing", () => ({ findExistingInventoryValueRow: mockFindRow }));
vi.mock("@/app/actions/security/pin-auth", () => ({ verifyPinForAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(),
  notifyStockAdjustmentCreated: vi.fn(),
}));

import { getInventorySnapshot, getInventoryValue } from "./inventory";

/* Each read's own pass-through footprint: [findMany, findRow, findUnique] call counts. */
const reads: Array<[string, () => Promise<unknown>, [number, number, number]]> = [
  ["getInventorySnapshot", () => getInventorySnapshot(), [1, 0, 0]],
  ["getInventoryValue", () => getInventoryValue("i1", null), [0, 1, 1]],
];

function assertQueriesRan([many, row, unique]: [number, number, number]) {
  expect(mockFindMany).toHaveBeenCalledTimes(many);
  expect(mockFindRow).toHaveBeenCalledTimes(row);
  expect(mockFindUnique).toHaveBeenCalledTimes(unique);
}

function assertNoQueryRan() {
  expect(mockFindMany).not.toHaveBeenCalled();
  expect(mockFindUnique).not.toHaveBeenCalled();
  expect(mockFindRow).not.toHaveBeenCalled();
}

describe("inventory:view gate on the inventory landing and adjustment reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockFindUnique.mockResolvedValue(null);
    mockFindRow.mockResolvedValue({ id: "iv1" });
  });

  it.each(reads)("%s rejects an unauthenticated caller and runs no query", async (_name, call) => {
    mockAuth.mockResolvedValue(null);
    await expect(call()).rejects.toThrow("Forbidden");
    assertNoQueryRan();
  });

  it.each(reads)("%s rejects a caller without inventory:view and runs no query", async (_name, call) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["dashboard:view"] } });
    await expect(call()).rejects.toThrow("Forbidden");
    assertNoQueryRan();
  });

  it.each(reads)("%s lets a caller with inventory:view through", async (_name, call, footprint) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
    await call();
    assertQueriesRan(footprint);
  });

  it.each(reads)("%s lets an admin wildcard caller through", async (_name, call, footprint) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    await call();
    assertQueriesRan(footprint);
  });
});

describe("getInventoryValue row resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
  });

  it("resolves the row through the null-tolerant helper, then reads it by id", async () => {
    mockFindRow.mockResolvedValue({ id: "iv1" });
    mockFindUnique.mockResolvedValue({
      id: "iv1",
      qtyOnHand: "5",
      avgCost: "2",
      totalValue: "10",
    });
    const result = await getInventoryValue("i1", null);
    expect(mockFindRow).toHaveBeenCalledTimes(1);
    expect(mockFindRow.mock.calls[0].slice(1)).toEqual(["i1", null]);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockFindUnique.mock.calls[0][0].where).toEqual({ id: "iv1" });
    expect(result).toMatchObject({ qtyOnHand: 5, avgCost: 2, totalValue: 10 });
  });

  it("returns null and runs no second query when the helper finds no row", async () => {
    mockFindRow.mockResolvedValue(null);
    await expect(getInventoryValue("i1", null)).resolves.toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
