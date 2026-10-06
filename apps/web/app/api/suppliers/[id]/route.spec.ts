import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockVerifyPin,
  mockFindUnique,
  mockDecrypt,
  mockLogView,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockVerifyPin: vi.fn(),
  mockFindUnique: vi.fn(),
  mockDecrypt: vi.fn(),
  mockLogView: vi.fn(),
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
vi.mock("@/lib/audit", () => ({ logBankAccountView: mockLogView }));
vi.mock("@/lib/rbac", () => ({
  requirePermission: vi.fn(),
  PERMISSIONS: {},
}));

import { POST } from "./route";

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
      expect.objectContaining({ fallbackEmail: "u1@example.com" })
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
