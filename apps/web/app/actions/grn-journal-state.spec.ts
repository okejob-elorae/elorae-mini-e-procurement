import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockAuth, mockHasPermission, mockPostGrnJournal, mockJournalFind, mockGrnFind } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockPostGrnJournal: vi.fn(),
  mockJournalFind: vi.fn(),
  mockGrnFind: vi.fn(),
}));

vi.mock("@elorae/db", async (importActual) => {
  const actual = await importActual<typeof import("@elorae/db")>();
  return {
    ...actual,
    prisma: {
      journal: { findUnique: mockJournalFind },
      gRN: { findUnique: mockGrnFind },
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: mockPostGrnJournal,
  postGrnReversalJournal: vi.fn(),
}));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(),
  notifyGRNCreated: vi.fn(),
  notifyMaterialArrivedForPo: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { getGrnJournalState, postGrnReceiptJournalAction } from "./grn";

describe("GRN receipt journal on a declined GRN (unit — prisma and writers mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockPostGrnJournal.mockReset();
    mockJournalFind.mockReset();
    mockGrnFind.mockReset();
    mockJournalFind.mockResolvedValue(null);
  });

  it("offers the receipt journal on a live valued GRN with no journal", async () => {
    mockGrnFind.mockResolvedValue({ totalAmount: 500, ownerDeclinedAt: null });
    const state = await getGrnJournalState("g1");
    expect(state.hasPostableReceiptJournal).toBe(true);
    expect(state.hasPostableReversalJournal).toBe(false);
  });

  it("does not offer the receipt journal on an owner-declined GRN", async () => {
    mockGrnFind.mockResolvedValue({ totalAmount: 500, ownerDeclinedAt: new Date() });
    const state = await getGrnJournalState("g1");
    expect(state.hasPostableReceiptJournal).toBe(false);
    expect(state.hasPostableReversalJournal).toBe(true);
  });

  it("postGrnReceiptJournalAction refuses a declined GRN without posting", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHasPermission.mockReturnValue(true);
    mockGrnFind.mockResolvedValue({ id: "g1", ownerDeclinedAt: new Date() });
    const result = await postGrnReceiptJournalAction("g1");
    expect(result).toEqual({ ok: false, code: "BAD_STATE" });
    expect(mockPostGrnJournal).not.toHaveBeenCalled();
  });

  it("postGrnReceiptJournalAction still posts for a live GRN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHasPermission.mockReturnValue(true);
    mockGrnFind.mockResolvedValue({ id: "g1", ownerDeclinedAt: null });
    mockPostGrnJournal.mockResolvedValue({ ok: true, journalId: "j1", created: true });
    const result = await postGrnReceiptJournalAction("g1");
    expect(result).toMatchObject({ ok: true });
    expect(mockPostGrnJournal).toHaveBeenCalledWith("g1", "u1");
  });
});
