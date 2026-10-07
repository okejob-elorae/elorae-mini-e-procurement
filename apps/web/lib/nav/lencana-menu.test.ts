import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Lencana menu samping. Dulu jurnal gagal dan faktur pajak dipetakan ke grup
 * "#" yang tidak ada (Buku Besar tidak pernah berlencana), BKM menunggu dan
 * faktur lewat janji bayar tidak punya lencana, keenam belas antrean kantor
 * tidak ikut, dan stok minus dihitung per BARIS varian sementara Beranda per
 * BARANG. Grup kini diturunkan dari halaman tujuan lewat susunan menu.
 */

const { kueri, gagal } = vi.hoisted(() => ({ kueri: [] as string[], gagal: new Set<string>() }));
function catat<T>(nama: string, nilai: T) {
  return vi.fn(async () => {
    kueri.push(nama);
    if (gagal.has(nama)) throw new Error(`gagal ${nama}`);
    return nilai;
  });
}

vi.mock("@/lib/dashboard/action-items", async (asli) => {
  const m = await asli<typeof import("@/lib/dashboard/action-items")>();
  return {
    ...m,
    getActionItemCounts: vi.fn(async (izin?: string[]) => {
      kueri.push("hitungan");
      const { hasPermission } = await import("@/lib/rbac");
      const boleh = (kode: string) => !izin || hasPermission(izin, kode);
      return {
        fieldSalesPendingApproval: boleh("field_sales_orders:view") ? 4 : 0,
        storeChangesPending: boleh("stores:view") ? 1 : 0,
        taxInvoicePending: boleh("tax_invoices:view") ? 1 : 0,
        salesReturnPending: 0,
        journalPending: boleh("journals:view") ? 2 : 0,
      };
    }),
    getClaimsAwaitingVerification: catat("klaim", {
      bisaDiputuskan: { count: 3, amount: 300 },
      milikSendiri: { count: 5, amount: 500 },
    }),
  };
});
vi.mock("@/lib/dashboard/antrean-kantor", async (asli) => {
  const m = await asli<typeof import("@/lib/dashboard/antrean-kantor")>();
  return {
    ...m,
    getAntreanKantor: vi.fn(async (izin: string[]) => {
      kueri.push("antrean");
      const semua = { leavePending: 2, stockLossOpen: 1, transfersPendingApproval: 1, claimCorrectionsPending: 1 };
      return Object.fromEntries(Object.entries(semua).filter(([k]) => m.bolehLihatAntrean(k as never, izin)));
    }),
    hitungBarangStokMinus: catat("stokMinusPerBarang", 2),
  };
});
vi.mock("@/lib/purchase-orders/queries", () => ({
  getOverduePOCount: catat("poTerlambat", 1),
  getDraftPOCount: catat("poDraf", 2),
}));
vi.mock("@/lib/sales-orders/queries", () => ({ getMarketplaceKpi: catat("marketplace", { pendingFulfillmentCount: 6 }) }));
vi.mock("@/lib/dashboard/piutang-ringkas", () => ({ ringkasPiutangBeranda: catat("piutang", { lewatJumlah: 7, lewatNilai: 70 }) }));
vi.mock("@/lib/creative/tugas-queries", () => ({ hitungTugasKreatif: catat("kreatif", 9) }));

const { hitungLencanaMenu } = await import("./lencana-menu");

beforeEach(() => {
  kueri.length = 0;
  gagal.clear();
});

