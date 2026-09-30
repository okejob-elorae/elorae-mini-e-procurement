import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockFindFirst,
  mockFindUnique,
  mockWoFindUnique,
  mockRulesFindMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockWoFindUnique: vi.fn(),
  mockRulesFindMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  moveMainStock: vi.fn(),
  recalcItemSellingPrice: vi.fn(),
  prisma: {
    workOrder: { findUnique: mockWoFindUnique },
    consumptionRule: { findMany: mockRulesFindMany },
    inventoryValue: { findFirst: mockFindFirst, findUnique: mockFindUnique },
    $transaction: mockTransaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn() }));
vi.mock("@/lib/production/planning", () => ({ generateMaterialPlan: vi.fn() }));
vi.mock("@/lib/production/reconciliation", () => ({ reconcileWorkOrder: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(),
  notifyWOCreated: vi.fn(),
  notifyWOStatusUpdated: vi.fn(),
  notifyWOMaterialsIssued: vi.fn(),
  notifyWOCompleted: vi.fn(),
}));
vi.mock("@/app/actions/settings/ppn", () => ({ getPpnRatePercent: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/production/fg-receipt-journal", () => ({ postFgReceiptJournal: vi.fn() }));
vi.mock("@/lib/work-orders/queries", () => ({ listWorkOrders: vi.fn() }));
vi.mock("@/lib/leadtime/wo-snapshot", () => ({ resolveWoLeadTimeFields: vi.fn() }));
vi.mock("@/lib/leadtime/calculations", () => ({ computeActualLeadDays: vi.fn() }));
vi.mock("@/lib/leadtime/auto-confirm", () => ({ applyChainSignal: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import { getAdditionalMaterialsPreview, issueAdditionalMaterials } from "./production";

const STOP = "STOP_AT_ISSUE_TRANSACTION";

describe("additional materials on a null-spelled variantless accessory row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockWoFindUnique.mockResolvedValue({
      status: "IN_PRODUCTION",
      finishedGoodId: "fg1",
      docNumber: "WO-1",
    });
    mockRulesFindMany.mockResolvedValue([
      {
        materialId: "m1",
        qtyRequired: "2",
        material: { id: "m1", type: "ACCESSORIES", uomId: "u1", nameId: "Button" },
      },
    ]);
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockImplementation(async ({ where }: { where: { OR?: unknown[] } }) => {
      const tolerant = JSON.stringify(where.OR) === JSON.stringify([{ variantSku: null }, { variantSku: "" }]);
      return tolerant ? { id: "iv1", qtyOnHand: "50" } : null;
    });
    mockTransaction.mockRejectedValue(new Error(STOP));
  });

  it("preview reports the null row's on-hand qty as sufficient", async () => {
    const { lines } = await getAdditionalMaterialsPreview("wo1", 10);
    expect(lines).toEqual([
      expect.objectContaining({ itemId: "m1", qtyNeeded: 20, qtyOnHand: 50, sufficient: true }),
    ]);
  });

  it("issue passes the stock pre-check and reaches issueMaterials' transaction", async () => {
    await expect(issueAdditionalMaterials("wo1", 10, "u1")).rejects.toThrow(STOP);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("issue still refuses when the row's on-hand is short", async () => {
    mockFindFirst.mockResolvedValue({ id: "iv1", qtyOnHand: "5" });
    await expect(issueAdditionalMaterials("wo1", 10, "u1")).rejects.toThrow(
      "Insufficient stock for Button: need 20, have 5"
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
