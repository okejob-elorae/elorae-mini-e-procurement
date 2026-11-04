import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * POST /api/suppliers/[id]/decrypt — membuka nomor rekening pemasok.
 *
 * Rute ini dulu hanya memeriksa sesi, lalu PIN: siapa pun yang sudah masuk
 * (salesman, SPG) bisa membuka rekening pemasok mana pun dengan PIN-nya
 * sendiri, dan setiap percobaan menghabiskan jatah salah PIN. Pagarnya kini di
 * DALAM rute — `proxy.ts` bukan penjaga — dan izinnya diperiksa SEBELUM PIN,
 * sama dengan POST `/api/suppliers/[id]` dan `decryptSupplierBankAction`.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.ada ? { user: { id: "pengguna-1", permissions: sesi.permissions } } : null)),
}));

const pin = vi.hoisted(() => ({ verifyPinForAction: vi.fn() }));
vi.mock("@/app/actions/security/pin-auth", () => pin);

const db = vi.hoisted(() => ({ prisma: { supplier: { findUnique: vi.fn() } } }));
vi.mock("@elorae/db", () => db);
vi.mock("@/lib/encryption", () => ({ decryptBankAccount: vi.fn(() => "1234567890") }));
const audit = vi.hoisted(() => ({ logBankAccountView: vi.fn() }));
vi.mock("@/lib/audit", () => audit);

const { POST } = await import("./route");

const params = { params: Promise.resolve({ id: "pemasok-1" }) };
const permintaan = (body: unknown) =>
  new NextRequest("http://localhost/api/suppliers/pemasok-1/decrypt", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.7", "user-agent": "uji/1.0" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  sesi.ada = true;
  sesi.permissions = [];
  pin.verifyPinForAction.mockResolvedValue({ success: true, messageKey: "ok", userId: "pengguna-1" });
  db.prisma.supplier.findUnique.mockResolvedValue({ id: "pemasok-1", bankAccountEnc: "enc" });
});

describe("POST /api/suppliers/[id]/decrypt", () => {
  it("tanpa sesi → 401", async () => {
    sesi.ada = false;
    const res = await POST(permintaan({ pin: "1234" }), params);
    expect(res.status).toBe(401);
    expect(pin.verifyPinForAction).not.toHaveBeenCalled();
  });

  it("tanpa suppliers:view → 403, dan PIN tidak pernah diperiksa", async () => {
    sesi.permissions = ["pwa:access"];
    const res = await POST(permintaan({ pin: "1234" }), params);
    expect(res.status).toBe(403);
    expect(pin.verifyPinForAction).not.toHaveBeenCalled();
    expect(db.prisma.supplier.findUnique).not.toHaveBeenCalled();
    expect(audit.logBankAccountView).not.toHaveBeenCalled();
  });

  it("dengan suppliers:view dan PIN benar → nomor rekening, dan dicatat", async () => {
    sesi.permissions = ["suppliers:view"];
    const res = await POST(permintaan({ pin: "1234" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bankAccount: "1234567890" });
    expect(pin.verifyPinForAction).toHaveBeenCalledTimes(1);
    expect(audit.logBankAccountView).toHaveBeenCalledTimes(1);
  });

  it("dengan suppliers:view tapi PIN salah → 403 tanpa membuka rekening", async () => {
    sesi.permissions = ["suppliers:view"];
    pin.verifyPinForAction.mockResolvedValue({ success: false, messageKey: "pinSalah" });
    const res = await POST(permintaan({ pin: "9999" }), params);
    expect(res.status).toBe(403);
    expect(db.prisma.supplier.findUnique).not.toHaveBeenCalled();
  });
});
