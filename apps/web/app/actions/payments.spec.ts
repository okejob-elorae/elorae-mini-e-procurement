import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Unit-only: auth, rbac, the payment/void writers, the journal helpers and next/cache are all
 * mocked, so nothing here touches the shared dev database. This file exists to pin the
 * permission gate, the request-shape guards, the ERROR_CODE_MAP wiring, the already-voided vs.
 * real-void split, and the retry actions' entry-gate/outcome split — not to re-test the writers
 * themselves.
 */
const {
  mockAuth,
  mockHasPermission,
  mockRecordPayment,
  mockVoidPayment,
  mockPostArJournalSafely,
  mockPostPaymentReceiptJournal,
  mockPostPaymentVoidJournal,
  mockIsArJournalRetryable,
  mockRevalidatePath,
  mockApplyReturnOffset,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockRecordPayment: vi.fn(),
  mockVoidPayment: vi.fn(),
  mockPostArJournalSafely: vi.fn(),
  mockPostPaymentReceiptJournal: vi.fn(),
  mockPostPaymentVoidJournal: vi.fn(),
  mockIsArJournalRetryable: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockApplyReturnOffset: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/finance/ar/payment-writer", () => ({ recordPayment: mockRecordPayment }));
vi.mock("@/lib/finance/ar/void-writer", () => ({ voidPayment: mockVoidPayment }));
vi.mock("@/lib/finance/ar/post-ar-journal-safely", () => ({ postArJournalSafely: mockPostArJournalSafely }));
vi.mock("@/lib/finance/ar/payment-journal", () => ({
  postPaymentReceiptJournal: mockPostPaymentReceiptJournal,
  postPaymentVoidJournal: mockPostPaymentVoidJournal,
}));
vi.mock("@/lib/finance/ar/journal-pending", () => ({ isArJournalRetryable: mockIsArJournalRetryable }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/finance/ar/retur-offset-writer", () => ({ applyReturnOffset: mockApplyReturnOffset }));

import { PaymentError } from "@/lib/finance/ar/errors";
import { recordPaymentAction, voidPaymentAction, postPaymentJournalAction, applyReturnOffsetAction } from "./payments";

describe("payment action guards", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockRecordPayment.mockReset();
    mockVoidPayment.mockReset();
    mockPostArJournalSafely.mockReset();
    mockPostPaymentReceiptJournal.mockReset();
    mockPostPaymentVoidJournal.mockReset();
    mockIsArJournalRetryable.mockReset();
    mockRevalidatePath.mockReset();
    mockApplyReturnOffset.mockReset();

    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: [] } });
    mockHasPermission.mockReturnValue(true);
    mockRecordPayment.mockResolvedValue({ paymentId: "pay-1", docNo: "PAYMENT/0001" });
    mockVoidPayment.mockResolvedValue({ voided: true });
    mockPostArJournalSafely.mockResolvedValue({ ok: true, journalId: "j1", created: true });
    mockIsArJournalRetryable.mockResolvedValue(true);
  });

  it("refuses to record without payments:manage", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await recordPaymentAction({
      storeId: "s1", paidAt: "2026-03-01", method: "CASH", amount: 100,
      allocations: [{ receivableId: "r1", amount: 100 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("FORBIDDEN");
  });

  it("refuses to void without payments:manage", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await voidPaymentAction({ paymentId: "p1", reason: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("FORBIDDEN");
  });

  it("rejects a blank void reason even when permitted", async () => {
    mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "payments:manage");
    const res = await voidPaymentAction({ paymentId: "p1", reason: "   " });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("INVALID_REQUEST");
  });

  /*
   * The no-op path and the real-void path (next test) are a deliberate pair. Either one on its
   * own would pass under a bug that never posts a reversal at all — this one alone can't tell
   * "correctly skipped the reversal" from "always skips the reversal, even on a real void".
   */
  it("reports alreadyVoided: true and posts no reversal when the payment was already voided", async () => {
    mockVoidPayment.mockResolvedValue({ voided: false });
    const res = await voidPaymentAction({ paymentId: "p1", reason: "double-click" });
    expect(res).toEqual({ ok: true, paymentId: "p1", alreadyVoided: true });
    expect(mockPostArJournalSafely).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("posts the reversal and reports alreadyVoided: false when the void was real", async () => {
    mockVoidPayment.mockResolvedValue({ voided: true });
    const res = await voidPaymentAction({ paymentId: "p1", reason: "customer complaint" });
    expect(res).toEqual({ ok: true, paymentId: "p1", alreadyVoided: false });
    expect(mockPostArJournalSafely).toHaveBeenCalledWith("ar_payment_void", "p1", expect.any(Function));
  });

  it("maps a writer OVER_ALLOCATED error onto its own reason via ERROR_CODE_MAP", async () => {
    mockRecordPayment.mockRejectedValue(new PaymentError("OVER_ALLOCATED"));
    const res = await recordPaymentAction({
      storeId: "s1", paidAt: "2026-03-01", method: "CASH", amount: 100,
      allocations: [{ receivableId: "r1", amount: 100 }],
    });
    expect(res).toEqual({ ok: false, reason: "OVER_ALLOCATED" });
  });

  it("maps an unexpected non-PaymentError throw onto ERROR rather than leaking it", async () => {
    mockRecordPayment.mockRejectedValue(new Error("db exploded"));
    const res = await recordPaymentAction({
      storeId: "s1", paidAt: "2026-03-01", method: "CASH", amount: 100,
      allocations: [{ receivableId: "r1", amount: 100 }],
    });
    expect(res).toEqual({ ok: false, reason: "ERROR" });
  });

  it("returns NOT_RETRYABLE without calling the poster when the entry gate is closed", async () => {
    mockIsArJournalRetryable.mockResolvedValue(false);
    const res = await postPaymentJournalAction("p1");
    expect(res).toEqual({ ok: false, reason: "NOT_RETRYABLE" });
    expect(mockPostArJournalSafely).not.toHaveBeenCalled();
  });

  it("reports STILL_PENDING rather than success when the retried post itself fails", async () => {
    mockIsArJournalRetryable.mockResolvedValue(true);
    mockPostArJournalSafely.mockResolvedValue({ ok: false, code: "ERROR" });
    const res = await postPaymentJournalAction("p1");
    expect(res).toEqual({ ok: false, reason: "STILL_PENDING" });
  });

  it("refuses to apply a retur offset without payments:manage", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await applyReturnOffsetAction({ returnId: "ret-1", allocations: [{ receivableId: "r1", amount: 500 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("FORBIDDEN");
    expect(mockApplyReturnOffset).not.toHaveBeenCalled();
  });

  it("maps RETURN_NOT_APPROVED through ERROR_CODE_MAP", async () => {
    mockApplyReturnOffset.mockRejectedValue(new PaymentError("RETURN_NOT_APPROVED"));
    const res = await applyReturnOffsetAction({ returnId: "ret-1", allocations: [{ receivableId: "r1", amount: 500 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("RETURN_NOT_APPROVED");
  });

  it("posts the receipt journal and reports alreadyApplied on success", async () => {
    mockApplyReturnOffset.mockResolvedValue({ ok: true, paymentId: "pay-9", alreadyApplied: true });
    const res = await applyReturnOffsetAction({ returnId: "ret-1", allocations: [{ receivableId: "r1", amount: 500 }] });
    expect(res).toMatchObject({ ok: true, paymentId: "pay-9", alreadyApplied: true });
    expect(mockPostArJournalSafely).toHaveBeenCalledWith("ar_payment", "pay-9", expect.any(Function));
  });
});
