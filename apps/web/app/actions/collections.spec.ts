import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockAuth, mockHasPermission, mockAssign, mockSubmit, mockVerify, mockReject, mockFindSubmission } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockAssign: vi.fn(),
  mockSubmit: vi.fn(),
  mockVerify: vi.fn(),
  mockReject: vi.fn(),
  mockFindSubmission: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/finance/collections/assign-writer", () => ({ assignCollector: mockAssign }));
vi.mock("@/lib/finance/collections/submit-writer", () => ({ submitCollection: mockSubmit }));
vi.mock("@/lib/finance/collections/verify-writer", () => ({ verifyCollection: mockVerify }));
vi.mock("@/lib/finance/collections/reject-writer", () => ({ rejectCollection: mockReject }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/finance/ar/post-ar-journal-safely", () => ({ postArJournalSafely: vi.fn(async () => ({ ok: true })) }));
vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  return { ...actual, prisma: { collectionSubmission: { findUnique: mockFindSubmission } } };
});

import { CollectionError } from "@/lib/finance/collections/errors";
import { assignCollectorAction, submitCollectionAction, verifyCollectionAction, rejectCollectionAction } from "./collections";

describe("collections actions (unit — writers mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockAssign.mockReset();
    mockSubmit.mockReset();
    mockVerify.mockReset();
    mockReject.mockReset();
    mockFindSubmission.mockReset();
    mockFindSubmission.mockResolvedValue({ collectorId: "collector-1" });
  });

  it("assignCollectorAction returns FORBIDDEN without collections:manage", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHasPermission.mockReturnValue(false);
    const result = await assignCollectorAction({ receivableIds: ["r1"], collectorId: "c1" });
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("assignCollectorAction maps NOT_ELIGIBLE", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["collections:manage"] } });
    mockHasPermission.mockReturnValue(true);
    mockAssign.mockRejectedValue(new CollectionError("NOT_ELIGIBLE"));
    const result = await assignCollectorAction({ receivableIds: ["r1"], collectorId: "c1" });
    expect(result).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
  });

  it("submitCollectionAction returns FORBIDDEN without collections:collect", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHasPermission.mockReturnValue(false);
    const result = await submitCollectionAction({ receivableId: "r1", amount: 100, method: "CASH", paidAt: "2026-01-01" });
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("submitCollectionAction refuses RETUR_OFFSET before calling the writer", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["collections:collect"] } });
    mockHasPermission.mockReturnValue(true);
    const result = await submitCollectionAction({
      receivableId: "r1", amount: 100, method: "RETUR_OFFSET" as unknown as "CASH", paidAt: "2026-01-01",
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_METHOD" });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("verifyCollectionAction returns FORBIDDEN without payments:verify", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHasPermission.mockReturnValue(false);
    const result = await verifyCollectionAction("s1");
    expect(result).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("rejectCollectionAction requires a non-blank reason", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["payments:verify"] } });
    mockHasPermission.mockReturnValue(true);
    const result = await rejectCollectionAction("s1", "  ");
    expect(result).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(mockReject).not.toHaveBeenCalled();
  });

  /*
   * Checking a collector's money is payment verification (owner, 2026-10-29): `payments:verify`,
   * no longer `payments:manage` — the code that RECORDS office payments must not also check them.
   */
  it("verify and reject pin payments:verify and refuse a payments:manage holder", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockVerify.mockResolvedValue({ ok: true, paymentId: "p1" });
    mockReject.mockResolvedValue({ ok: true });
    mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "payments:verify");
    expect(await verifyCollectionAction("s1")).toEqual({ ok: true, alreadyVerified: false });
    expect(await rejectCollectionAction("s1", "salah nominal")).toEqual({ ok: true });
    expect(mockHasPermission).toHaveBeenCalledWith(expect.anything(), "payments:verify");

    mockVerify.mockClear();
    mockReject.mockClear();
    mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "payments:manage");
    expect(await verifyCollectionAction("s1")).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(await rejectCollectionAction("s1", "salah nominal")).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it("refuses the collector who handed the money in, admin included, before either writer runs", async () => {
    mockAuth.mockResolvedValue({ user: { id: "collector-1", permissions: ["*"] } });
    mockHasPermission.mockReturnValue(true);
    expect(await verifyCollectionAction("s1")).toEqual({ ok: false, reason: "SELF_VERIFICATION" });
    expect(await rejectCollectionAction("s1", "salah nominal")).toEqual({ ok: false, reason: "SELF_VERIFICATION" });
    expect(mockFindSubmission).toHaveBeenCalledWith({ where: { id: "s1" }, select: { collectorId: true } });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
  });
});
