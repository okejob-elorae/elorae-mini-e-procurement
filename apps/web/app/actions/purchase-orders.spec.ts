import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockVerifyPin,
  mockCreatePurchaseOrder,
  mockPoFindUnique,
  mockPoUpdate,
  mockHistoryCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockVerifyPin: vi.fn(),
  mockCreatePurchaseOrder: vi.fn(),
  mockPoFindUnique: vi.fn(),
  mockPoUpdate: vi.fn(),
  mockHistoryCreate: vi.fn(),
  mockTransaction: vi.fn(),
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
vi.mock("@/lib/db/tx-retry", () => ({ runSerializable: vi.fn() }));

import { cancelPO, changePOStatus, createPO, submitPO, updatePO } from "./purchase-orders";

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
