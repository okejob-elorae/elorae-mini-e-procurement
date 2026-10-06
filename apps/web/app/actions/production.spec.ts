import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockAggregate,
  mockFindUnique,
  mockWoFindUnique,
  mockRulesFindMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockAggregate: vi.fn(),
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
    inventoryValue: { aggregate: mockAggregate, findUnique: mockFindUnique },
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

import {
  cancelWorkOrder,
  createWorkOrder,
  getAdditionalMaterialsPreview,
  issueAdditionalMaterials,
  issueMaterials,
  issueWorkOrder,
  receiveFG,
} from "./production";

const STOP = "STOP_AT_ISSUE_TRANSACTION";

describe("additional materials on an accessory whose stock is split across variantless rows", () => {
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
    mockAggregate.mockImplementation(async ({ where }: { where: { itemId: string } }) => ({
      _sum: { qtyOnHand: where.itemId === "m1" ? "50" : null },
    }));
    mockTransaction.mockRejectedValue(new Error(STOP));
  });

  it("preview sums a null row and a blank row into the item's total on-hand", async () => {
    mockAggregate.mockResolvedValue({ _sum: { qtyOnHand: "50" } });
    const { lines } = await getAdditionalMaterialsPreview("wo1", 10);
    expect(mockAggregate).toHaveBeenCalledWith({
      where: { itemId: "m1" },
      _sum: { qtyOnHand: true },
    });
    expect(lines).toEqual([
      expect.objectContaining({ itemId: "m1", qtyNeeded: 20, qtyOnHand: 50, sufficient: true }),
    ]);
  });

  it("issue passes the pre-check on a null row (0) plus a blank row (50) and reaches the transaction", async () => {
    mockAggregate.mockResolvedValue({ _sum: { qtyOnHand: "50" } });
    await expect(issueAdditionalMaterials("wo1", 10, "u1")).rejects.toThrow(STOP);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("issue still refuses when the total on-hand is short", async () => {
    mockAggregate.mockResolvedValue({ _sum: { qtyOnHand: "5" } });
    await expect(issueAdditionalMaterials("wo1", 10, "u1")).rejects.toThrow(
      "Insufficient stock for Button: need 20, have 5"
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("production actor trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
  });

  it.each([
    ["createWorkOrder", () => createWorkOrder({} as never, "someone-else")],
    ["issueWorkOrder", () => issueWorkOrder("wo1", "someone-else")],
    ["issueMaterials", () => issueMaterials({} as never, "someone-else")],
    ["issueAdditionalMaterials", () => issueAdditionalMaterials("wo1", 10, "someone-else")],
    ["receiveFG", () => receiveFG({} as never, "someone-else")],
    ["cancelWorkOrder", () => cancelWorkOrder("wo1", "someone-else")],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s refuses a claimed id that is not the session user and writes nothing",
    async (_name, call) => {
      await expect(call()).rejects.toThrow("Forbidden: actor does not match the session");
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockWoFindUnique).not.toHaveBeenCalled();
    }
  );
});
