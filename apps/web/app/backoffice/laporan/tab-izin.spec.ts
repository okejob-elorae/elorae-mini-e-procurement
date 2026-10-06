import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac";
import { IZIN_TAB_LAPORAN, tabLaporanAktif, tabLaporanTerlihat } from "./tab-izin";

/*
 * Tab laporan per izin.
 *
 * Halaman laporan dibuka `dashboard:view`, tetapi aksi pengadaan, setoran CMT
 * (kinerja vendor), dan inventori kini menolak tanpa izin modulnya. Dulu tab
 * dan tombol "Tampilkan"-nya tetap tampil untuk semua pemegang beranda, jadi
 * orang yang tidak berhak menekan tombol yang pasti gagal.
 */

const WEB = resolve(__dirname, "../../..");

describe("tabLaporanTerlihat", () => {
  it("admin (*) melihat semua tab", () => {
    expect(tabLaporanTerlihat(["*"])).toEqual(["production", "overdue", "rp1", "rp2", "rp3"]);
  });

  it("hanya dashboard:view → produksi dan PO terlambat saja", () => {
    expect(tabLaporanTerlihat(["dashboard:view"])).toEqual(["production", "overdue"]);
    expect(tabLaporanTerlihat([])).toEqual(["production", "overdue"]);
  });

  it("tiap tab laporan berat mengikuti izin modulnya sendiri", () => {
    expect(tabLaporanTerlihat(["dashboard:view", "purchase_orders:view"])).toEqual(["production", "overdue", "rp1"]);
    expect(tabLaporanTerlihat(["dashboard:view", "work_orders:view"])).toEqual(["production", "overdue", "rp2"]);
    expect(tabLaporanTerlihat(["dashboard:view", "inventory:view"])).toEqual(["production", "overdue", "rp3"]);
  });
});

describe("tabLaporanAktif", () => {
  const terbatas = tabLaporanTerlihat(["dashboard:view"]);

  it("?tab= untuk tab yang tidak boleh dilihat jatuh ke Produksi", () => {
    expect(tabLaporanAktif("rp1", terbatas)).toBe("production");
    expect(tabLaporanAktif("rp3", terbatas)).toBe("production");
  });

  it("tab yang boleh dilihat dipakai apa adanya; nilai asing jatuh ke Produksi", () => {
    expect(tabLaporanAktif("overdue", terbatas)).toBe("overdue");
    expect(tabLaporanAktif("rp2", tabLaporanTerlihat(["work_orders:view"]))).toBe("rp2");
    expect(tabLaporanAktif("apa", terbatas)).toBe("production");
    expect(tabLaporanAktif(null, terbatas)).toBe("production");
  });
});

/** Kode izin yang dipakai `wajibIzinLaporan` di fungsi `nama` berkas aksi. */
function izinAksi(berkas: string, nama: string): string {
  const sumber = readFileSync(join(WEB, "app/actions/reports", berkas), "utf8");
  const awal = sumber.indexOf(`export async function ${nama}(`);
  if (awal < 0) throw new Error(`aksi tidak ditemukan: ${nama}`);
  const m = /wajibIzinLaporan\(PERMISSIONS\.([A-Z_]+)\)/.exec(sumber.slice(awal));
  if (!m) throw new Error(`penjaga tidak ditemukan: ${nama}`);
  return PERMISSIONS[m[1] as keyof typeof PERMISSIONS];
}

describe("izin tab = izin aksinya", () => {
  it.each([
    ["rp1", "procurement.ts", "getProcurementReport"],
    ["rp1", "procurement.ts", "exportProcurementReport"],
    ["rp2", "production.ts", "getVendorPerformanceReport"],
    ["rp2", "production.ts", "exportVendorPerformanceReport"],
    ["rp3", "inventory.ts", "getInventoryValueSnapshot"],
    ["rp3", "inventory.ts", "exportInventorySnapshotReport"],
  ] as const)("%s ↔ %s %s", (tab, berkas, nama) => {
    expect(IZIN_TAB_LAPORAN[tab]).toBe(izinAksi(berkas, nama));
  });
});

describe("LaporanPageClient — tab disaring per izin", () => {
  const KLIEN = readFileSync(join(__dirname, "LaporanPageClient.tsx"), "utf8");

  it("tab aktif dan pergantian tab hanya di antara tab yang terlihat", () => {
    expect(KLIEN).toContain("tabLaporanTerlihat(izinPenonton)");
    expect(KLIEN).toContain("tabLaporanAktif(tabFromUrl, tabTerlihat)");
  });

  it("pemicu dan isi tab rp1/rp2/rp3 hanya dirender untuk yang berhak", () => {
    for (const tab of ["rp1", "rp2", "rp3"]) {
      expect(KLIEN).toMatch(new RegExp(`boleh\\('${tab}'\\) && <TabsTrigger value="${tab}">`));
      expect(KLIEN).toMatch(new RegExp(`boleh\\('${tab}'\\) && \\(\\s*<TabsContent value="${tab}"`));
    }
  });

  it("izin datang dari server bila dikirim, selain itu dari sesi", () => {
    expect(KLIEN).toMatch(/const izinPenonton = izin \?\? session\?\.user\?\.permissions \?\? \[\];/);
  });
});
