import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany, mockFindUnique } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  moveMainStock: vi.fn(),
  prisma: { inventoryValue: { findMany: mockFindMany, findUnique: mockFindUnique } },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/inventory/costing", () => ({ findExistingInventoryValueRow: vi.fn() }));
vi.mock("@/app/actions/security/pin-auth", () => ({ verifyPinForAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(),
  notifyStockAdjustmentCreated: vi.fn(),
}));

import { getInventorySnapshot, getInventoryValue } from "./inventory";

const reads: Array<[string, () => Promise<unknown>]> = [
  ["getInventorySnapshot", () => getInventorySnapshot()],
  ["getInventoryValue", () => getInventoryValue("i1", null)],
];

function assertNoQueryRan() {
  expect(mockFindMany).not.toHaveBeenCalled();
  expect(mockFindUnique).not.toHaveBeenCalled();
}

describe("inventory:view gate on the inventory landing and adjustment reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockFindUnique.mockResolvedValue(null);
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

  it.each(reads)("%s lets a caller with inventory:view through", async (_name, call) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
    await call();
    expect(mockFindMany.mock.calls.length + mockFindUnique.mock.calls.length).toBe(1);
  });

  it.each(reads)("%s lets an admin wildcard caller through", async (_name, call) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    await call();
    expect(mockFindMany.mock.calls.length + mockFindUnique.mock.calls.length).toBe(1);
  });
});
