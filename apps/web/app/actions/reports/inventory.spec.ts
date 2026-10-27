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

import { exportInventorySnapshotReport, getCOGSRawVsFinished, getInventoryValueSnapshot } from "./inventory";

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

describe("getCOGSRawVsFinished gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
  });

  it("rejects an unauthenticated caller and runs no query", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(getCOGSRawVsFinished()).rejects.toThrow("Forbidden");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects a caller with neither inventory:view nor dashboard:view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:view"] } });
    await expect(getCOGSRawVsFinished()).rejects.toThrow("Forbidden");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it.each([["inventory:view"], ["dashboard:view"], ["*"]])("lets a caller holding %s through", async (perm) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [perm] } });
    await getCOGSRawVsFinished();
    expect(mockFindMany).toHaveBeenCalled();
  });
});

describe("exportInventorySnapshotReport csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
  });

  it("writes a BOM and neutralises a formula-shaped item name, keeping the header order", async () => {
    mockFindMany.mockResolvedValue([
      {
        itemId: "i1",
        qtyOnHand: 4,
        totalValue: 40,
        item: { id: "i1", sku: "S1", nameId: "=cmd", nameEn: "", type: "FABRIC", reorderPoint: null, uom: { code: "PCS" } },
      },
    ]);
    const res = await exportInventorySnapshotReport("csv");
    const data = "data" in res ? res.data : "";
    expect(data.startsWith("﻿SKU,Name,Type,UOM,Qty On Hand,Avg Cost,Total Value,% of Total\n")).toBe(true);
    expect(data).toContain(`"S1","'=cmd","FABRIC","PCS","4","10","40","100"`);
  });

  it("keeps the header row when there is nothing to export", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await exportInventorySnapshotReport("csv");
    expect("data" in res && res.data).toBe("﻿SKU,Name,Type,UOM,Qty On Hand,Avg Cost,Total Value,% of Total\n");
  });
});
