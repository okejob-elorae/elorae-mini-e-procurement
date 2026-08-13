import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit-only: auth, rbac and the writer are all mocked, so nothing here touches the shared dev
 * database. `lib/field-sales/writer.ts` already has its own DB-backed spec — this file exists
 * to pin the permission gate + payload validation + error-code mapping the action adds on top
 * of it.
 */
const { mockAuth, mockHasPermission, mockApprove, mockReject } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/field-sales/writer", () => ({
  approveFieldSalesOrder: mockApprove,
  rejectFieldSalesOrder: mockReject,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { InvalidAddedLineError } from "@/lib/field-sales/errors";
import { approveFieldSalesOrderAction } from "./field-sales-orders";

describe("approveFieldSalesOrderAction (unit — writer mocked)", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockApprove.mockReset();
    mockReject.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["field_sales_orders:approve"] } });
  });

  it("returns FORBIDDEN without the approve permission and never calls the writer", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await approveFieldSalesOrderAction("o1", undefined, [{ itemId: "i1", variantSku: "", qty: 1 }]);
    expect(res).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("rejects a non-string itemId without calling the writer", async () => {
    mockHasPermission.mockReturnValue(true);
    const res = await approveFieldSalesOrderAction("o1", undefined, [
      { itemId: 1, variantSku: "", qty: 1 } as never,
    ]);
    expect(res).toEqual({ ok: false, reason: "INVALID_ADDED_LINE" });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("rejects an empty-string itemId without calling the writer", async () => {
    mockHasPermission.mockReturnValue(true);
    const res = await approveFieldSalesOrderAction("o1", undefined, [{ itemId: "", variantSku: "", qty: 1 }]);
    expect(res).toEqual({ ok: false, reason: "INVALID_ADDED_LINE" });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("rejects a non-integer qty without calling the writer", async () => {
    mockHasPermission.mockReturnValue(true);
    const res = await approveFieldSalesOrderAction("o1", undefined, [
      { itemId: "i1", variantSku: "", qty: 1.5 },
    ]);
    expect(res).toEqual({ ok: false, reason: "INVALID_ADDED_LINE" });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("rejects a zero qty without calling the writer", async () => {
    mockHasPermission.mockReturnValue(true);
    const res = await approveFieldSalesOrderAction("o1", undefined, [{ itemId: "i1", variantSku: "", qty: 0 }]);
    expect(res).toEqual({ ok: false, reason: "INVALID_ADDED_LINE" });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("rejects a negative qty without calling the writer", async () => {
    mockHasPermission.mockReturnValue(true);
    const res = await approveFieldSalesOrderAction("o1", undefined, [{ itemId: "i1", variantSku: "", qty: -1 }]);
    expect(res).toEqual({ ok: false, reason: "INVALID_ADDED_LINE" });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("rejects a non-string variantSku without calling the writer", async () => {
    mockHasPermission.mockReturnValue(true);
    const res = await approveFieldSalesOrderAction("o1", undefined, [
      { itemId: "i1", variantSku: null, qty: 1 } as never,
    ]);
    expect(res).toEqual({ ok: false, reason: "INVALID_ADDED_LINE" });
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("accepts an empty-string variantSku (simple item with no variants)", async () => {
    mockHasPermission.mockReturnValue(true);
    mockApprove.mockResolvedValue({ ok: true });
    const res = await approveFieldSalesOrderAction("o1", undefined, [{ itemId: "i1", variantSku: "", qty: 2 }]);
    expect(res).toEqual({ ok: true });
    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", addedLines: [{ itemId: "i1", variantSku: "", qty: 2 }] }),
    );
  });

  it("maps InvalidAddedLineError from the writer onto INVALID_ADDED_LINE", async () => {
    mockHasPermission.mockReturnValue(true);
    mockApprove.mockRejectedValue(new InvalidAddedLineError("ALREADY_SENT", "i1"));
    const res = await approveFieldSalesOrderAction("o1", undefined, [
      { itemId: "i1", variantSku: "S", qty: 1 },
    ]);
    expect(res).toEqual({ ok: false, reason: "INVALID_ADDED_LINE" });
  });

  it("passes addedLines through to the writer unchanged", async () => {
    mockHasPermission.mockReturnValue(true);
    mockApprove.mockResolvedValue({ ok: true });
    await approveFieldSalesOrderAction("o1", undefined, [{ itemId: "i1", variantSku: "XL", qty: 2 }]);
    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", addedLines: [{ itemId: "i1", variantSku: "XL", qty: 2 }] }),
    );
  });

  it("succeeds with no addedLines at all (backward compatible)", async () => {
    mockHasPermission.mockReturnValue(true);
    mockApprove.mockResolvedValue({ ok: true });
    const res = await approveFieldSalesOrderAction("o1");
    expect(res).toEqual({ ok: true });
    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", addedLines: undefined }),
    );
  });
});
