import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Unit-only: auth, rbac, the payment/void writers, the journal helpers and next/cache are all
 * mocked, so nothing here touches the shared dev database. This file exists to pin the
 * permission gate and the request-shape guards the actions add on top of the writers from
 * earlier tasks — not to re-test the writers themselves.
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

import { recordPaymentAction, voidPaymentAction } from "./payments";

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
  });

  it("refuses to void without payments:manage", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await voidPaymentAction({ paymentId: "p1", reason: "x" });
    expect(res.ok).toBe(false);
  });

  it("rejects a blank void reason even when permitted", async () => {
    mockHasPermission.mockImplementation((_p: unknown, code: string) => code === "payments:manage");
    const res = await voidPaymentAction({ paymentId: "p1", reason: "   " });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("INVALID_REQUEST");
  });
});
