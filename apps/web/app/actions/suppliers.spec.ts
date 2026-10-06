import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockVerifyPin, mockDeleteSupplier, mockDecryptBank } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockVerifyPin: vi.fn(),
  mockDeleteSupplier: vi.fn(),
  mockDecryptBank: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/security/pin", () => ({ verifyPin: mockVerifyPin }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({
  getActorName: vi.fn(),
}));
vi.mock("@/app/actions/notifications", () => ({
  notifySupplierCreated: vi.fn(),
  notifySupplierApproved: vi.fn(),
}));
vi.mock("@/lib/suppliers/queries", () => ({
  listSuppliers: vi.fn(),
  getSupplierById: vi.fn(),
}));
vi.mock("@/lib/suppliers/mutations", () => ({
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  deleteSupplier: mockDeleteSupplier,
  approveSupplier: vi.fn(),
  rejectSupplier: vi.fn(),
  decryptSupplierBankAccount: mockDecryptBank,
  supplierSchema: {},
  supplierUpdateSchema: {},
  SUPPLIER_DELETE_BLOCKED: "SUPPLIER_DELETE_BLOCKED",
}));

import { decryptSupplierBankAction, deleteSupplierAction } from "./suppliers";

describe("deleteSupplierAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "u1@example.com", permissions: ["suppliers:delete"] },
    });
  });

  it("refuses without a session and checks nothing", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(deleteSupplierAction("s1", "123456")).rejects.toThrow("Unauthorized");
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(mockDeleteSupplier).not.toHaveBeenCalled();
  });

  it("refuses without the delete permission before verifying the PIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["suppliers:view"] } });
    await expect(deleteSupplierAction("s1", "123456")).rejects.toThrow("Forbidden");
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(mockDeleteSupplier).not.toHaveBeenCalled();
  });

  it("deletes nothing on a wrong PIN and surfaces the security message key", async () => {
    mockVerifyPin.mockResolvedValue({ success: false, messageKey: "invalidPin" });
    const result = await deleteSupplierAction("s1", "000000");
    expect(result).toMatchObject({ success: false, reason: "PIN", messageKey: "invalidPin" });
    expect(mockVerifyPin).toHaveBeenCalledWith("u1", "000000", "DELETE_SUPPLIER", {
      fallbackEmail: "u1@example.com",
    });
    expect(mockDeleteSupplier).not.toHaveBeenCalled();
  });

  it("deletes with the right PIN", async () => {
    mockVerifyPin.mockResolvedValue({ success: true, userId: "u1" });
    mockDeleteSupplier.mockResolvedValue(undefined);
    const result = await deleteSupplierAction("s1", "123456");
    expect(result).toEqual({ success: true });
    expect(mockDeleteSupplier).toHaveBeenCalledWith("s1");
  });
});

describe("decryptSupplierBankAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses without the view permission before verifying the PIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    await expect(decryptSupplierBankAction("s1", "123456")).rejects.toThrow("Forbidden");
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(mockDecryptBank).not.toHaveBeenCalled();
  });

  it("decrypts with the view permission and the right PIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["suppliers:view"] } });
    mockVerifyPin.mockResolvedValue({ success: true, userId: "u1" });
    mockDecryptBank.mockResolvedValue("1234567890");
    const result = await decryptSupplierBankAction("s1", "123456");
    expect(result).toEqual({ bankAccount: "1234567890" });
    expect(mockVerifyPin).toHaveBeenCalledWith("u1", "123456", "VIEW_BANK_ACCOUNT", {
      ipAddress: "server-action",
    });
  });
});
