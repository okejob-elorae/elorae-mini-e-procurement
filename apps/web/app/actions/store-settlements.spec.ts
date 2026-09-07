import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Unit-only: auth, rbac, both writers, the journal helpers and next/cache are all mocked, so
 * nothing here touches the shared dev database. This file exists to pin the permission gate, the
 * request-shape guards, the multi-payment journal loop, and the `SettlementError` /
 * `PaymentError` / unexpected-throw discrimination — not to re-test either writer itself (see
 * `lib/finance/ar-settlement/approve-writer.test.ts` and `reject-writer.test.ts` for those).
 */
const {
  mockAuth,
  mockHasPermission,
  mockApproveSettlement,
  mockRejectSettlement,
  mockPostArJournalSafely,
  mockPostPaymentReceiptJournal,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockApproveSettlement: vi.fn(),
  mockRejectSettlement: vi.fn(),
  mockPostArJournalSafely: vi.fn(),
  mockPostPaymentReceiptJournal: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/finance/ar-settlement/approve-writer", () => ({ approveSettlement: mockApproveSettlement }));
vi.mock("@/lib/finance/ar-settlement/reject-writer", () => ({ rejectSettlement: mockRejectSettlement }));
vi.mock("@/lib/finance/ar/post-ar-journal-safely", () => ({ postArJournalSafely: mockPostArJournalSafely }));
vi.mock("@/lib/finance/ar/payment-journal", () => ({ postPaymentReceiptJournal: mockPostPaymentReceiptJournal }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { SettlementError } from "@/lib/finance/ar-settlement/errors";
import { PaymentError } from "@/lib/finance/ar/errors";
import { approveSettlementAction, rejectSettlementAction } from "./store-settlements";

describe("store-settlements approve/reject actions (unit — writers mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockApproveSettlement.mockReset();
    mockRejectSettlement.mockReset();
    mockPostArJournalSafely.mockReset();
    mockPostPaymentReceiptJournal.mockReset();
    mockRevalidatePath.mockReset();

    mockAuth.mockResolvedValue({ user: { id: "admin-1", permissions: ["collections:manage"] } });
    mockHasPermission.mockReturnValue(true);
    mockPostArJournalSafely.mockResolvedValue({ ok: true, journalId: "j1", created: true });
  });

  it("approveSettlementAction returns FORBIDDEN without collections:manage", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockApproveSettlement).not.toHaveBeenCalled();
  });

  it("approveSettlementAction returns INVALID_REQUEST for a malformed input", async () => {
    const res = await approveSettlementAction({ settlementId: "" });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(mockApproveSettlement).not.toHaveBeenCalled();
  });

  /*
   * The specific regression this task exists to prevent: `recordPaymentAction`'s single-payment
   * shape is the wrong precedent for a settlement, which can post several payments in one
   * approval. Five ids pinned here (four simple components plus one retur draw) — a loop that
   * regressed to `paymentIds[0]` would call `postArJournalSafely` once instead of five times and
   * this test would fail.
   */
  it("posts a journal for every payment id the writer returns, not just the first", async () => {
    const paymentIds = ["pay-retur", "pay-program", "pay-fee", "pay-cash", "pay-retur-2"];
    mockApproveSettlement.mockResolvedValue({ ok: true, paymentIds });
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: true, paymentIds, alreadyApproved: undefined });
    expect(mockPostArJournalSafely).toHaveBeenCalledTimes(paymentIds.length);
    for (const paymentId of paymentIds) {
      expect(mockPostArJournalSafely).toHaveBeenCalledWith("ar_payment", paymentId, expect.any(Function));
    }
  });

  /*
   * A resumed approval (`alreadyApproved: true`) must still walk the whole loop — nothing in the
   * action special-cases a replay to skip re-posting, and correctness there is `postArJournalSafely`
   * never throwing plus `generateAutoJournal`'s own `Journal @@unique([sourceType, sourceId])`
   * reporting `created: false` on the second attempt, pinned here rather than assumed.
   */
  it("still calls postArJournalSafely for every id on an alreadyApproved replay", async () => {
    const paymentIds = ["pay-1", "pay-2"];
    mockApproveSettlement.mockResolvedValue({ ok: true, alreadyApproved: true, paymentIds });
    mockPostArJournalSafely.mockResolvedValue({ ok: true, journalId: "j1", created: false });
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: true, paymentIds, alreadyApproved: true });
    expect(mockPostArJournalSafely).toHaveBeenCalledTimes(2);
  });

  it("maps a SettlementError via instanceof, not a Record lookup", async () => {
    mockApproveSettlement.mockRejectedValue(new SettlementError("OVER_TENDER"));
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: false, reason: "OVER_TENDER" });
    expect(mockPostArJournalSafely).not.toHaveBeenCalled();
  });

  it("maps a propagated PaymentError via instanceof", async () => {
    mockApproveSettlement.mockRejectedValue(new PaymentError("EXCEEDS_REMAINING"));
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: false, reason: "EXCEEDS_REMAINING" });
  });

  /*
   * `WRONG_STORE` is the one code genuinely present in both `SettlementErrorCode` and
   * `PaymentErrorCode` with different meanings. Both must map to their own reason string, which
   * only happens if the `instanceof SettlementError` check AND the `instanceof PaymentError`
   * check both run — deleting either branch would send one of these two down to `UNEXPECTED`
   * instead, and only testing one origin would miss that.
   */
  it("maps WRONG_STORE from a SettlementError", async () => {
    mockApproveSettlement.mockRejectedValue(new SettlementError("WRONG_STORE"));
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: false, reason: "WRONG_STORE" });
  });

  it("maps WRONG_STORE from a PaymentError", async () => {
    mockApproveSettlement.mockRejectedValue(new PaymentError("WRONG_STORE"));
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: false, reason: "WRONG_STORE" });
  });

  it("maps an unrecognised thrown value to UNEXPECTED rather than leaking it", async () => {
    mockApproveSettlement.mockRejectedValue(new Error("db exploded"));
    const res = await approveSettlementAction({ settlementId: "s1" });
    expect(res).toEqual({ ok: false, reason: "UNEXPECTED" });
  });

  it("rejectSettlementAction returns FORBIDDEN without collections:manage", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await rejectSettlementAction({ settlementId: "s1", reason: "wrong amount" });
    expect(res).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockRejectSettlement).not.toHaveBeenCalled();
  });

  it("rejectSettlementAction returns INVALID_REQUEST when reason is not a string", async () => {
    const res = await rejectSettlementAction({ settlementId: "s1", reason: 123 as unknown as string });
    expect(res).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(mockRejectSettlement).not.toHaveBeenCalled();
  });

  it("rejectSettlementAction maps NOT_PENDING via instanceof", async () => {
    mockRejectSettlement.mockRejectedValue(new SettlementError("NOT_PENDING"));
    const res = await rejectSettlementAction({ settlementId: "s1", reason: "second attempt" });
    expect(res).toEqual({ ok: false, reason: "NOT_PENDING" });
  });

  it("rejectSettlementAction reports success and revalidates on a real rejection", async () => {
    mockRejectSettlement.mockResolvedValue({ ok: true });
    const res = await rejectSettlementAction({ settlementId: "s1", reason: "wrong amount claimed" });
    expect(res).toEqual({ ok: true });
    expect(mockRejectSettlement).toHaveBeenCalledWith({
      settlementId: "s1",
      rejectedById: "admin-1",
      reason: "wrong amount claimed",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/pwa/pelunasan");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/backoffice/finance/pelunasan");
  });
});
