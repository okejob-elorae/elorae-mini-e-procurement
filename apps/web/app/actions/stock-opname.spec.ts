import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindOpname, mockCreateNotification, mockPostOpnameJournal, mockFanOut, tx } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindOpname: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockPostOpnameJournal: vi.fn(),
  mockFanOut: vi.fn(),
  tx: { stockOpname: { update: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  prisma: {
    stockOpname: { findUnique: mockFindOpname },
    adminNotification: { create: mockCreateNotification },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn() }));
vi.mock("@/lib/inventory/opname-approve", () => ({
  applyFabricAdjustments: vi.fn(),
  applyFgAccessoriesAdjustments: vi.fn(async () => ({ adjustmentCount: 1, pushItemIds: [] })),
  detectItemDrift: vi.fn(async () => []),
  detectRollDrift: vi.fn(async () => []),
  pushFgStockAfterOpname: vi.fn(),
}));
vi.mock("@/lib/inventory/opname-snapshot", () => ({
  freezeFabricRollSnapshot: vi.fn(),
  freezeItemSnapshot: vi.fn(),
}));
vi.mock("@/lib/inventory/opname-journal", () => ({
  postOpnameJournal: mockPostOpnameJournal,
  probeOpnameNetDelta: vi.fn(),
}));
vi.mock("@/lib/serialize-for-client", () => ({ serializeForClient: (v: unknown) => v }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: mockFanOut }));

import { approveOpname, postOpnameJournalAction } from "./stock-opname";

const OPNAME = {
  id: "op1",
  docNumber: "OPN/2026/0001",
  status: "SUBMITTED",
  scope: "FINISHED_GOOD",
  submittedById: "u2",
};

describe("approveOpname auto-post journal failures", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockFindOpname.mockResolvedValue(OPNAME);
    mockCreateNotification.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "n1", ...(data as object) }));
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("raises JOURNAL_PENDING when the auto-post throws, and still approves", async () => {
    mockPostOpnameJournal.mockRejectedValue(new Error("Opname op1 has a ledger entry with unknown totalCost"));

    const res = await approveOpname("op1", true);

    expect(res).toEqual({ success: true });
    expect(tx.stockOpname.update).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const { data } = mockCreateNotification.mock.calls[0][0];
    expect(data.category).toBe("JOURNAL_PENDING");
    expect(data.title).toBe("Opname OPN/2026/0001: journal not posted");
    expect(data.message).toContain("unknown totalCost");
    expect(data.metadata).toEqual({ opnameId: "op1", reason: "ERROR", role: null });
    expect(mockFanOut).toHaveBeenCalledTimes(1);
  });

  it("raises JOURNAL_PENDING for a returned refusal, keeping its code and role", async () => {
    mockPostOpnameJournal.mockResolvedValue({ ok: false, code: "UNMAPPED_ROLE", role: "INVENTORY_ADJUSTMENT" });

    const res = await approveOpname("op1", true);

    expect(res).toEqual({ success: true });
    const { data } = mockCreateNotification.mock.calls[0][0];
    expect(data.metadata).toEqual({ opnameId: "op1", reason: "UNMAPPED_ROLE", role: "INVENTORY_ADJUSTMENT" });
    expect(data.message).toContain("INVENTORY_ADJUSTMENT");
  });

  it("raises nothing when there is nothing to post", async () => {
    mockPostOpnameJournal.mockResolvedValue({ ok: false, code: "NOTHING_TO_POST" });

    const res = await approveOpname("op1", true);

    expect(res).toEqual({ success: true });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockFanOut).not.toHaveBeenCalled();
  });

  it("still approves when recording the notification itself fails", async () => {
    mockPostOpnameJournal.mockRejectedValue(new Error("boom"));
    mockCreateNotification.mockRejectedValue(new Error("insert failed"));

    const res = await approveOpname("op1", true);

    expect(res).toEqual({ success: true });
    expect(mockFanOut).not.toHaveBeenCalled();
  });
});

describe("postOpnameJournalAction", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockFindOpname.mockResolvedValue({ ...OPNAME, status: "APPROVED" });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("returns ERROR instead of rejecting when the writer throws", async () => {
    mockPostOpnameJournal.mockRejectedValue(new Error("Opname op1 has a ledger entry with unknown totalCost"));

    await expect(postOpnameJournalAction("op1")).resolves.toEqual({ ok: false, code: "ERROR" });
  });

  it("passes a writer result through unchanged", async () => {
    mockPostOpnameJournal.mockResolvedValue({ ok: true, journalId: "j1", created: true });

    await expect(postOpnameJournalAction("op1")).resolves.toEqual({ ok: true, journalId: "j1", created: true });
  });
});
