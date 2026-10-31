import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "decimal.js";

const {
  mockAuth,
  mockAggregate,
  mockFindUnique,
  mockWoFindUnique,
  mockItemFindMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockAggregate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockWoFindUnique: vi.fn(),
  mockItemFindMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  ConcurrentFirstReceiptError: class ConcurrentFirstReceiptError extends Error {},
  MainStockNegativeError: class MainStockNegativeError extends Error {},
  // `runSerializable` reads the isolation level when its module loads.
  Prisma: {
    TransactionIsolationLevel: { Serializable: "Serializable" },
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
  },
  moveMainStock: vi.fn(),
  recalcItemSellingPrice: vi.fn(),
  prisma: {
    workOrder: { findUnique: mockWoFindUnique },
    item: { findMany: mockItemFindMany },
    inventoryValue: { aggregate: mockAggregate, findUnique: mockFindUnique },
    $transaction: mockTransaction,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn() }));
vi.mock("@/lib/production/planning", () => ({ generateMaterialPlan: vi.fn() }));
vi.mock("@/lib/production/reconciliation", () => ({ reconcileWorkOrder: vi.fn() }));
vi.mock("@/lib/notifications/actor-name", () => ({
  getActorName: vi.fn(),
}));
vi.mock("@/lib/notifications/events", () => ({
  notifyWOCreated: vi.fn(),
  notifyWOStatusUpdated: vi.fn(),
  notifyWOMaterialsIssued: vi.fn(),
  notifyWOCompleted: vi.fn(),
}));
vi.mock("@/app/actions/settings/ppn", () => ({ getPpnRatePercent: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/production/fg-receipt-journal", () => ({ postFgReceiptJournal: vi.fn() }));
vi.mock("@/lib/production/fg-receipt-journal-aman", () => ({
  postFgReceiptJournalAman: vi.fn(async () => ({ ok: true })),
}));
// The receipt's cost basis (issued material, CMT steps, PPN settings) — zero here, so the closed-short
// test below exercises status handling only.
vi.mock("@/lib/production/biaya-penerimaan-queries", async () => {
  const { PPN_BAWAAN } = await import("@/lib/finance/pajak/ppn");
  return {
    bacaDasarBiayaPenerimaan: vi.fn(async () => ({
      totalBiayaBahan: 0,
      qtyRencana: 100,
      bahanSudahDibebankan: 0,
      sudahDiterima: 0,
      sudahLolos: 0,
      langkah: [],
      biayaTambahanPerPcs: null,
      pengaturanPpn: PPN_BAWAAN,
    })),
  };
});
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => ({})) }));
vi.mock("@/lib/item-requests/mutations", () => ({
  cancelOpenLinesForWo: vi.fn(async () => {}),
  getUncoveredShortages: vi.fn(async () => []),
  syncRequestForWo: vi.fn(async () => {}),
}));
vi.mock("@/lib/work-orders/queries", () => ({ listWorkOrders: vi.fn() }));
vi.mock("@/lib/leadtime/wo-snapshot", () => ({ resolveWoLeadTimeFields: vi.fn() }));
vi.mock("@/lib/leadtime/calculations", () => ({ computeActualLeadDays: vi.fn() }));
vi.mock("@/lib/leadtime/auto-confirm", () => ({ applyChainSignal: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

import {
  cancelWorkOrder,
  completeWorkOrder,
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
    // Accessories per piece come from the WO's own plan (#437), not the current BOM.
    mockWoFindUnique.mockResolvedValue({
      status: "IN_PRODUCTION",
      docNumber: "WO-1",
      consumptionPlan: JSON.stringify([
        { itemId: "m1", qtyRequired: 2, plannedQty: 200 },
        { itemId: "fab1", qtyRequired: 1.5, plannedQty: 150 },
      ]),
    });
    mockItemFindMany.mockResolvedValue([{ id: "m1", uomId: "u1", nameId: "Button" }]);
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

  it("uses the plan's per-piece average for a size-scoped accessory", async () => {
    mockWoFindUnique.mockResolvedValue({
      status: "IN_PRODUCTION",
      docNumber: "WO-1",
      consumptionPlan: [{ itemId: "m1", qtyRequired: 0.4, plannedQty: 40 }],
    });
    mockAggregate.mockResolvedValue({ _sum: { qtyOnHand: "50" } });
    const { lines } = await getAdditionalMaterialsPreview("wo1", 10);
    expect(mockItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["m1"] }, type: "ACCESSORIES" } })
    );
    expect(lines).toEqual([expect.objectContaining({ itemId: "m1", qtyNeeded: 4 })]);
  });

  /** The issue transaction: stock is checked there, from the rows it reads, not from a stale pre-check. */
  function issueTx(rows: Array<{ id: string; variantSku: string | null; qtyOnHand: string }>) {
    return {
      workOrder: {
        findUnique: vi.fn().mockResolvedValue({
          status: "IN_PRODUCTION",
          consumptionPlan: "[]",
          docNumber: "WO-1",
          poId: null,
          consumptionMaterialId: null,
          rollBreakdown: null,
        }),
        update: vi.fn(),
      },
      materialIssue: { create: vi.fn().mockResolvedValue({ id: "mi1", docNumber: "ISS-1" }), update: vi.fn() },
      item: { findUnique: vi.fn().mockResolvedValue({ nameId: "Button", defaultPpnIncluded: true }) },
      inventoryValue: {
        findMany: vi.fn().mockResolvedValue(rows.map((r) => ({ ...r, itemId: "m1", avgCost: "100" }))),
      },
    };
  }

  it("issue sums a null row (0) and a blank row (50) inside the transaction and draws from the blank row", async () => {
    const { moveMainStock } = await import("@elorae/db");
    vi.mocked(moveMainStock).mockRejectedValueOnce(new Error(STOP));
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(issueTx([
        { id: "iv-null", variantSku: null, qtyOnHand: "0" },
        { id: "iv-blank", variantSku: "", qtyOnHand: "50" },
      ]))
    );
    expect(await issueAdditionalMaterials("wo1", 10, "u1")).toEqual({ ok: false, code: "GAGAL" });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(moveMainStock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: "m1", qtyDelta: -20, inventoryValueId: "iv-blank" })
    );
  });

  it("issue refuses inside the transaction when the total on-hand is short", async () => {
    const { moveMainStock } = await import("@elorae/db");
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(issueTx([
        { id: "iv-null", variantSku: null, qtyOnHand: "0" },
        { id: "iv-blank", variantSku: "", qtyOnHand: "5" },
      ]))
    );
    expect(await issueAdditionalMaterials("wo1", 10, "u1")).toEqual({
      ok: false,
      code: "STOK_BAHAN_KURANG",
      barang: "Button",
    });
    expect(moveMainStock).not.toHaveBeenCalled();
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

describe("receiveFG refusals", () => {
  const input = { woId: "wo1", qtyReceived: 5, qtyRejected: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
  });

  it("returns a typed refusal for a stock-negative refusal instead of throwing", async () => {
    const { MainStockNegativeError } = await import("@elorae/db");
    mockTransaction.mockRejectedValue(new MainStockNegativeError("i1", -5, 2));
    expect(await receiveFG(input, "u1")).toEqual({ success: false, code: "MAIN_STOCK_NEGATIVE" });
  });

  it("returns a typed refusal for a missing work order", async () => {
    const { WorkOrderNotFoundError } = await import("@/lib/inventory/receipt-errors");
    mockTransaction.mockRejectedValue(new WorkOrderNotFoundError());
    expect(await receiveFG(input, "u1")).toEqual({ success: false, code: "WORK_ORDER_NOT_FOUND" });
  });

  it("still throws an unknown error", async () => {
    mockTransaction.mockRejectedValue(new Error("db exploded"));
    await expect(receiveFG(input, "u1")).rejects.toThrow("db exploded");
  });
});

