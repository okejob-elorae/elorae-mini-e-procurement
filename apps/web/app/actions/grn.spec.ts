import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindMany, mockFindUnique, mockCount } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => {
  const model = { findMany: mockFindMany, findUnique: mockFindUnique, count: mockCount };
  return {
    prisma: { gRN: model, fabricRoll: model, item: model, journal: model },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/inventory/costing", () => ({
  calculateMovingAverage: vi.fn(),
  reverseMovingAverage: vi.fn(),
  findExistingInventoryValueRow: vi.fn(),
}));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(),
  notifyGRNCreated: vi.fn(),
  notifyMaterialArrivedForPo: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/items/validate-variant-lines", () => ({
  assertLinesVariantSkusMatchItemDefinitions: vi.fn(),
}));
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(),
  postGrnReversalJournal: vi.fn(),
}));
vi.mock("@/lib/leadtime/calculations", () => ({ computeActualLeadDays: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import {
  getFabricRollFilterOptions,
  getFabricRolls,
  getGRNById,
  getGRNs,
  getGrnJournalState,
  getRollsByGrnId,
} from "./grn";

const inventoryOnlyReads: Array<[string, () => Promise<unknown>]> = [
  ["getGRNById", () => getGRNById("g1")],
  ["getRollsByGrnId", () => getRollsByGrnId("g1")],
  ["getFabricRollFilterOptions", () => getFabricRollFilterOptions()],
  ["getFabricRolls", () => getFabricRolls()],
  ["getGrnJournalState", () => getGrnJournalState("g1")],
];

function assertNoQueryRan() {
  expect(mockFindMany).not.toHaveBeenCalled();
  expect(mockFindUnique).not.toHaveBeenCalled();
  expect(mockCount).not.toHaveBeenCalled();
}

describe("grn read actions gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockFindUnique.mockResolvedValue(null);
    mockCount.mockResolvedValue(0);
  });

  describe.each([
    ["getGRNs", () => getGRNs()] as [string, () => Promise<unknown>],
    ...inventoryOnlyReads,
  ])("%s", (_name, call) => {
    it("rejects an unauthenticated caller and runs no query", async () => {
      mockAuth.mockResolvedValue(null);
      await expect(call()).rejects.toThrow("Forbidden");
      assertNoQueryRan();
    });

    it("rejects a caller without a granting permission and runs no query", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["stores:view"] } });
      await expect(call()).rejects.toThrow("Forbidden");
      assertNoQueryRan();
    });

    it("lets a caller with inventory:view through", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
      await expect(call()).resolves.toBeDefined();
    });

    it("lets an admin wildcard caller through", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      await expect(call()).resolves.toBeDefined();
    });
  });

  it("getGRNs also admits vendor_returns:view, which the vendor-return pages call it under", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["vendor_returns:view"] } });
    await expect(getGRNs()).resolves.toBeDefined();
  });

  it.each(inventoryOnlyReads)("%s does not admit vendor_returns:view alone", async (_name, call) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["vendor_returns:view"] } });
    await expect(call()).rejects.toThrow("Forbidden");
    assertNoQueryRan();
  });
});
