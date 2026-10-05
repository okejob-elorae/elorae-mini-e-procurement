import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * API pemasok per id — disamakan dengan aksinya (`app/actions/suppliers.ts`).
 *
 * Dulu DELETE menghapus pemasok cukup dengan `suppliers:delete` tanpa PIN, dan
 * POST membuka nomor rekening lewat `verifyPin` dari `lib/auth.ts` yang tidak
 * punya batas percobaan — jalan menebak PIN tanpa batas, tanpa izin apa pun.
 * Kini: izin yang sama dengan `deleteSupplierAction` / `decryptSupplierBankAction`,
 * dan PIN selalu lewat `verifyPinForAction` (dibatasi tiga salah per 15 menit).
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.ada ? { user: { id: "pengguna-1", permissions: sesi.permissions } } : null)),
}));

const pin = vi.hoisted(() => ({ verifyPinForAction: vi.fn() }));
vi.mock("@/app/actions/security/pin-auth", () => pin);

const mutasi = vi.hoisted(() => ({
  SUPPLIER_DELETE_BLOCKED: "SUPPLIER_DELETE_BLOCKED",
  deleteSupplier: vi.fn(async () => undefined),
  decryptSupplierBankAccount: vi.fn(async () => "1234567890"),
}));
vi.mock("@/lib/suppliers/mutations", () => mutasi);

const db = vi.hoisted(() => ({
  prisma: { supplier: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@elorae/db", () => db);
vi.mock("@/lib/encryption", () => ({ encryptBankAccount: vi.fn(() => "enc"), decryptBankAccount: vi.fn(() => "x") }));
vi.mock("@/lib/audit", () => ({ logBankAccountView: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { GET, DELETE, POST } = await import("./route");

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
  pin.verifyPinForAction.mockResolvedValue({ success: true, messageKey: "ok", userId: "pengguna-1" });
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
    expect(pin.verifyPinForAction).not.toHaveBeenCalled();
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
    pin.verifyPinForAction.mockResolvedValue({ success: false, messageKey: "pinIncorrect" });
    const res = await DELETE(permintaan("DELETE", { pin: "9999" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pinIncorrect" });
    expect(mutasi.deleteSupplier).not.toHaveBeenCalled();
  });

  it("PIN terkunci → 429 dan tidak menghapus", async () => {
    sesi.permissions = ["suppliers:delete"];
    pin.verifyPinForAction.mockResolvedValue({ success: false, messageKey: "tooManyAttempts" });
    const res = await DELETE(permintaan("DELETE", { pin: "9999" }), params);
    expect(res.status).toBe(429);
    expect(mutasi.deleteSupplier).not.toHaveBeenCalled();
  });

  it("PIN benar → dihapus; PIN diperiksa sebagai DELETE_SUPPLIER milik pengguna sesi", async () => {
    sesi.permissions = ["suppliers:delete"];
    const res = await DELETE(permintaan("DELETE", { pin: "1234" }), params);
    expect(res.status).toBe(200);
    expect(pin.verifyPinForAction).toHaveBeenCalledWith("pengguna-1", "1234", "DELETE_SUPPLIER", undefined, "10.0.0.7");
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
    expect(pin.verifyPinForAction).not.toHaveBeenCalled();
    expect(mutasi.decryptSupplierBankAccount).not.toHaveBeenCalled();
  });

  it("PIN salah → 403, rekening tidak dibuka", async () => {
    sesi.permissions = ["suppliers:view"];
    pin.verifyPinForAction.mockResolvedValue({ success: false, messageKey: "pinIncorrect" });
    const res = await POST(permintaan("POST", { pin: "0000" }), params);
    expect(res.status).toBe(403);
    expect(mutasi.decryptSupplierBankAccount).not.toHaveBeenCalled();
  });

  it("PIN terkunci → 429, rekening tidak dibuka", async () => {
    sesi.permissions = ["suppliers:view"];
    pin.verifyPinForAction.mockResolvedValue({ success: false, messageKey: "tooManyAttempts" });
    const res = await POST(permintaan("POST", { pin: "0000" }), params);
    expect(res.status).toBe(429);
    expect(mutasi.decryptSupplierBankAccount).not.toHaveBeenCalled();
  });

  it("PIN benar → rekening dibuka lewat penjaga terbatas, dengan IP dan agen untuk jejak", async () => {
    sesi.permissions = ["suppliers:view"];
    const res = await POST(permintaan("POST", { pin: "1234" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bankAccount: "1234567890" });
    expect(pin.verifyPinForAction).toHaveBeenCalledWith(
      "pengguna-1",
      "1234",
      "VIEW_BANK_ACCOUNT",
      "User requested bank account view",
      "10.0.0.7",
    );
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
    expect(db.prisma.supplier.findUnique).not.toHaveBeenCalled();
  });
});