describe("completeWorkOrder (close short)", () => {
  const txWoFindUnique = vi.fn();
  const txWoUpdateMany = vi.fn();
  const txQueryRaw = vi.fn();
  const partialWo = {
    docNumber: "WO-1",
    status: "PARTIAL",
    notes: "rush order",
    issuedAt: new Date("2026-10-01T00:00:00Z"),
    actualLeadDays: null,
    receipts: [{ id: "r1" }],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({ $queryRaw: txQueryRaw, workOrder: { findUnique: txWoFindUnique, updateMany: txWoUpdateMany } })
    );
    txWoFindUnique.mockResolvedValue(partialWo);
    txWoUpdateMany.mockResolvedValue({ count: 1 });
    const { getActorName } = await import("@/lib/notifications/actor-name");
    vi.mocked(getActorName).mockResolvedValue("Admin");
    const { computeActualLeadDays } = await import("@/lib/leadtime/calculations");
    vi.mocked(computeActualLeadDays).mockReturnValue(26);
  });

  it("completes a PARTIAL work order with receipts and keeps the reason in notes", async () => {
    await completeWorkOrder("wo1", "u1", "  CMT stopped sewing  ");
    expect(txQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(txWoFindUnique.mock.invocationCallOrder[0]);
    expect(txWoUpdateMany).toHaveBeenCalledWith({
      where: { id: "wo1", status: "PARTIAL" },
      data: expect.objectContaining({
        status: "COMPLETED",
        completedAt: expect.any(Date),
        actualLeadDays: 26,
        notes: expect.stringMatching(/^rush order\n\[Closed short \d{4}-\d{2}-\d{2}\] CMT stopped sewing$/),
      }),
    });
    const { logAudit } = await import("@/lib/audit");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "COMPLETE_SHORT", entityType: "WorkOrder", entityId: "wo1" })
    );
  });

  it("keeps an existing actualLeadDays", async () => {
    txWoFindUnique.mockResolvedValue({ ...partialWo, actualLeadDays: 12 });
    await completeWorkOrder("wo1", "u1", "done");
    expect(txWoUpdateMany.mock.calls[0][0].data).not.toHaveProperty("actualLeadDays");
  });

  it.each([
    ["IN_PRODUCTION", [{ id: "r1" }]],
    ["COMPLETED", [{ id: "r1" }]],
    ["PARTIAL", []],
  ])("refuses status %s with %j receipts", async (status, receipts) => {
    txWoFindUnique.mockResolvedValue({ ...partialWo, status, receipts });
    await expect(completeWorkOrder("wo1", "u1", "done")).rejects.toThrow(
      "Only a PARTIAL work order can be completed manually"
    );
    expect(txWoUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses when the status changed between the read and the write", async () => {
    txWoUpdateMany.mockResolvedValue({ count: 0 });
    await expect(completeWorkOrder("wo1", "u1", "done")).rejects.toThrow(
      "Work Order status changed, refresh and try again"
    );
  });

  it("refuses a blank reason before touching the database", async () => {
    await expect(completeWorkOrder("wo1", "u1", "   ")).rejects.toThrow();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refuses a claimed id that is not the session user", async () => {
    await expect(completeWorkOrder("wo1", "someone-else", "done")).rejects.toThrow(
      "Forbidden: actor does not match the session"
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("receiveFG on a work order closed short", () => {
  it("stays COMPLETED and keeps completedAt when a late receipt is still under plan", async () => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    const closedAt = new Date("2026-10-20T03:00:00Z");
    const woUpdate = vi.fn();
    const lockRow = vi.fn();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: lockRow,
        workOrder: {
          findUnique: vi.fn().mockResolvedValue({
            id: "wo1",
            status: "COMPLETED",
            completedAt: closedAt,
            actualQty: "80",
            plannedQty: "100",
            actualLeadDays: 19,
            issuedAt: new Date("2026-10-01T00:00:00Z"),
            finishedGoodId: "fg1",
            outputMode: "GENERIC",
            issues: [],
          }),
          update: woUpdate,
        },
        fGReceipt: { create: vi.fn().mockResolvedValue({ id: "rc1", docNumber: "RCPT-1", receivedAt: new Date() }) },
        workOrderStep: { findMany: vi.fn().mockResolvedValue([]) },
        rejectedGoodsLedger: { create: vi.fn() },
      })
    );
    const { notifyWOCompleted } = await import("@/lib/notifications/events");
    vi.mocked(notifyWOCompleted).mockResolvedValue(undefined as never);
    const { applyChainSignal } = await import("@/lib/leadtime/auto-confirm");
    vi.mocked(applyChainSignal).mockResolvedValue(undefined as never);

    // Every unit rejected: qtyAccepted 0 keeps costing and price recalculation out of the way.
    await receiveFG({ woId: "wo1", qtyReceived: 5, qtyRejected: 5 } as never, "u1");

    expect(woUpdate).toHaveBeenCalledWith({
      where: { id: "wo1" },
      data: expect.objectContaining({ status: "COMPLETED", completedAt: closedAt }),
    });
    // The row lock is the transaction's first statement, ahead of the doc-number read.
    const { generateDocNumber } = await import("@/lib/docNumber");
    expect(lockRow.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(generateDocNumber).mock.invocationCallOrder[0]);
  });
});

