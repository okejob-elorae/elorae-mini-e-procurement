import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockVerifyPin,
  mockCreatePurchaseOrder,
  mockPoFindUnique,
  mockPoUpdate,
  mockHistoryCreate,
  mockTransaction,
  mockRecompute,
  mockSetTerms,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockVerifyPin: vi.fn(),
  mockCreatePurchaseOrder: vi.fn(),
  mockPoFindUnique: vi.fn(),
  mockPoUpdate: vi.fn(),
  mockHistoryCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockRecompute: vi.fn(),
  mockSetTerms: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  prisma: {
    purchaseOrder: { findUnique: mockPoFindUnique, update: mockPoUpdate },
    pOStatusHistory: { create: mockHistoryCreate },
    $transaction: mockTransaction,
  },
  POStatus: {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/security/pin", () => ({ verifyPin: mockVerifyPin }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn() }));
vi.mock("@/lib/notifications/actor-name", () => ({
  getActorName: vi.fn().mockResolvedValue("Actor"),
}));
vi.mock("@/app/actions/notifications", () => ({
  notifyPOCreated: vi.fn(),
  notifyPOStatusUpdated: vi.fn(),
  notifyPOPaymentToggled: vi.fn(),
}));
vi.mock("@/lib/purchase-orders/mutations", () => ({ createPurchaseOrder: mockCreatePurchaseOrder }));
vi.mock("@/lib/purchase-orders/queries", () => ({ listPOs: vi.fn(), getPOById: vi.fn() }));
vi.mock("@/lib/items/validate-variant-lines", () => ({
  assertLinesVariantSkusMatchItemDefinitions: vi.fn(),
}));
vi.mock("@/lib/leadtime/po-snapshot", () => ({ resolvePoLeadTimeFields: vi.fn() }));
vi.mock("@/lib/purchasing/supplier-payment-journal", () => ({
  hasCurrentPaymentJournal: vi.fn(),
  hasStandingPaymentJournalWhileUnpaid: vi.fn(),
  postSupplierPaymentJournal: vi.fn(),
  postSupplierPaymentReversalJournal: vi.fn(),
}));
vi.mock("@/lib/purchasing/post-supplier-payment-journal-safely", () => ({
  attemptSupplierPaymentJournal: vi.fn(),
  latestPaymentJournalFailure: vi.fn(),
  notifySupplierPaymentJournalFailure: vi.fn(),
}));
vi.mock("@/lib/purchase-orders/payment-due", () => ({
  recomputePaymentDueDate: mockRecompute,
}));
vi.mock("@/lib/purchase-orders/set-payment-terms", () => ({
  setPurchaseOrderPaymentTerms: mockSetTerms,
}));
vi.mock("@/lib/db/tx-retry", () => ({ runSerializable: vi.fn() }));

import { cancelPO, changePOStatus, createPO, setPOPaymentTerms, submitPO, updatePO } from "./purchase-orders";

describe("purchase-order actor trust", () => {
  const FORBIDDEN = "Forbidden: actor does not match the session";

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockVerifyPin.mockResolvedValue({ success: true });
  });

  it.each([
    ["createPO", () => createPO({} as never, "someone-else")],
    ["updatePO", () => updatePO("po1", {} as never, "someone-else", "1234")],
    ["changePOStatus", () => changePOStatus("po1", "CANCELLED", "someone-else", undefined, "1234")],
    ["submitPO", () => submitPO("po1", "someone-else")],
    ["cancelPO", () => cancelPO("po1", "someone-else", "why", "1234")],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s refuses a claimed id that is not the session user and writes nothing",
    async (_name, call) => {
      await expect(call()).rejects.toThrow(FORBIDDEN);
      expect(mockVerifyPin).not.toHaveBeenCalled();
      expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
      expect(mockPoFindUnique).not.toHaveBeenCalled();
      expect(mockPoUpdate).not.toHaveBeenCalled();
      expect(mockHistoryCreate).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    }
  );

  it("updatePO verifies the session user's PIN on a posted PO", async () => {
    mockPoFindUnique.mockResolvedValue({ status: "SUBMITTED" });
    mockVerifyPin.mockResolvedValue({ success: false, message: "bad pin" });
    await expect(updatePO("po1", {} as never, "u1", "1234")).rejects.toThrow("bad pin");
    expect(mockVerifyPin).toHaveBeenCalledWith("u1", "1234", "EDIT_POSTED_PO");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("cancelPO verifies the session user's PIN", async () => {
    mockVerifyPin.mockResolvedValue({ success: false, message: "bad pin" });
    await expect(cancelPO("po1", "u1", "why", "1234")).rejects.toThrow("bad pin");
    expect(mockVerifyPin).toHaveBeenCalledWith("u1", "1234", "VOID_DOCUMENT");
    expect(mockPoFindUnique).not.toHaveBeenCalled();
  });

  it("changePOStatus verifies the session user's PIN when cancelling", async () => {
    mockVerifyPin.mockResolvedValue({ success: false, message: "bad pin" });
    await expect(changePOStatus("po1", "CANCELLED", "u1", undefined, "1234")).rejects.toThrow("bad pin");
    expect(mockVerifyPin).toHaveBeenCalledWith("u1", "1234", "VOID_DOCUMENT");
    expect(mockPoUpdate).not.toHaveBeenCalled();
  });
});

describe("updatePO payment terms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockPoFindUnique.mockResolvedValue({ status: "DRAFT" });
  });

  it("refuses invalid terms before opening a transaction", async () => {
    await expect(
      updatePO("po1", { supplierId: "s1", items: [], paymentTermsDays: 400 } as never, "u1")
    ).rejects.toThrow("Payment terms must be a whole number of days from 0 to 365");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refuses changed terms on a paid PO before opening a transaction", async () => {
    mockPoFindUnique.mockResolvedValue({ status: "DRAFT", paidAt: new Date(), paymentTermsDays: 30 });
    await expect(
      updatePO("po1", { supplierId: "s1", items: [], paymentTermsDays: 60 } as never, "u1")
    ).rejects.toThrow("This PO is already paid — its payment terms can no longer change");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("saves a paid PO whose terms are unchanged", async () => {
    mockPoFindUnique.mockResolvedValue({ status: "DRAFT", paidAt: new Date(), paymentTermsDays: 30 });
    await expect(
      updatePO("po1", { supplierId: "s1", items: [], paymentTermsDays: 30 } as never, "u1")
    ).resolves.toEqual({ id: "po1" });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("setPOPaymentTerms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockSetTerms.mockResolvedValue({ ok: true });
  });

  it("needs no PIN on a draft", async () => {
    mockPoFindUnique.mockResolvedValue({ status: "DRAFT" });
    await expect(setPOPaymentTerms("po1", 30)).resolves.toEqual({ ok: true });
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(mockSetTerms).toHaveBeenCalledWith("po1", 30, "u1");
  });

  it("requires the session user's PIN on a posted PO", async () => {
    mockPoFindUnique.mockResolvedValue({ status: "CLOSED" });
    await expect(setPOPaymentTerms("po1", 30)).resolves.toEqual({ ok: false, code: "PIN", message: "PIN required" });
    expect(mockSetTerms).not.toHaveBeenCalled();
  });

  it("returns PIN with the verifier's message on a wrong PIN", async () => {
    mockPoFindUnique.mockResolvedValue({ status: "CLOSED" });
    mockVerifyPin.mockResolvedValue({ success: false, message: "bad pin" });
    await expect(setPOPaymentTerms("po1", 30, "0000")).resolves.toEqual({ ok: false, code: "PIN", message: "bad pin" });
    expect(mockVerifyPin).toHaveBeenCalledWith("u1", "0000", "EDIT_POSTED_PO");
    expect(mockSetTerms).not.toHaveBeenCalled();
  });

  it("passes the writer's refusal through", async () => {
    mockPoFindUnique.mockResolvedValue({ status: "DRAFT" });
    mockSetTerms.mockResolvedValue({ ok: false, code: "PAID" });
    await expect(setPOPaymentTerms("po1", 30)).resolves.toEqual({ ok: false, code: "PAID" });
  });

  it("refuses a caller without purchase_orders:edit", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:view"] } });
    await expect(setPOPaymentTerms("po1", 30)).rejects.toThrow();
    expect(mockSetTerms).not.toHaveBeenCalled();
  });
});
