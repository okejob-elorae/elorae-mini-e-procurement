import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockFindMany,
  mockFindUnique,
  mockCount,
  mockUserFindUnique,
  mockTransaction,
  mockRecompute,
} = vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockTransaction: vi.fn(),
    mockFindMany: vi.fn(),
    mockFindUnique: vi.fn(),
    mockCount: vi.fn(),
    mockRecompute: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => {
  const model = { findMany: mockFindMany, findUnique: mockFindUnique, count: mockCount };
  class ConcurrentFirstReceiptError extends Error {}
  class MainStockNegativeError extends Error {}
  return {
    ConcurrentFirstReceiptError,
    MainStockNegativeError,
    prisma: {
      gRN: model,
      fabricRoll: model,
      item: model,
      journal: model,
      user: { findUnique: mockUserFindUnique },
      $transaction: mockTransaction,
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/inventory/costing", () => ({
  calculateMovingAverage: vi.fn(),
  reverseMovingAverage: vi.fn(),
  findExistingInventoryValueRow: vi.fn(),
}));
vi.mock("@/lib/notifications/actor-name", () => ({
  getActorName: vi.fn(),
}));
vi.mock("@/lib/notifications/events", () => ({
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
vi.mock("@/lib/purchase-orders/payment-due", () => ({ recomputePaymentDueDate: mockRecompute }));

import {
  approveGRNByOwner,
  createGRN,
  declineGRNByOwner,
  getFabricRollFilterOptions,
  getFabricRolls,
  getGRNById,
  getGRNs,
  getGrnJournalState,
  getRollsByGrnId,
} from "./grn";
import { calculateMovingAverage, findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { getActorName } from "@/lib/notifications/actor-name";
import { notifyMaterialArrivedForPo } from "@/lib/notifications/events";
import { logAudit } from "@/lib/audit";
import { postGrnJournal, postGrnReversalJournal } from "@/lib/inventory/grn-journal";

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

  describe("getGRNs search", () => {
    const expectedOr = [
      { docNumber: { contains: "po-12" } },
      { supplier: { name: { contains: "po-12" } } },
      { po: { docNumber: { contains: "po-12" } } },
    ];

    beforeEach(() => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
    });

    it("passes the same trimmed contains OR to findMany and count", async () => {
      await getGRNs({ search: "  po-12 " }, { page: 1, pageSize: 10 });
      const findWhere = mockFindMany.mock.calls[0][0].where;
      const countWhere = mockCount.mock.calls[0][0].where;
      expect(findWhere.OR).toEqual(expectedOr);
      expect(countWhere).toBe(findWhere);
    });

    it("adds no OR for a blank or whitespace-only search", async () => {
      await getGRNs({ search: "   " }, { page: 1, pageSize: 10 });
      await getGRNs({ search: "" }, { page: 1, pageSize: 10 });
      for (const call of mockFindMany.mock.calls) expect(call[0].where.OR).toBeUndefined();
      for (const call of mockCount.mock.calls) expect(call[0].where.OR).toBeUndefined();
    });
  });

  it.each(inventoryOnlyReads)("%s does not admit vendor_returns:view alone", async (_name, call) => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["vendor_returns:view"] } });
    await expect(call()).rejects.toThrow("Forbidden");
    assertNoQueryRan();
  });
});

describe("grn actor trust", () => {
  const FORBIDDEN = "Forbidden: actor does not match the session";

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
  });

  it.each([
    ["createGRN", () => createGRN({} as never, "someone-else")],
    ["approveGRNByOwner", () => approveGRNByOwner("g1", "someone-else")],
    ["declineGRNByOwner", () => declineGRNByOwner("g1", "someone-else")],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s refuses a claimed id that is not the session user and writes nothing",
    async (_name, call) => {
      await expect(call()).rejects.toThrow(FORBIDDEN);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockUserFindUnique).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["approveGRNByOwner", () => approveGRNByOwner("g1", "admin-1")],
    ["declineGRNByOwner", () => declineGRNByOwner("g1", "admin-1")],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s refuses an admin's id claimed by a non-admin session before the role lookup",
    async (_name, call) => {
      mockUserFindUnique.mockResolvedValue({ role: "ADMIN" });
      await expect(call()).rejects.toThrow(FORBIDDEN);
      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["approveGRNByOwner", () => approveGRNByOwner("g1", "u1"), "Only owner/admin can approve over-receive GRN"],
    ["declineGRNByOwner", () => declineGRNByOwner("g1", "u1"), "Only owner/admin can decline over-receive GRN"],
  ] as Array<[string, () => Promise<unknown>, string]>)(
    "%s runs the role check on the session user",
    async (_name, call, message) => {
      mockUserFindUnique.mockResolvedValue({ role: "WAREHOUSE" });
      await expect(call()).rejects.toThrow(message);
      expect(mockUserFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
      expect(mockTransaction).not.toHaveBeenCalled();
    }
  );
});

