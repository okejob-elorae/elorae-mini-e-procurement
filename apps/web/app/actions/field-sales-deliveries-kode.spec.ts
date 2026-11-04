import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unit: penulis ditirukan. Kode alasan yang sampai ke layar harus jujur: alasan kosong =
 * INVALID_REQUEST, bukan "tidak bisa dikirim dalam keadaan ini". ("Catat pengiriman" dihapus,
 * P44/P44a — nota hanya terbit saat pengiriman dibuat, jadi aksinya tidak ada lagi.)
 */
const { mockAuth, mockClose } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockClose: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Tiruan modul penulis tidak membawa kelas galatnya — aksi mengenali galat dari namanya.
vi.mock("@/lib/field-sales/delivery/writer", () => ({ closeFieldSalesOrderRemainder: mockClose }));
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

import { closeRemainderAction } from "./field-sales-deliveries";

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: ["field_sales_orders:deliver"] } });
  mockClose.mockReset().mockResolvedValue({ ok: true });
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
