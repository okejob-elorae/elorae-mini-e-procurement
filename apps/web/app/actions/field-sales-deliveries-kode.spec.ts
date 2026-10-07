import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unit: penulis ditirukan. Kode alasan yang sampai ke layar harus jujur:
 * - isian rusak (baris bukan bentuknya, alasan kosong) = INVALID_REQUEST, bukan
 *   "melebihi sisa" atau "tidak bisa dikirim dalam keadaan ini";
 * - cadangan yang sudah habis dikonsumsi = RESERVATION_MISMATCH, kode sendiri.
 */
const { mockAuth, mockRecord, mockClose } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockRecord: vi.fn(), mockClose: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Tiruan modul penulis tidak membawa kelas galatnya — aksi mengenali galat dari namanya.
vi.mock("@/lib/field-sales/delivery/writer", () => ({ recordFieldSalesDelivery: mockRecord, closeFieldSalesOrderRemainder: mockClose }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: {}, kabariPengguna: vi.fn() }));
vi.mock("@/lib/spg/pesanan-menuju-toko", () => ({ kabarkanKirimanBerangkat: vi.fn() }));
vi.mock("./audit", () => ({ logPrint: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: {
    fieldSalesDelivery: { findUnique: vi.fn().mockResolvedValue(null) },
    fieldSalesOrder: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { closeRemainderAction, recordDeliveryAction } from "./field-sales-deliveries";

const isian = {
  orderId: "o1",
  lines: [{ orderLineId: "l1", qty: 1 }],
  invoiceDate: "2026-10-06",
  dueDate: "2026-11-05",
  idempotencyKey: "kunci-1",
};

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: ["field_sales_orders:deliver"] } });
  mockRecord.mockReset().mockResolvedValue({ deliveryId: "d1", docNo: "DLV/2026/10/0001" });
  mockClose.mockReset().mockResolvedValue({ ok: true });
});

describe("recordDeliveryAction — isian rusak", () => {
  it.each([
    ["qty pecahan", [{ orderLineId: "l1", qty: 1.5 }]],
    ["qty nol", [{ orderLineId: "l1", qty: 0 }]],
    ["qty minus", [{ orderLineId: "l1", qty: -2 }]],
    ["orderLineId bukan teks", [{ orderLineId: 7, qty: 1 }]],
    ["baris bukan objek", [null]],
  ])("%s → INVALID_REQUEST, penulis tidak dipanggil", async (_n, lines) => {
    const r = await recordDeliveryAction({ ...isian, lines: lines as never });
    expect(r).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("lines bukan larik → INVALID_REQUEST", async () => {
    expect(await recordDeliveryAction({ ...isian, lines: "x" as never })).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });

  it("orderId kosong → INVALID_REQUEST", async () => {
    expect(await recordDeliveryAction({ ...isian, orderId: "" })).toEqual({ ok: false, reason: "INVALID_REQUEST" });
  });
});

describe("recordDeliveryAction — cadangan tidak cocok", () => {
  it("CadanganTidakCocokError → RESERVATION_MISMATCH", async () => {
    mockRecord.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "CadanganTidakCocokError", code: "RESERVATION_MISMATCH" }));
    expect(await recordDeliveryAction(isian)).toEqual({ ok: false, reason: "RESERVATION_MISMATCH" });
  });
});

describe("closeRemainderAction — alasan", () => {
  it("alasan kosong/spasi → INVALID_REQUEST tanpa menulis", async () => {
    expect(await closeRemainderAction("o1", "   ")).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("alasan bukan teks tidak melempar → INVALID_REQUEST", async () => {
    expect(await closeRemainderAction("o1", undefined as never)).toEqual({ ok: false, reason: "INVALID_REQUEST" });
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("alasan sah diteruskan dipangkas", async () => {
    expect(await closeRemainderAction("o1", "  Toko tutup  ")).toEqual({ ok: true });
    expect(mockClose).toHaveBeenCalledWith({ orderId: "o1", closedById: "u1", reason: "Toko tutup" });
  });
});
