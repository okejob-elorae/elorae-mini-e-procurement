import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar aksi laporan (`app/actions/reports/**`). Setiap ekspor `"use server"`
 * adalah titik akhir yang bisa dipanggil siapa pun yang sudah masuk — dulu
 * tidak satu pun memeriksa sesi, jadi akun salesman/SPG bisa menarik nilai
 * persediaan, harga PO, dan biaya bahan per vendor. Tanpa basis data: prisma
 * ditiru, dan yang dihitung adalah apakah kueri sempat berjalan.
 *
 * Nilai persediaan dan pembagian bahan baku/barang jadi juga dibaca halaman
 * Laporan, yang terbuka bagi pemegang `dashboard:view`, jadi untuk dua bacaan
 * itu `dashboard:view` ikut sah. Ekspornya tetap butuh `inventory:view`.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dibaca: 0,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));

vi.mock("@elorae/db", () => {
  const metode = () =>
    vi.fn(async () => {
      state.dibaca += 1;
      return [];
    });
  const model = new Proxy({}, { get: () => metode() });
  return { prisma: new Proxy({}, { get: () => model }) };
});

const pengadaan = await import("./procurement");
const produksi = await import("./production");
const persediaan = await import("./inventory");
const indeks = await import("./index");

type Kasus = [nama: string, izinSah: string[], panggil: () => Promise<unknown>];

const KASUS: Kasus[] = [
  ["getProcurementReport", ["purchase_orders:view"], () => pengadaan.getProcurementReport()],
  ["exportProcurementReport", ["purchase_orders:view"], () => pengadaan.exportProcurementReport(undefined, "csv")],
  [
    "getVendorPerformanceReport",
    ["work_orders:view"],
    () => produksi.getVendorPerformanceReport("v1", new Date("2026-09-01"), new Date("2026-09-30")),
  ],
  [
    "exportVendorPerformanceReport",
    ["work_orders:view"],
    () => produksi.exportVendorPerformanceReport("v1", new Date("2026-09-01"), new Date("2026-09-30"), "csv"),
  ],
  ["getInventoryValueSnapshot", ["inventory:view", "dashboard:view"], () => persediaan.getInventoryValueSnapshot()],
  ["getCOGSRawVsFinished", ["inventory:view", "dashboard:view"], () => persediaan.getCOGSRawVsFinished()],
  ["exportInventorySnapshotReport", ["inventory:view"], () => persediaan.exportInventorySnapshotReport("csv")],
  ["getSuppliersForReportFilter", ["dashboard:view", "suppliers:view"], () => indeks.getSuppliersForReportFilter()],
];

/** Setiap pasangan (aksi, satu izin sahnya): masing-masing izin harus cukup sendirian. */
const PEMEGANG_SAH: Array<[nama: string, izin: string, panggil: () => Promise<unknown>]> = KASUS.flatMap(
  ([nama, izinSah, panggil]) => izinSah.map((izin): [string, string, () => Promise<unknown>] => [nama, izin, panggil]),
);

/** Bukan pembaca sah laporan itu. `dashboard:view` saja hanya cukup di aksi yang mencantumkannya. */
const LUAR: Array<[string, string[]]> = [
  ["salesman", ["pwa:access"]],
  ["SPG", ["pwa:access", "spg_sales:record"]],
  ["tanpa izin", []],
];

beforeEach(() => {
  state.sesi = null;
  state.dibaca = 0;
});

async function galatDari(panggil: () => Promise<unknown>): Promise<string | null> {
  try {
    await panggil();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("aksi laporan — pagar per izin", () => {
  it.each(KASUS)("%s menolak tanpa sesi sebelum membaca data", async (_n, _izin, panggil) => {
    await expect(panggil()).rejects.toThrow(/Unauthorized/);
    expect(state.dibaca).toBe(0);
  });

  for (const [peran, izin] of LUAR) {
    it.each(KASUS)(`%s menolak ${peran} sebelum membaca data`, async (_n, _izin, panggil) => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(panggil()).rejects.toThrow(/Forbidden/);
      expect(state.dibaca).toBe(0);
    });
  }

  it.each(KASUS.filter(([, izinSah]) => !izinSah.includes("dashboard:view")))(
    "%s menolak pemegang dashboard:view saja (laporan rinci butuh izin modulnya)",
    async (_n, _izin, panggil) => {
      state.sesi = { user: { id: "u1", permissions: ["dashboard:view"] } };
      await expect(panggil()).rejects.toThrow(/Forbidden/);
      expect(state.dibaca).toBe(0);
    },
  );

  it.each(PEMEGANG_SAH)("%s tetap boleh untuk pemegang %s saja", async (_n, izin, panggil) => {
    state.sesi = { user: { id: "u1", permissions: [izin] } };
    const galat = await galatDari(panggil);
    expect(galat ?? "").not.toMatch(/Unauthorized|Forbidden/);
    expect(state.dibaca).toBeGreaterThan(0);
  });

  it.each(KASUS)("%s tetap boleh untuk admin (*)", async (_n, _izin, panggil) => {
    state.sesi = { user: { id: "u1", permissions: ["*"] } };
    const galat = await galatDari(panggil);
    expect(galat ?? "").not.toMatch(/Unauthorized|Forbidden/);
    expect(state.dibaca).toBeGreaterThan(0);
  });
});
