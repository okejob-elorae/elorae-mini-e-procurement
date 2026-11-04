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
    getDashboardStats: baca({
      po: { draft: 2, submitted: 5, inProduction: 1, thisWeek: 3, overdue: 1, totalValue: 245_000_000 },
      workOrders: { inProduction: 1, completedToday: 0 },
      items: { activeCount: 120, lowStockCount: 3 },
      suppliers: { activeCount: 4 },
      inventory: { totalValue: 60_500_000 },
      grnsThisWeek: 1,
      movementsToday: 7,
    }),
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

/*
 * Aksi statistik mengembalikan bentuk yang sama dengan yang dikirim halaman
 * beranda (`statistikBeranda`): nilai persediaan Rp 60.500.000 dan nilai PO
 * Rp 245.000.000 tidak digambar di mana pun, jadi tidak keluar lewat aksi.
 */
describe("getDashboardStats — tanpa nilai rupiah yang tidak digambar", () => {
  for (const izin of [["dashboard:view"], ["dashboard:view", "inventory:view"], ["*"]]) {
    it(`${izin.join("+")}: tanpa nilai persediaan dan nilai PO`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      const hasil = JSON.stringify(await aksi.getDashboardStats());
      expect(hasil).not.toContain("60500000");
      expect(hasil).not.toContain("245000000");
      expect(hasil).not.toContain("totalValue");
    });
  }

  it("hitungan stok menipis hanya untuk pemegang inventory:view", async () => {
    state.sesi = { user: { id: "u1", permissions: ["dashboard:view"] } };
    expect((await aksi.getDashboardStats()).items).toBeNull();
    state.sesi = { user: { id: "u1", permissions: ["dashboard:view", "inventory:view"] } };
    expect((await aksi.getDashboardStats()).items).toEqual({ lowStockCount: 3 });
  });
});

/*
 * Nilai persediaan mengikuti kartu stok beranda (`kartuBeranda`): orang
 * pembelian dan produksi membuka beranda tetapi tidak membaca nilai stok.
 */
describe("getCOGSRawVsFinished — butuh inventory:view selain beranda", () => {
  for (const izin of [["dashboard:view"], ["inventory:view"], ["pwa:access"]]) {
    it(`menolak ${izin.join("+")} sebelum membaca data`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(aksi.getCOGSRawVsFinished()).rejects.toThrow(/Forbidden/);
      expect(state.dibaca).toBe(0);
    });
  }

  for (const izin of [["dashboard:view", "inventory:view"], ["*"]]) {
    it(`boleh untuk ${izin.join("+")}`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(aksi.getCOGSRawVsFinished()).resolves.toBeDefined();
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

  // Grafiknya menggabungkan marketplace dan lapangan, jadi aturannya sama dengan kartu tren beranda.
  for (const izin of [
    ["dashboard:view"],
    ["dashboard:view", "sales_orders:view"],
    ["dashboard:view", "field_sales_orders:view"],
  ]) {
    it(`${izin.join("+")} → FORBIDDEN (tren semua saluran butuh kedua izin penjualan)`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(aksi.ambilTrenPenjualanRentang("2026-09-01", "2026-09-07")).resolves.toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(state.dibaca).toBe(0);
    });
  }

  for (const izin of [["dashboard:view", "sales_orders:view", "field_sales_orders:view"], ["*"]]) {
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
