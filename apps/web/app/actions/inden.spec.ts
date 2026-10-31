import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: auth, penulis, dan basis data ditirukan. Yang dipasak:
 * - aksi pre-order menolak tanpa izin `field_sales_orders:approve` dan id rusak,
 *   tanpa memanggil penulis;
 * - pengiriman pesanan pre-order yang belum dirilis sampai ke layar sebagai
 *   alasannya sendiri (INDEN_BELUM_RILIS), bukan lemparan yang disamarkan digest.
 */
const { mockAuth, mockSimpan, mockRilis, mockRecord } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSimpan: vi.fn(),
  mockRilis: vi.fn(),
  mockRecord: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/inden-writer", () => ({ simpanJendelaInden: mockSimpan, rilisJendelaInden: mockRilis }));
vi.mock("@/lib/field-sales/delivery/writer", () => ({ recordFieldSalesDelivery: mockRecord, closeFieldSalesOrderRemainder: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: {}, kabariPengguna: vi.fn() }));
vi.mock("./audit", () => ({ logPrint: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: { fieldSalesDelivery: { findUnique: vi.fn().mockResolvedValue(null) } },
}));

import { rilisJendelaIndenAction, simpanJendelaIndenAction } from "./inden";
import { recordDeliveryAction } from "./field-sales-deliveries";
import { IndenBelumRilisError } from "@/lib/field-sales/inden";

const sesi = (permissions: string[]) => ({ user: { id: "u1", permissions } });

describe("aksi pre-order", () => {
  beforeEach(() => {
    mockSimpan.mockReset().mockResolvedValue({ ok: true, id: "w1" });
    mockRilis.mockReset().mockResolvedValue({ ok: true, sudahDirilis: false, pesanan: 1, baris: 1, oversell: [] });
  });

  it("tanpa izin menyetujui pesanan: ditolak, penulis tidak dipanggil", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:view"]));
    expect(await rilisJendelaIndenAction("w1")).toEqual({ ok: false, kode: "TANPA_IZIN" });
    expect(await simpanJendelaIndenAction({ name: "x", opensOn: "", closesOn: "", items: [] })).toEqual({ ok: false, kode: "TANPA_IZIN" });
    expect(mockRilis).not.toHaveBeenCalled();
    expect(mockSimpan).not.toHaveBeenCalled();
  });

  it("id rusak dianggap tidak ada", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:approve"]));
    expect(await rilisJendelaIndenAction("a b")).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(await rilisJendelaIndenAction(42)).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(await simpanJendelaIndenAction({ id: "x y", name: "x", opensOn: "", closesOn: "", items: [] })).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(mockRilis).not.toHaveBeenCalled();
    expect(mockSimpan).not.toHaveBeenCalled();
  });

  it("dengan izin: meneruskan ke penulis atas nama pengguna yang masuk", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:approve"]));
    expect(await rilisJendelaIndenAction("w1")).toMatchObject({ ok: true, pesanan: 1 });
    expect(mockRilis).toHaveBeenCalledWith({ id: "w1", userId: "u1" });
    await simpanJendelaIndenAction({ name: "Lebaran", opensOn: "2026-10-01", closesOn: "2026-10-15", items: [{ itemId: "i1", plannedQty: null }] });
    expect(mockSimpan).toHaveBeenCalledWith(expect.objectContaining({ id: undefined, userId: "u1", isian: expect.objectContaining({ name: "Lebaran" }) }));
  });
});

describe("recordDeliveryAction — pre-order belum dirilis", () => {
  it("memetakan IndenBelumRilisError ke INDEN_BELUM_RILIS", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:deliver"]));
    mockRecord.mockReset().mockRejectedValue(new IndenBelumRilisError("o1"));
    const r = await recordDeliveryAction({
      orderId: "o1",
      lines: [{ orderLineId: "l1", qty: 1 }],
      invoiceDate: "2026-10-01",
      dueDate: "2026-10-31",
      idempotencyKey: "k1",
    });
    expect(r).toEqual({ ok: false, reason: "INDEN_BELUM_RILIS" });
  });
});
