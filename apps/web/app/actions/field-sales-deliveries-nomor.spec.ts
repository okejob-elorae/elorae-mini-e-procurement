import { describe, it, expect, vi } from "vitest";

/*
 * Unit: penulis ditirukan. Nomor nota yang sudah dipegang piutang lain sampai ke layar sebagai
 * alasannya sendiri, bukan lemparan yang disamarkan digest di produksi.
 */
const { mockAuth, mockRecord } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockRecord: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Tiruan modul penulis sengaja TIDAK membawa kelas galatnya — aksi harus mengenali galat dari namanya.
vi.mock("@/lib/field-sales/delivery/writer", () => ({ recordFieldSalesDelivery: mockRecord, closeFieldSalesOrderRemainder: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: {}, kabariPengguna: vi.fn() }));
vi.mock("./audit", () => ({ logPrint: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: { fieldSalesDelivery: { findUnique: vi.fn().mockResolvedValue(null) } },
}));

import { recordDeliveryAction } from "./field-sales-deliveries";

const isian = {
  orderId: "o1",
  lines: [{ orderLineId: "l1", qty: 1 }],
  invoiceDate: "2026-10-05",
  dueDate: "2026-11-04",
  idempotencyKey: "kunci-1",
};

describe("recordDeliveryAction — nomor nota sudah dipakai piutang lain", () => {
  it("menjadi alasan NOMOR_PIUTANG_DIPAKAI yang menyebut nomornya", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["field_sales_orders:deliver"] } });
    const galat = Object.assign(new Error("Nomor DLV/2026/10/0001 sudah dipakai piutang r1"), {
      name: "NomorPiutangDipakaiError",
      invoiceNo: "DLV/2026/10/0001",
      receivableId: "r1",
    });
    mockRecord.mockRejectedValueOnce(galat);

    expect(await recordDeliveryAction(isian)).toEqual({ ok: false, reason: "NOMOR_PIUTANG_DIPAKAI", invoiceNo: "DLV/2026/10/0001" });
  });

  it("galat lain tetap dilempar, tidak ditelan", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["field_sales_orders:deliver"] } });
    mockRecord.mockRejectedValueOnce(new Error("koneksi putus"));
    await expect(recordDeliveryAction(isian)).rejects.toThrow("koneksi putus");
  });
});
