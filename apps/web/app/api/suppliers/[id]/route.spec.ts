import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * API pemasok per id — disamakan dengan aksinya (`app/actions/suppliers.ts`).
 *
 * Dulu DELETE menghapus pemasok cukup dengan `suppliers:delete` tanpa PIN.
 * Kini: izin yang sama dengan `deleteSupplierAction` / `decryptSupplierBankAction`,
 * dan PIN selalu lewat `verifyPin` yang dibatasi percobaannya.
 */

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

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));

const mutasi = vi.hoisted(() => ({
  deleteSupplier: vi.fn(async () => undefined),
  decryptSupplierBankAccount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/security/pin", () => ({ verifyPin: mockVerifyPin }));
vi.mock("@elorae/db", () => ({
  prisma: { supplier: { findUnique: mockFindUnique, findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/encryption", () => ({
  encryptBankAccount: vi.fn(() => "enc"),
  decryptBankAccount: mockDecrypt,
}));
vi.mock("@/lib/suppliers/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suppliers/mutations")>();
  mutasi.decryptSupplierBankAccount.mockImplementation(actual.decryptSupplierBankAccount);
  return {
    ...actual,
    updateSupplier: mockUpdateSupplier,
    deleteSupplier: mutasi.deleteSupplier,
    decryptSupplierBankAccount: mutasi.decryptSupplierBankAccount,
  };
});
vi.mock("@/lib/audit", () => ({ logBankAccountView: mockLogView }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { DELETE, GET, POST, PUT } from "./route";

const params = { params: Promise.resolve({ id: "pemasok-1" }) };
const permintaan = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/suppliers/pemasok-1", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.7", "user-agent": "uji/1.0" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  sesi.ada = true;
  sesi.permissions = [];
  mockAuth.mockImplementation(async () =>
    sesi.ada ? { user: { id: "pengguna-1", permissions: sesi.permissions } } : null,
  );
  mockVerifyPin.mockResolvedValue({ success: true, messageKey: "ok", userId: "pengguna-1" });
  mockFindUnique.mockResolvedValue({ bankAccountEnc: "enc" });
  mockDecrypt.mockReturnValue("1234567890");
});

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
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "u1@example.com", permissions: ["*"] } });
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

describe("DELETE /api/suppliers/[id]", () => {
  it("tanpa sesi → 401", async () => {
    sesi.ada = false;
    const res = await DELETE(permintaan("DELETE", { pin: "1234" }), params);
    expect(res.status).toBe(401);
    expect(mutasi.deleteSupplier).not.toHaveBeenCalled();
  });

  it("tanpa suppliers:delete → 403, PIN tidak ditebak, tidak ada yang dihapus", async () => {
    sesi.permissions = ["suppliers:view"];
    const res = await DELETE(permintaan("DELETE", { pin: "1234" }), params);
    expect(res.status).toBe(403);
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(mutasi.deleteSupplier).not.toHaveBeenCalled();
  });

  it("tanpa PIN → 400 dan tidak menghapus", async () => {
    sesi.permissions = ["suppliers:delete"];
    const res = await DELETE(permintaan("DELETE"), params);
    expect(res.status).toBe(400);
    expect(mutasi.deleteSupplier).not.toHaveBeenCalled();
  });

  it("PIN salah → 403 dan tidak menghapus", async () => {
    sesi.permissions = ["suppliers:delete"];
    mockVerifyPin.mockResolvedValue({ success: false, messageKey: "pinIncorrect" });
    const res = await DELETE(permintaan("DELETE", { pin: "9999" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pinIncorrect" });
    expect(mutasi.deleteSupplier).not.toHaveBeenCalled();
  });

  it("PIN terkunci → 429 dan tidak menghapus", async () => {
    sesi.permissions = ["suppliers:delete"];
    mockVerifyPin.mockResolvedValue({ success: false, messageKey: "tooManyAttempts" });
    const res = await DELETE(permintaan("DELETE", { pin: "9999" }), params);
    expect(res.status).toBe(429);
    expect(mutasi.deleteSupplier).not.toHaveBeenCalled();
  });

  it("PIN benar → dihapus; PIN diperiksa sebagai DELETE_SUPPLIER milik pengguna sesi", async () => {
    sesi.permissions = ["suppliers:delete"];
    const res = await DELETE(permintaan("DELETE", { pin: "1234" }), params);
    expect(res.status).toBe(200);
    expect(mockVerifyPin).toHaveBeenCalledWith("pengguna-1", "1234", "DELETE_SUPPLIER", { ipAddress: "10.0.0.7" });
    expect(mutasi.deleteSupplier).toHaveBeenCalledWith("pemasok-1");
  });

  it("pemasok yang masih dipakai → 400", async () => {
    sesi.permissions = ["suppliers:delete"];
    mutasi.deleteSupplier.mockRejectedValueOnce(new Error("SUPPLIER_DELETE_BLOCKED"));
    const res = await DELETE(permintaan("DELETE", { pin: "1234" }), params);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/suppliers/[id] (buka rekening)", () => {
  it("tanpa suppliers:view → 403 dan tidak ada tebakan PIN yang dihitung", async () => {
    sesi.permissions = ["pwa:access"];
    const res = await POST(permintaan("POST", { pin: "1234" }), params);
    expect(res.status).toBe(403);
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(mutasi.decryptSupplierBankAccount).not.toHaveBeenCalled();
  });

  it("PIN salah → 403, rekening tidak dibuka", async () => {
    sesi.permissions = ["suppliers:view"];
    mockVerifyPin.mockResolvedValue({ success: false, messageKey: "pinIncorrect" });
    const res = await POST(permintaan("POST", { pin: "0000" }), params);
    expect(res.status).toBe(403);
    expect(mutasi.decryptSupplierBankAccount).not.toHaveBeenCalled();
  });

  it("PIN terkunci → 429, rekening tidak dibuka", async () => {
    sesi.permissions = ["suppliers:view"];
    mockVerifyPin.mockResolvedValue({ success: false, messageKey: "tooManyAttempts" });
    const res = await POST(permintaan("POST", { pin: "0000" }), params);
    expect(res.status).toBe(429);
    expect(mutasi.decryptSupplierBankAccount).not.toHaveBeenCalled();
  });

  it("PIN benar → rekening dibuka lewat penjaga terbatas, dengan IP dan agen untuk jejak", async () => {
    sesi.permissions = ["suppliers:view"];
    const res = await POST(permintaan("POST", { pin: "1234" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bankAccount: "1234567890" });
    expect(mockVerifyPin).toHaveBeenCalledWith("pengguna-1", "1234", "VIEW_BANK_ACCOUNT", {
      ipAddress: "10.0.0.7",
    });
    expect(mutasi.decryptSupplierBankAccount).toHaveBeenCalledWith("pemasok-1", "pengguna-1", {
      ip: "10.0.0.7",
      userAgent: "uji/1.0",
    });
  });

  it("rekening tidak ada → 404", async () => {
    sesi.permissions = ["suppliers:view"];
    mutasi.decryptSupplierBankAccount.mockRejectedValueOnce(new Error("Bank account not found"));
    const res = await POST(permintaan("POST", { pin: "1234" }), params);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/suppliers/[id]", () => {
  it("tanpa suppliers:view → 403 dan tidak membaca pemasok", async () => {
    sesi.permissions = ["pwa:access"];
    const res = await GET(permintaan("GET"), params);
    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
