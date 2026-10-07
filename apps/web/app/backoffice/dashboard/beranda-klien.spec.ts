import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Klien beranda menggambar hanya bagian yang datanya dikirim server. Server
 * mengirim `null` untuk kartu yang tidak boleh dilihat (lihat
 * `beranda-izin.spec.ts`); di sini dipastikan `null` itu menghilangkan
 * bagiannya — bukan memecahkan halaman atau menggambar kartu berisi nol.
 * Komponen anak ditiru jadi penanda supaya yang diuji hanya keputusan tampil.
 */

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "Uji", permissions: ["*"] } } }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("@/components/dashboard/TrenPenjualan", () => ({ TrenPenjualan: () => createElement("i", null, "[TREN]") }));
vi.mock("@/components/dashboard/SalamBeranda", () => ({ SalamBeranda: () => null }));
vi.mock("./ActionNeededPanel", () => ({ ActionNeededPanel: () => null }));
vi.mock("@/components/dashboard/KpiDaftar", () => ({
  KpiDaftar: ({ judul, baris }: { judul: string; baris: Array<{ label: string }> }) =>
    createElement("i", null, `[KPI ${judul}: ${baris.map((b) => b.label).join("|")}]`),
}));
vi.mock("@/components/dashboard/BatangKomposisi", () => ({
  BatangKomposisi: ({ judul }: { judul: string }) => createElement("i", null, `[BATANG ${judul}]`),
}));

const { DashboardPageClient } = await import("./DashboardPageClient");

type Props = ComponentProps<typeof DashboardPageClient>;

const LENGKAP: Props = {
  actionItems: [],
  initialStats: {
    po: { draft: 1 },
    workOrders: { sedangDiproduksi: 2, selesaiSebagian: 0, completedToday: 0 },
    items: { lowStockCount: 3, habisCount: 0 },
    suppliers: { activeCount: 4 },
    grnsThisWeek: 0,
  },
  overduePOCount: 0,
  initialCogsRawVsFinished: { rawValue: 12_500_000, finishedValue: 48_000_000, rawCount: 5, finishedCount: 9 },
  shortageCount: 0,
  marketplaceKpi: { todaySalesTotal: "1500000", todaySalesCount: 2, pendingFulfillmentCount: 4 } as unknown as Props["marketplaceKpi"],
  oversoldCount: 1,
  initialSalesmenSales: {
    rows: [
      {
        salesmanId: "s1",
        salesmanName: "Budi",
        realised: { amount: 7_250_000, count: 3 },
        realisedRincian: { pengiriman: 2, van: 1 },
        outstanding: { amount: 0, count: 0 },
        menungguKirim: { amount: 1_500_000, count: 1 },
      },
    ],
    totals: {
      realised: { amount: 7_250_000, count: 3 },
      realisedRincian: { pengiriman: 2, van: 1 },
      outstanding: { amount: 0, count: 0 },
      menungguKirim: { amount: 1_500_000, count: 1 },
    },
  } as unknown as Props["initialSalesmenSales"],
  piutang: { total: 18_450_000, umur: [], lewatJumlah: 2, lewatNilai: 3_100_000, tertahanNilai: 0 } as unknown as Props["piutang"],
  trenPenjualan: [],
  hariIniWib: "2026-10-05",
  dimuatPada: "2026-10-05T01:00:00.000Z",
};

const gambar = (p: Partial<Props>) => renderToStaticMarkup(createElement(DashboardPageClient, { ...LENGKAP, ...p }));

describe("klien beranda — bagian mengikuti data dari server", () => {
  it("semua data → semua bagian, termasuk tabel per salesman", () => {
    const html = gambar({});
    expect(html).toContain("[TREN]");
    expect(html).toContain('id="beranda-penjualan"');
    expect(html).toContain("salesmanTitle");
    expect(html).toContain("Budi");
    // Kolom ketiga: putus disetujui yang belum dikirim — dulu tidak ada di kedua angka.
    expect(html).toContain("colAwaitingDelivery");
    expect(html).toContain('id="beranda-piutang"');
    expect(html).toContain('id="beranda-stok"');
    expect(html).toContain("[BATANG stockMixTitle]");
    expect(html).toContain('id="beranda-produksi"');
  });

  it("peran gudang/pembelian/produksi: tanpa tren, tanpa piutang, tanpa penjualan lapangan", () => {
    const html = gambar({ trenPenjualan: null, piutang: null, initialSalesmenSales: null });
    expect(html).not.toContain("[TREN]");
    expect(html).not.toContain('id="beranda-piutang"');
    expect(html).not.toContain("salesmanTitle");
    expect(html).not.toContain("Budi");
    expect(html).not.toContain("kpiRealisedAllTime");
    // Penjualan marketplace tetap ada karena datanya dikirim.
    expect(html).toContain("kpiMarketplaceToday|kpiUnshipped");
    // Bagian lain tidak berubah.
    expect(html).toContain('id="beranda-produksi"');
  });

  it("tanpa nilai stok → seluruh bagian stok hilang", () => {
    const html = gambar({ initialCogsRawVsFinished: null, oversoldCount: null });
    expect(html).not.toContain('id="beranda-stok"');
    expect(html).not.toContain("stockMixTitle");
  });

  it("tanpa data penjualan sama sekali → bagian penjualan hilang", () => {
    const html = gambar({ marketplaceKpi: null, initialSalesmenSales: null });
    expect(html).not.toContain('id="beranda-penjualan"');
  });

  it("penjualan lapangan saja → baris marketplace tidak digambar", () => {
    const html = gambar({ marketplaceKpi: null });
    expect(html).toContain("[KPI kpiSalesSummary: kpiRealisedAllTime|kpiAwaitingDelivery]");
    expect(html).toContain("Budi");
  });
});
