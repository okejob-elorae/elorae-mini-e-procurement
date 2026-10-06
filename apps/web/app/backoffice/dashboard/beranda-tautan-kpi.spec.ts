import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Angka KPI beranda yang menaut ke daftar harus mendarat di daftar yang
 * tersaring dengan definisi yang sama. "Tertahan retur" dulu menaut ke Retur
 * toko tanpa saringan, padahal nilainya keadaan piutang `tertahan`.
 */

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "Uji", permissions: ["*"] } } }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("@/components/dashboard/TrenPenjualan", () => ({ TrenPenjualan: () => null }));
vi.mock("@/components/dashboard/SalamBeranda", () => ({ SalamBeranda: () => null }));
vi.mock("./ActionNeededPanel", () => ({ ActionNeededPanel: () => null }));
vi.mock("@/components/dashboard/KpiDaftar", () => ({
  KpiDaftar: ({ baris }: { baris: Array<{ label: string; href?: string }> }) =>
    createElement("i", null, baris.map((b) => `[${b.label}=${b.href ?? ""}]`).join("")),
}));
vi.mock("@/components/dashboard/BatangKomposisi", () => ({ BatangKomposisi: () => null }));

const { DashboardPageClient } = await import("./DashboardPageClient");
type Props = ComponentProps<typeof DashboardPageClient>;

const props: Props = {
  actionItems: [],
  initialStats: {
    po: { draft: 1 },
    workOrders: { inProduction: 0, completedToday: 0 },
    items: { lowStockCount: 0 },
    suppliers: { activeCount: 0 },
    grnsThisWeek: 0,
  },
  overduePOCount: 0,
  initialCogsRawVsFinished: { rawValue: 0, finishedValue: 0, rawCount: 0, finishedCount: 0 },
  shortageCount: 0,
  marketplaceKpi: null,
  oversoldCount: 2,
  initialSalesmenSales: null,
  piutang: { total: 1, jumlah: 1, umur: [], lewatJumlah: 1, lewatNilai: 1, tertahanNilai: 5 },
  trenPenjualan: null,
  hariIniWib: "2026-10-06",
  dimuatPada: "2026-10-06T01:00:00.000Z",
};

describe("klien beranda — tautan KPI membawa saringannya", () => {
  const html = renderToStaticMarkup(createElement(DashboardPageClient, props));

  it("Tertahan retur → piutang dengan keadaan tertahan", () => {
    expect(html).toContain("[kpiHeld=/backoffice/piutang?keadaan=tertahan]");
  });

  it("Lewat janji bayar → piutang dengan keadaan lewat", () => {
    expect(html).toContain("[kpiOverdueReceivable=/backoffice/piutang?keadaan=lewat]");
  });

  it("Stok kelebihan pesan → inventori tersaring negatif", () => {
    expect(html).toContain("[oversoldTitle=/backoffice/inventory?tab=stock&amp;oversold=1]");
  });
});
