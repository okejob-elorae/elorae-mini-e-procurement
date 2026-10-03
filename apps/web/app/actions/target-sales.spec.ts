import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unit saja: auth dan penulis ditirukan. Yang dipasak: mengubah target butuh
 * `field_sales_orders:approve` (melihat saja tidak cukup) dan penulis tidak
 * dipanggil tanpa izin; penulis dipanggil atas nama pengguna yang masuk, bukan
 * id kiriman klien; kode penolakan penulis sampai ke layar sebagai `code`.
 */
const { mockAuth, mockSimpan, mockSalin } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSimpan: vi.fn(),
  mockSalin: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/salesman/target-rinci-writer", () => ({
  simpanTargetRinci: mockSimpan,
  salinTargetBulanLalu: mockSalin,
}));

import { salinTargetSalesAction, simpanTargetSalesAction } from "./target-sales";

const sesi = (permissions: string[]) => ({ user: { id: "u1", permissions } });
const masukan = { salesmanId: "s1", bulan: "2026-10", baris: [{ scope: "KATEGORI", refId: "k1", measure: "PCS", value: 5 }] };

describe("aksi target sales", () => {
  beforeEach(() => {
    mockSimpan.mockReset().mockResolvedValue({ ok: true, jumlah: 1, berubah: true });
    mockSalin.mockReset().mockResolvedValue({ ok: true, jumlah: 2, dibuang: 0 });
  });

  it("belum masuk: UNAUTHORIZED", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await simpanTargetSalesAction(masukan)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(mockSimpan).not.toHaveBeenCalled();
  });

  it("hanya boleh melihat: FORBIDDEN, penulis tidak dipanggil", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:view"]));
    expect(await simpanTargetSalesAction(masukan)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await salinTargetSalesAction({ salesmanId: "s1", bulan: "2026-10" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mockSimpan).not.toHaveBeenCalled();
    expect(mockSalin).not.toHaveBeenCalled();
  });

  it("dengan izin: penulis dipanggil atas nama pengguna yang masuk", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:approve"]));
    expect(await simpanTargetSalesAction({ ...masukan, olehUserId: "penyusup" })).toEqual({ ok: true, jumlah: 1, berubah: true });
    expect(mockSimpan).toHaveBeenCalledWith({ salesmanId: "s1", bulan: "2026-10", baris: masukan.baris, olehUserId: "u1" });

    expect(await salinTargetSalesAction({ salesmanId: "s1", bulan: "2026-10", timpa: true })).toEqual({
      ok: true,
      jumlah: 2,
      dibuang: 0,
    });
    expect(mockSalin).toHaveBeenCalledWith({ salesmanId: "s1", bulan: "2026-10", olehUserId: "u1", timpa: true });
  });

  it("timpa hanya bila benar-benar true", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:approve"]));
    await salinTargetSalesAction({ salesmanId: "s1", bulan: "2026-10", timpa: "ya" });
    expect(mockSalin).toHaveBeenCalledWith(expect.objectContaining({ timpa: false }));
  });

  it("id sales rusak tidak sampai ke penulis", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:approve"]));
    expect(await simpanTargetSalesAction({ ...masukan, salesmanId: "a b" })).toEqual({
      ok: false,
      code: "SALESMAN_TIDAK_DIKENAL",
    });
    expect(await simpanTargetSalesAction(null)).toEqual({ ok: false, code: "SALESMAN_TIDAK_DIKENAL" });
    expect(mockSimpan).not.toHaveBeenCalled();
  });

  it("penolakan penulis diteruskan sebagai code, berikut indeks barisnya", async () => {
    mockAuth.mockResolvedValue(sesi(["field_sales_orders:approve"]));
    mockSimpan.mockResolvedValue({ ok: false, kode: "ACUAN_TIDAK_DIKENAL", indeks: 3 });
    expect(await simpanTargetSalesAction(masukan)).toEqual({ ok: false, code: "ACUAN_TIDAK_DIKENAL", indeks: 3 });
    mockSalin.mockResolvedValue({ ok: false, kode: "SUDAH_ADA" });
    expect(await salinTargetSalesAction({ salesmanId: "s1", bulan: "2026-10" })).toEqual({ ok: false, code: "SUDAH_ADA" });
  });
});
