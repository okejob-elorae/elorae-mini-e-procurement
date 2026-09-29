import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  ItemType: { FABRIC: "FABRIC", ACCESSORIES: "ACCESSORIES", FINISHED_GOOD: "FINISHED_GOOD" },
  prisma: { inventoryValue: { findMany: mockFindMany } },
}));

import { getInventoryValueSnapshot } from "./inventory";

describe("getInventoryValueSnapshot gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });

  it("rejects an unauthenticated caller and runs no query", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(getInventoryValueSnapshot()).rejects.toThrow("Forbidden");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects a caller with neither inventory:view nor dashboard:view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:view"] } });
    await expect(getInventoryValueSnapshot()).rejects.toThrow("Forbidden");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it.each([["inventory:view"], ["dashboard:view"], ["*"]])("lets a caller holding %s through", async (perm) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [perm] } });
    await getInventoryValueSnapshot();
    expect(mockFindMany).toHaveBeenCalled();
  });
});