describe("issueWorkOrder stock guard", () => {
  const draftWo = { id: "wo1", docNumber: "WO-1", status: "DRAFT", vendorId: "v1", finishedGoodId: "fg1", plannedQty: "10", outputMode: "GENERIC", skuBreakdown: null };
  const planLine = (shortage: number) => ({ itemId: "m1", itemName: "Kain", uomId: "u1", uomCode: "MTR", shortage: new Decimal(shortage) });

  /** The issue transaction: the row lock, then the re-read the guards and the write work from. */
  function issueTx(wo: Record<string, unknown>) {
    return { $queryRaw: vi.fn(), workOrder: { findUnique: vi.fn().mockResolvedValue(wo), update: vi.fn() } };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockWoFindUnique.mockResolvedValue(draftWo);
  });

  it("refuses to issue while the BOM is short and never reaches the lead-time step", async () => {
    const { generateMaterialPlan } = await import("@/lib/production/planning");
    vi.mocked(generateMaterialPlan).mockResolvedValue([planLine(12.001)] as never);
    const tx = issueTx(draftWo);
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    await expect(issueWorkOrder("wo1", "u1")).rejects.toThrow("Stok belum cukup untuk issue: Kain (kurang 12.01 MTR)");
    await expect(issueWorkOrder("wo1", "u1")).rejects.toMatchObject({ code: "STOK_BELUM_CUKUP" });
    const { resolveWoLeadTimeFields } = await import("@/lib/leadtime/wo-snapshot");
    expect(resolveWoLeadTimeFields).not.toHaveBeenCalled();
    expect(tx.workOrder.update).not.toHaveBeenCalled();
  });

  it("gets past the guard once stock covers every line", async () => {
    const { generateMaterialPlan } = await import("@/lib/production/planning");
    vi.mocked(generateMaterialPlan).mockResolvedValue([planLine(0)] as never);
    const { resolveWoLeadTimeFields } = await import("@/lib/leadtime/wo-snapshot");
    vi.mocked(resolveWoLeadTimeFields).mockRejectedValue(new Error("STOP_AFTER_GUARD"));
    const tx = issueTx({ ...draftWo, vendorId: "v2" });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    await expect(issueWorkOrder("wo1", "u1")).rejects.toThrow("STOP_AFTER_GUARD");
    // Lead time comes from the row re-read under the lock.
    expect(resolveWoLeadTimeFields).toHaveBeenCalledWith(tx, "v2", 10);
  });

  it("checks stock under the row lock and flips status only from DRAFT", async () => {
    const { generateMaterialPlan } = await import("@/lib/production/planning");
    vi.mocked(generateMaterialPlan).mockResolvedValue([planLine(3)] as never);
    const { resolveWoLeadTimeFields } = await import("@/lib/leadtime/wo-snapshot");
    vi.mocked(resolveWoLeadTimeFields).mockResolvedValue({} as never);
    const tx = issueTx(draftWo);
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    await expect(issueWorkOrder("wo1", "u1")).rejects.toThrow("Stok belum cukup untuk issue: Kain (kurang 3.00 MTR)");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.workOrder.findUnique.mock.invocationCallOrder[0]);
    expect(tx.workOrder.update).not.toHaveBeenCalled();

    vi.mocked(generateMaterialPlan).mockResolvedValue([planLine(0)] as never);
    tx.workOrder.findUnique.mockResolvedValue({ ...draftWo, status: "ISSUED" });
    await expect(issueWorkOrder("wo1", "u1")).rejects.toMatchObject({ code: "WO_SUDAH_TERBIT" });
    tx.workOrder.findUnique.mockResolvedValue({ ...draftWo, status: "CANCELLED" });
    await expect(issueWorkOrder("wo1", "u1")).rejects.toMatchObject({ code: "WO_SUDAH_DIBATALKAN" });
    expect(tx.workOrder.update).not.toHaveBeenCalled();

    tx.workOrder.findUnique.mockResolvedValue(draftWo);
    const { getActorName } = await import("@/lib/notifications/actor-name");
    vi.mocked(getActorName).mockResolvedValue("Admin");
    await issueWorkOrder("wo1", "u1");
    expect(tx.workOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "wo1" }, data: expect.objectContaining({ status: "ISSUED" }) })
    );
  });
});
