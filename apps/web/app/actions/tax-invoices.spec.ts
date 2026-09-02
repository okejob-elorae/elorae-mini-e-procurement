import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit-only: the writer, auth and rbac modules are all mocked, so nothing here touches the
 * shared dev database. `lib/tax-invoices/writer.ts` already has its own DB-backed spec — this
 * file exists to pin the permission gate + error-code mapping the actions add on top of it.
 */
const {
  mockAuth,
  mockHasPermission,
  mockMarkTaxInvoiceCreated,
  mockMarkTaxInvoiceNotRequired,
  mockMarkTaxInvoiceSentToStore,
  mockRevertTaxInvoiceToPending,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockMarkTaxInvoiceCreated: vi.fn(),
  mockMarkTaxInvoiceNotRequired: vi.fn(),
  mockMarkTaxInvoiceSentToStore: vi.fn(),
  mockRevertTaxInvoiceToPending: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/tax-invoices/writer", () => ({
  markTaxInvoiceCreated: mockMarkTaxInvoiceCreated,
  markTaxInvoiceNotRequired: mockMarkTaxInvoiceNotRequired,
  markTaxInvoiceSentToStore: mockMarkTaxInvoiceSentToStore,
  revertTaxInvoiceToPending: mockRevertTaxInvoiceToPending,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { TaxInvoiceError } from "@/lib/tax-invoices/errors";
import { markCreatedAction, markNotRequiredAction, markSentToStoreAction, revertToPendingAction } from "./tax-invoices";

describe("tax invoice actions (unit — writer mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockMarkTaxInvoiceCreated.mockReset();
    mockMarkTaxInvoiceNotRequired.mockReset();
    mockMarkTaxInvoiceSentToStore.mockReset();
    mockRevertTaxInvoiceToPending.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["tax_invoices:manage"] } });
  });

  describe("markCreatedAction", () => {
    it("returns FORBIDDEN when the user lacks tax_invoices:manage", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await markCreatedAction({
        taxInvoiceId: "x",
        invoiceNo: "010.000-26.00000001",
        buyerNpwp: "01.234.567.8-901.000",
        taxableAmount: 5000,
        ppnAmount: 550,
      });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockMarkTaxInvoiceCreated).not.toHaveBeenCalled();
    });

    it("maps a writer INVALID_REQUEST onto its own code, not a neighbouring one", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceCreated.mockRejectedValue(new TaxInvoiceError("INVALID_REQUEST"));
      const res = await markCreatedAction({
        taxInvoiceId: "x",
        invoiceNo: " ",
        buyerNpwp: "01.234.567.8-901.000",
        taxableAmount: 5000,
        ppnAmount: 550,
      });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
    });

    it("maps an unknown throw onto ERROR rather than leaking it", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceCreated.mockRejectedValue(new Error("boom"));
      const res = await markCreatedAction({
        taxInvoiceId: "x",
        invoiceNo: "010.000-26.00000001",
        buyerNpwp: "01.234.567.8-901.000",
        taxableAmount: 5000,
        ppnAmount: 550,
      });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("returns INVALID_REQUEST for a non-string taxInvoiceId without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await markCreatedAction({
        taxInvoiceId: 123 as unknown as string,
        invoiceNo: "010.000-26.00000001",
        buyerNpwp: "01.234.567.8-901.000",
        taxableAmount: 5000,
        ppnAmount: 550,
      });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockMarkTaxInvoiceCreated).not.toHaveBeenCalled();
    });

    it("returns INVALID_REQUEST for a missing invoiceNo without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await markCreatedAction({
        taxInvoiceId: "x",
        buyerNpwp: "01.234.567.8-901.000",
        taxableAmount: 5000,
        ppnAmount: 550,
      } as unknown as Parameters<typeof markCreatedAction>[0]);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockMarkTaxInvoiceCreated).not.toHaveBeenCalled();
    });

    it("calls the writer with the current user id and succeeds", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceCreated.mockResolvedValue({ ok: true });
      const res = await markCreatedAction({
        taxInvoiceId: "x",
        invoiceNo: "010.000-26.00000001",
        buyerNpwp: "01.234.567.8-901.000",
        taxableAmount: 5000,
        ppnAmount: 550,
      });
      expect(res).toEqual({ ok: true });
      expect(mockMarkTaxInvoiceCreated).toHaveBeenCalledWith({
        taxInvoiceId: "x",
        invoiceNo: "010.000-26.00000001",
        buyerNpwp: "01.234.567.8-901.000",
        taxableAmount: 5000,
        ppnAmount: 550,
        userId: "user-1",
      });
    });
  });

  describe("markNotRequiredAction", () => {
    it("returns FORBIDDEN when the user lacks tax_invoices:manage", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await markNotRequiredAction({ taxInvoiceId: "x", reason: "export sale" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockMarkTaxInvoiceNotRequired).not.toHaveBeenCalled();
    });

    it("maps a writer INVALID_STATE onto its own code, not a neighbouring one", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceNotRequired.mockRejectedValue(new TaxInvoiceError("INVALID_STATE"));
      const res = await markNotRequiredAction({ taxInvoiceId: "x", reason: "export sale" });
      expect(res).toEqual({ ok: false, code: "INVALID_STATE" });
    });

    it("returns INVALID_REQUEST for a missing reason without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await markNotRequiredAction({
        taxInvoiceId: "x",
      } as unknown as Parameters<typeof markNotRequiredAction>[0]);
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockMarkTaxInvoiceNotRequired).not.toHaveBeenCalled();
    });

    it("maps an unknown throw onto ERROR rather than leaking it", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceNotRequired.mockRejectedValue(new Error("boom"));
      const res = await markNotRequiredAction({ taxInvoiceId: "x", reason: "export sale" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("calls the writer with the current user id and succeeds", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceNotRequired.mockResolvedValue({ ok: true });
      const res = await markNotRequiredAction({ taxInvoiceId: "x", reason: "export sale" });
      expect(res).toEqual({ ok: true });
      expect(mockMarkTaxInvoiceNotRequired).toHaveBeenCalledWith({
        taxInvoiceId: "x",
        reason: "export sale",
        userId: "user-1",
      });
    });
  });

  describe("markSentToStoreAction", () => {
    it("returns FORBIDDEN when the user lacks tax_invoices:manage", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await markSentToStoreAction({ taxInvoiceId: "x" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockMarkTaxInvoiceSentToStore).not.toHaveBeenCalled();
    });

    it("maps a writer INVALID_STATE onto its own code", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceSentToStore.mockRejectedValue(new TaxInvoiceError("INVALID_STATE"));
      const res = await markSentToStoreAction({ taxInvoiceId: "x" });
      expect(res).toEqual({ ok: false, code: "INVALID_STATE" });
    });

    it("returns INVALID_REQUEST for a non-string taxInvoiceId without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await markSentToStoreAction({ taxInvoiceId: 123 as unknown as string });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockMarkTaxInvoiceSentToStore).not.toHaveBeenCalled();
    });

    it("accepts a missing reason and calls the writer with the current user id", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceSentToStore.mockResolvedValue({ ok: true });
      const res = await markSentToStoreAction({ taxInvoiceId: "x" });
      expect(res).toEqual({ ok: true });
      expect(mockMarkTaxInvoiceSentToStore).toHaveBeenCalledWith({ taxInvoiceId: "x", reason: undefined, userId: "user-1" });
    });

    it("passes a provided reason through to the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      mockMarkTaxInvoiceSentToStore.mockResolvedValue({ ok: true });
      await markSentToStoreAction({ taxInvoiceId: "x", reason: "handed to owner" });
      expect(mockMarkTaxInvoiceSentToStore).toHaveBeenCalledWith({ taxInvoiceId: "x", reason: "handed to owner", userId: "user-1" });
    });
  });

  describe("revertToPendingAction", () => {
    it("returns FORBIDDEN when the user lacks tax_invoices:manage", async () => {
      mockHasPermission.mockReturnValue(false);
      const res = await revertToPendingAction({ taxInvoiceId: "x", reason: "wrong number entered" });
      expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(mockRevertTaxInvoiceToPending).not.toHaveBeenCalled();
    });

    it("maps a writer CONFLICT onto its own code, not a neighbouring one", async () => {
      mockHasPermission.mockReturnValue(true);
      mockRevertTaxInvoiceToPending.mockRejectedValue(new TaxInvoiceError("CONFLICT"));
      const res = await revertToPendingAction({ taxInvoiceId: "x", reason: "wrong number entered" });
      expect(res).toEqual({ ok: false, code: "CONFLICT" });
    });

    it("returns INVALID_REQUEST for a non-string taxInvoiceId without calling the writer", async () => {
      mockHasPermission.mockReturnValue(true);
      const res = await revertToPendingAction({ taxInvoiceId: 1 as unknown as string, reason: "x" });
      expect(res).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(mockRevertTaxInvoiceToPending).not.toHaveBeenCalled();
    });

    it("maps an unknown throw onto ERROR rather than leaking it", async () => {
      mockHasPermission.mockReturnValue(true);
      mockRevertTaxInvoiceToPending.mockRejectedValue(new Error("boom"));
      const res = await revertToPendingAction({ taxInvoiceId: "x", reason: "wrong number entered" });
      expect(res).toEqual({ ok: false, code: "ERROR" });
    });

    it("calls the writer with the current user id and succeeds", async () => {
      mockHasPermission.mockReturnValue(true);
      mockRevertTaxInvoiceToPending.mockResolvedValue({ ok: true });
      const res = await revertToPendingAction({ taxInvoiceId: "x", reason: "wrong number entered" });
      expect(res).toEqual({ ok: true });
      expect(mockRevertTaxInvoiceToPending).toHaveBeenCalledWith({
        taxInvoiceId: "x",
        reason: "wrong number entered",
        userId: "user-1",
      });
    });
  });
});
