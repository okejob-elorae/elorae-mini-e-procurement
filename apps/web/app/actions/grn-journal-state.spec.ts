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
vi.mock("@/lib/notifications/actor-name", () => ({
  getActorName: vi.fn(),
}));
vi.mock("@/app/actions/notifications", () => ({
  notifyGRNCreated: vi.fn(),
  notifyMaterialArrivedForPo: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { getGrnJournalState, postGrnReceiptJournalAction } from "./grn";

/* Answers the two `journal.findUnique` reads by source type: which journals exist for the GRN. */
function journalsExist(existing: { receipt?: boolean; reversal?: boolean }) {
  mockJournalFind.mockImplementation(
    async (args: { where: { sourceType_sourceId: { sourceType: string } } }) => {
      const type = args.where.sourceType_sourceId.sourceType;
      if (type === "GRN") return existing.receipt ? { id: "j-receipt" } : null;
      if (type === "GRN_REVERSAL") return existing.reversal ? { id: "j-reversal" } : null;
      return null;
    },
  );
}

describe("GRN journals on a declined GRN (unit — prisma and writers mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockPostGrnJournal.mockReset();
    mockJournalFind.mockReset();
    mockGrnFind.mockReset();
    journalsExist({});
    /*
     * getGrnJournalState is gated by requireGrnRead, which checks through rbac's own internal
     * hasPermission rather than the mocked export, so the session must hold the real permission.
     * The postGrnReceiptJournalAction tests below set their own session.
     */
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["inventory:view"] } });
  });

  it("offers the receipt journal on a live valued GRN with no journal", async () => {
    mockGrnFind.mockResolvedValue({ totalAmount: 500, ownerDeclinedAt: null });
    const state = await getGrnJournalState("g1");
    expect(state.hasPostableReceiptJournal).toBe(true);
    expect(state.hasPostableReversalJournal).toBe(false);
  });

  it("offers neither journal on a declined GRN that never got a receipt journal", async () => {
    mockGrnFind.mockResolvedValue({ totalAmount: 500, ownerDeclinedAt: new Date() });
    const state = await getGrnJournalState("g1");
    expect(state.hasPostableReceiptJournal).toBe(false);
    expect(state.hasPostableReversalJournal).toBe(false);
  });

  it("offers the reversal, not the receipt, on a declined GRN whose receipt journal exists", async () => {
    mockGrnFind.mockResolvedValue({ totalAmount: 500, ownerDeclinedAt: new Date() });
    journalsExist({ receipt: true });
    const state = await getGrnJournalState("g1");
    expect(state.hasPostableReceiptJournal).toBe(false);
    expect(state.hasPostableReversalJournal).toBe(true);
  });

  it("offers the receipt, not the reversal, on a declined GRN carrying a stray reversal with no receipt", async () => {
    mockGrnFind.mockResolvedValue({ totalAmount: 500, ownerDeclinedAt: new Date() });
    journalsExist({ reversal: true });
    const state = await getGrnJournalState("g1");
    expect(state.hasPostableReceiptJournal).toBe(true);
    expect(state.hasPostableReversalJournal).toBe(false);
  });

  it("postGrnReceiptJournalAction refuses a declined GRN with no stray reversal, without posting", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHasPermission.mockReturnValue(true);
    mockGrnFind.mockResolvedValue({ id: "g1", ownerDeclinedAt: new Date() });
    const result = await postGrnReceiptJournalAction("g1");
    expect(result).toEqual({ ok: false, code: "BAD_STATE" });
    expect(mockPostGrnJournal).not.toHaveBeenCalled();
  });

  it("postGrnReceiptJournalAction posts on a declined GRN carrying a stray reversal, netting it off", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHasPermission.mockReturnValue(true);
    mockGrnFind.mockResolvedValue({ id: "g1", ownerDeclinedAt: new Date() });
    journalsExist({ reversal: true });
    mockPostGrnJournal.mockResolvedValue({ ok: true, journalId: "j1", created: true });
    const result = await postGrnReceiptJournalAction("g1");
    expect(result).toMatchObject({ ok: true });
    expect(mockPostGrnJournal).toHaveBeenCalledWith("g1", "u1");
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