describe("hitungLencanaMenu", () => {
  it("admin: Buku Besar dan Piutang berlencana, tidak ada grup '#'", async () => {
    const { grup, halaman } = await hitungLencanaMenu(["*"], "u-admin");
    expect(grup["#"]).toBeUndefined();
    // Jurnal gagal 2 + faktur pajak 1.
    expect(grup["/backoffice/finance/journals"]).toBe(3);
    expect(halaman["/backoffice/finance/journals"]).toBe(2);
    expect(halaman["/backoffice/finance/faktur-pajak"]).toBe(1);
    // Lewat janji bayar 7 + BKM yang BISA diputuskan 3 + koreksi BKM 1 — BKM milik sendiri (5) bukan pekerjaannya.
    expect(grup["/backoffice/pelunasan-dasbor"]).toBe(11);
    expect(halaman["/backoffice/piutang"]).toBe(7);
    expect(halaman["/backoffice/pelunasan"]).toBe(4);
  });

  it("antrean kantor ikut, di grup dan halaman tempat pekerjaannya", async () => {
    const { grup, halaman } = await hitungLencanaMenu(["*"], "u-admin");
    expect(halaman["/backoffice/izin"]).toBe(2);
    expect(grup["/backoffice/sales-lapangan"]).toBe(2);
    expect(halaman["/backoffice/barang-hilang"]).toBe(1);
    expect(halaman["/backoffice/spg-transfers"]).toBe(1);
    expect(grup["/backoffice/spg-sales"]).toBe(2);
  });

  it("stok minus per BARANG — angka yang sama dengan Beranda, bukan per baris varian", async () => {
    const { grup, halaman } = await hitungLencanaMenu(["*"], "u-admin");
    expect(halaman["/backoffice/inventory"]).toBe(2);
    expect(grup["/backoffice/inventory"]).toBe(2);
    expect(kueri).toContain("stokMinusPerBarang");
  });

  it("total grup = jumlah halaman yang berlencana di dalamnya", async () => {
    const { grup, halaman } = await hitungLencanaMenu(["*"], "u-admin");
    expect(grup["/backoffice/sales-orders"]).toBe(halaman["/backoffice/field-sales-orders"] + halaman["/backoffice/fulfillment"]);
    expect(grup["/backoffice/purchase-orders"]).toBe(3);
  });

  it("produksi tanpa izin pekerjaan kantor: tidak ada lencana, dan kuerinya tidak dijalankan", async () => {
    const hasil = await hitungLencanaMenu(["dashboard:view", "work_orders:view"], "u-prod");
    expect(hasil).toEqual({ grup: {}, halaman: {} });
    expect(kueri).not.toContain("poTerlambat");
    expect(kueri).not.toContain("piutang");
    expect(kueri).not.toContain("klaim");
    expect(kueri).not.toContain("marketplace");
    expect(kueri).not.toContain("stokMinusPerBarang");
  });

  it("pembaca piutang tanpa keuangan: lewat janji bayar berlencana, BKM tidak", async () => {
    const { grup, halaman } = await hitungLencanaMenu(["receivables:view"], "u-piutang");
    expect(halaman["/backoffice/piutang"]).toBe(7);
    expect(halaman["/backoffice/pelunasan"]).toBeUndefined();
    expect(grup["/backoffice/pelunasan-dasbor"]).toBe(7);
    expect(kueri).not.toContain("klaim");
  });

  it("Hari ini Ruang KOL: grup Kreatif dan anak Hari ini memakai total tugas; tanpa izin tidak dihitung", async () => {
    const { grup, halaman } = await hitungLencanaMenu(["creative:view"], "u-kreatif");
    expect(grup["/backoffice/kreatif"]).toBe(9);
    expect(halaman["/backoffice/kreatif"]).toBe(9);
    expect(kueri).toContain("kreatif");

    kueri.length = 0;
    const tanpa = await hitungLencanaMenu(["dashboard:view"], "u-lain");
    expect(tanpa.grup["/backoffice/kreatif"]).toBeUndefined();
    expect(kueri).not.toContain("kreatif");
  });

  it("satu hitungan yang gagal tidak mengosongkan lencana lain", async () => {
    gagal.add("piutang");
    const { grup, halaman } = await hitungLencanaMenu(["*"], "u-admin");
    expect(halaman["/backoffice/piutang"]).toBeUndefined();
    expect(grup["/backoffice/finance/journals"]).toBe(3);
    expect(halaman["/backoffice/pelunasan"]).toBe(4);
  });
});
