import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  Prisma: {},
  moveMainStock: vi.fn(),
  prisma: { inventoryValue: { findMany: mockFindMany } },
}));

import { getInventorySnapshot } from "./costing";

describe("getInventorySnapshot inventory:view gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });

  it("rejects an unauthenticated caller and runs no query", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(getInventorySnapshot()).rejects.toThrow("Forbidden");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects a caller without inventory:view and runs no query", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:view"] } });
    await expect(getInventorySnapshot()).rejects.toThrow("Forbidden");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("lets a caller with inventory:view through to the query", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
    await getInventorySnapshot();
    expect(mockFindMany).toHaveBeenCalled();
  });

  it("lets an admin wildcard caller through to the query", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    await getInventorySnapshot();
    expect(mockFindMany).toHaveBeenCalled();
  });
});
