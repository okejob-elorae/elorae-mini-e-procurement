import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockRevalidate, mockTambah, mockHex } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRevalidate: vi.fn(),
  mockTambah: vi.fn(),
  mockHex: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/purchase-orders/varian-warna-writer", () => ({ tambahVarianWarna: mockTambah, hexPantone: mockHex }));

import { hexPantoneAction, tambahVarianWarnaBahanAction } from "./po-varian-warna";

describe("tambahVarianWarnaBahanAction", () => {
  beforeEach(() => {
    for (const m of [mockAuth, mockRevalidate, mockTambah, mockHex]) m.mockReset();
  });

  it("butuh sesi dan izin membuat/mengubah PO atau mengelola barang", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await tambahVarianWarnaBahanAction("i1", { warna: "Hitam" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:view", "items:view"] } });
    expect(await tambahVarianWarnaBahanAction("i1", { warna: "Hitam" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(mockTambah).not.toHaveBeenCalled();
  });

  it("pengguna dari sesi; hasil penulis diteruskan", async () => {
    for (const izin of ["purchase_orders:create", "purchase_orders:edit", "items:manage"]) {
      mockAuth.mockResolvedValue({ user: { id: "u9", permissions: [izin] } });
      mockTambah.mockResolvedValue({ ok: false, kode: "BARANG_JADI" });
      expect(await tambahVarianWarnaBahanAction(" i1 ", { warna: "Hitam", pantone: "19-4005 TCX" })).toEqual({ ok: false, kode: "BARANG_JADI" });
      expect(mockTambah).toHaveBeenLastCalledWith({ itemId: "i1", warna: "Hitam", pantone: "19-4005 TCX", userId: "u9" });
    }
    expect(mockRevalidate).not.toHaveBeenCalled();
    mockTambah.mockResolvedValue({ ok: true, varian: { sku: "S" }, variants: [] });
    await tambahVarianWarnaBahanAction("i1", { warna: "Hitam" });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/items/i1");
  });

  it("menolak isian yang bukan teks atau terlalu panjang", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:create"] } });
    expect(await tambahVarianWarnaBahanAction("", { warna: "Hitam" })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
    expect(await tambahVarianWarnaBahanAction("i1", { warna: "x".repeat(200) })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
    expect(mockTambah).not.toHaveBeenCalled();
  });
});

describe("hexPantoneAction", () => {
  it("tanpa sesi → kosong; dengan sesi meneruskan kode teks saja", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await hexPantoneAction(["19-4005"])).toEqual({});
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
    mockHex.mockResolvedValue({ "19-4005": "#111111" });
    expect(await hexPantoneAction(["19-4005", 7 as never])).toEqual({ "19-4005": "#111111" });
    expect(mockHex).toHaveBeenCalledWith(["19-4005"]);
  });
});
