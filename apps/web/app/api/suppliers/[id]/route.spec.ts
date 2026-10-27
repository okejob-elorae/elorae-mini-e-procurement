import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockVerifyPin,
  mockFindUnique,
  mockDecrypt,
  mockLogView,
  mockUpdateSupplier,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockVerifyPin: vi.fn(),
  mockFindUnique: vi.fn(),
  mockDecrypt: vi.fn(),
  mockLogView: vi.fn(),
  mockUpdateSupplier: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/security/pin", () => ({ verifyPin: mockVerifyPin }));
vi.mock("@elorae/db", () => ({
  prisma: { supplier: { findUnique: mockFindUnique } },
}));
vi.mock("@/lib/encryption", () => ({
  encryptBankAccount: vi.fn(),
  decryptBankAccount: mockDecrypt,
}));
vi.mock("@/lib/suppliers/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suppliers/mutations")>();
  return { ...actual, updateSupplier: mockUpdateSupplier };
});
vi.mock("@/lib/audit", () => ({ logBankAccountView: mockLogView }));
vi.mock("@/lib/rbac", () => ({
  requirePermission: vi.fn(),
  PERMISSIONS: {},
}));

import { POST, PUT } from "./route";

const call = (pin: string) =>
  POST(
    new Request("http://localhost/api/suppliers/s1", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }) as never,
    { params: Promise.resolve({ id: "s1" }) }
  );

describe("POST /api/suppliers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } });
    mockFindUnique.mockResolvedValue({ bankAccountEnc: "enc" });
    mockDecrypt.mockReturnValue("1234567890");
  });

  it("refuses a wrong PIN and decrypts nothing", async () => {
    mockVerifyPin.mockResolvedValue({ success: false, messageKey: "invalidPin" });
    const res = await call("0000");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalidPin" });
    expect(mockVerifyPin).toHaveBeenCalledWith(
      "u1",
      "0000",
      "VIEW_BANK_ACCOUNT",
      expect.objectContaining({ ipAddress: expect.any(String) })
    );
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockLogView).not.toHaveBeenCalled();
  });

  it("decrypts and audits on the right PIN", async () => {
    mockVerifyPin.mockResolvedValue({ success: true });
    const res = await call("1234");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bankAccount: "1234567890" });
    expect(mockLogView).toHaveBeenCalledTimes(1);
  });
});

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/suppliers/s1", {
      method: "PUT",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "s1" }) }
  );

describe("PUT /api/suppliers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
  });

  it("applies the shared payment-terms rule instead of stripping the key", async () => {
    const res = await put({ paymentTermsDays: 400 });
    expect(res.status).toBe(400);
    expect(mockUpdateSupplier).not.toHaveBeenCalled();
  });

  it("passes the parsed payload to updateSupplier, terms included", async () => {
    mockUpdateSupplier.mockResolvedValue({ id: "s1" });
    const res = await put({ name: "Acme", paymentTermsDays: 30 });
    expect(res.status).toBe(200);
    expect(mockUpdateSupplier).toHaveBeenCalledWith("s1", {
      name: "Acme",
      paymentTermsDays: 30,
    });
  });

  it("maps a duplicate code to 400", async () => {
    mockUpdateSupplier.mockRejectedValue(new Error("Supplier code already exists"));
    const res = await put({ code: "X1" });
    expect(res.status).toBe(400);
  });
});
