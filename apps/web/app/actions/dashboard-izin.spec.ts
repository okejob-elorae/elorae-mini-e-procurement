import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar aksi beranda (`app/actions/dashboard.ts`). Setiap ekspor `"use server"`
 * adalah titik akhir yang bisa dipanggil siapa pun yang sudah masuk — dulu lima
 * aksi ini tidak memeriksa apa pun, dan tren penjualan hanya memeriksa sesi,
 * jadi akun salesman/SPG bisa membaca angka penjualan, HPP, dan pemasok.
 * Tanpa basis data: kuerinya ditiru, dan yang dihitung adalah apakah kueri
 * sempat berjalan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dibaca: 0,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));

vi.mock("@/lib/dashboard/queries", () => {
  const baca = <T,>(nilai: T) =>
    vi.fn(async () => {
      state.dibaca += 1;
      return nilai;
    });
  return {
    getDashboardStats: baca({ po: { draft: 0 } }),
    getRawMaterialShortage: baca([]),
    getWorkOrderCountByStatus: baca([]),
    getCOGSRawVsFinished: baca({}),
    getSuppliersForReportFilter: baca([]),
    getTrenPenjualanRentang: baca([]),
  };
});

const aksi = await import("./dashboard");

const LEMPAR: Array<[string, () => Promise<unknown>]> = [
  ["getDashboardStats", () => aksi.getDashboardStats()],
  ["getRawMaterialShortage", () => aksi.getRawMaterialShortage()],
  ["getWorkOrderCountByStatus", () => aksi.getWorkOrderCountByStatus()],
  ["getCOGSRawVsFinished", () => aksi.getCOGSRawVsFinished()],
  ["getSuppliersForReportFilter", () => aksi.getSuppliersForReportFilter()],
];

/** Bukan orang kantor yang membuka beranda. */
const LUAR: Array<[string, string[]]> = [
  ["salesman", ["pwa:access"]],
  ["SPG", ["pwa:access", "spg_sales:record"]],
  ["tanpa izin", []],
];

beforeEach(() => {
  state.sesi = null;
  state.dibaca = 0;
});

describe("aksi beranda — pagar dashboard:view", () => {
  it.each(LEMPAR)("%s menolak tanpa sesi sebelum membaca data", async (_n, panggil) => {
    await expect(panggil()).rejects.toThrow(/Unauthorized/);
    expect(state.dibaca).toBe(0);
  });

  for (const [peran, izin] of LUAR) {
    it.each(LEMPAR)(`%s menolak ${peran} sebelum membaca data`, async (_n, panggil) => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(panggil()).rejects.toThrow(/Forbidden/);
      expect(state.dibaca).toBe(0);
    });
  }

  for (const izin of [["dashboard:view"], ["*"]]) {
    it.each(LEMPAR)(`%s tetap boleh untuk ${izin.join("+")}`, async (_n, panggil) => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(panggil()).resolves.toBeDefined();
      expect(state.dibaca).toBe(1);
    });
  }
});

describe("ambilTrenPenjualanRentang — kode, bukan lemparan", () => {
  it("tanpa sesi → UNAUTHENTICATED", async () => {
    await expect(aksi.ambilTrenPenjualanRentang("2026-09-01", "2026-09-07")).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(state.dibaca).toBe(0);
  });

  for (const [peran, izin] of LUAR) {
    it(`${peran} → FORBIDDEN tanpa membaca penjualan`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(aksi.ambilTrenPenjualanRentang("2026-09-01", "2026-09-07")).resolves.toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(state.dibaca).toBe(0);
    });
  }

  for (const izin of [["dashboard:view"], ["*"]]) {
    it(`${izin.join("+")} tetap mendapat tren`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(aksi.ambilTrenPenjualanRentang("2026-09-01", "2026-09-07")).resolves.toEqual({
        ok: true,
        tren: [],
      });
      expect(state.dibaca).toBe(1);
    });
  }
});