describe("payment due date wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockRecompute.mockResolvedValue(undefined);
    vi.mocked(getActorName).mockResolvedValue("Tester");
    vi.mocked(notifyMaterialArrivedForPo).mockResolvedValue(undefined as never);
    vi.mocked(logAudit).mockResolvedValue(undefined as never);
    vi.mocked(postGrnJournal).mockResolvedValue({ ok: true } as never);
    vi.mocked(postGrnReversalJournal).mockResolvedValue({ ok: true } as never);
  });

  it("declineGRNByOwner recomputes after the GRN is stamped as declined", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "ADMIN" });
    vi.mocked(findExistingInventoryValueRow).mockResolvedValue({ qtyOnHand: 10 } as never);
    const tx = {
      gRN: {
        findUnique: vi.fn().mockResolvedValue({
          id: "g1",
          poId: "po1",
          docNumber: "GRN/1",
          requiresOwnerApproval: true,
          ownerApprovedAt: null,
          ownerDeclinedAt: null,
          items: JSON.stringify([{ itemId: "i1", qty: 1, unitCost: 1, variantSku: null }]),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      fabricRoll: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      pOItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "pi1", receivedQty: 5 }),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ qty: 5, receivedQty: 4 }]),
      },
      purchaseOrder: { update: vi.fn().mockResolvedValue({}) },
      pOStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      vendorBillLine: { count: vi.fn().mockResolvedValue(0) },
    };
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));

    await declineGRNByOwner("g1", "u1");

    expect(mockRecompute).toHaveBeenCalledTimes(1);
    expect(mockRecompute).toHaveBeenCalledWith(tx, "po1");
    expect(tx.gRN.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerDeclinedAt: expect.any(Date) }),
      })
    );
    expect(tx.gRN.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockRecompute.mock.invocationCallOrder[0]
    );

    // A live vendor bill on the PO blocks the decline before any stock is reversed.
    tx.vendorBillLine.count.mockResolvedValue(1);
    vi.mocked(tx.gRN.update).mockClear();
    await expect(declineGRNByOwner("g1", "u1")).rejects.toThrow("already billed through Vendor Billing");
    expect(tx.gRN.update).not.toHaveBeenCalled();
  });

  describe("createGRN", () => {
    it("returns a typed refusal for a known receipt refusal instead of throwing", async () => {
      const { ConcurrentFirstReceiptError } = await import("@elorae/db");
      mockTransaction.mockRejectedValue(new ConcurrentFirstReceiptError("i1", null));
      expect(await createGRN({ supplierId: "s1", items: [{ itemId: "i1", qty: 5, unitCost: 1 }] } as never, "u1")).toEqual({
        success: false,
        code: "CONCURRENT_FIRST_RECEIPT",
      });
    });

    it("returns a typed refusal for an unknown item line", async () => {
      const { ReceiptLineError } = await import("@/lib/inventory/receipt-errors");
      mockTransaction.mockRejectedValue(new ReceiptLineError("ITEM_NOT_FOUND", "i9", "Item not found: i9"));
      expect(await createGRN({ supplierId: "s1", items: [{ itemId: "i9", qty: 5, unitCost: 1 }] } as never, "u1")).toEqual({
        success: false,
        code: "ITEM_NOT_FOUND",
        detail: "i9",
      });
    });

    it("still throws an unknown error", async () => {
      mockTransaction.mockRejectedValue(new Error("db exploded"));
      await expect(
        createGRN({ supplierId: "s1", items: [{ itemId: "i1", qty: 5, unitCost: 1 }] } as never, "u1")
      ).rejects.toThrow("db exploded");
    });

    function buildTx() {
      return {
        gRN: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({
            id: "g1",
            docNumber: "GRN/1",
            poId: "po1",
            supplierId: "s1",
            receivedBy: "u1",
            totalAmount: 5,
            photoUrls: null,
            notes: null,
            grnDate: new Date(),
            createdAt: new Date(),
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        item: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ type: "RAW", uomId: "u", overReceiveThreshold: null }),
        },
        pOItem: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ itemId: "i1", variantSku: null, qty: 5, receivedQty: 0 }]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        fabricRoll: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
        purchaseOrder: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: "po1", createdAt: new Date(), actualLeadDays: 3 }),
          update: vi.fn().mockResolvedValue({}),
        },
        pOStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      };
    }

    beforeEach(() => {
      vi.mocked(calculateMovingAverage).mockResolvedValue({
        previousAvgCost: new Decimal(0),
        newAvgCost: new Decimal(1),
        previousQty: new Decimal(0),
        newQty: new Decimal(5),
      } as never);
    });

    it("recomputes the PO due date inside the transaction when the GRN has a poId", async () => {
      const tx = buildTx();
      mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));

      await createGRN(
        { poId: "po1", supplierId: "s1", items: [{ itemId: "i1", qty: 5, unitCost: 1 }] } as never,
        "u1"
      );

      expect(mockRecompute).toHaveBeenCalledTimes(1);
      expect(mockRecompute).toHaveBeenCalledWith(tx, "po1");
    });

    it("does not recompute for a GRN without a poId", async () => {
      const tx = buildTx();
      tx.gRN.create.mockResolvedValue({
        id: "g1",
        docNumber: "GRN/1",
        poId: null,
        supplierId: "s1",
        receivedBy: "u1",
        totalAmount: 5,
        photoUrls: null,
        notes: null,
        grnDate: new Date(),
        createdAt: new Date(),
      });
      mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));

      const result = await createGRN(
        { supplierId: "s1", items: [{ itemId: "i1", qty: 5, unitCost: 1 }] } as never,
        "u1"
      );

      expect(result.success).toBe(true);
      expect(mockRecompute).not.toHaveBeenCalled();
    });
  });
});
