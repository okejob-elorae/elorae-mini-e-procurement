import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Halaman beranda meneruskan kartu yang tampil ke `getDashboardStats`, supaya
 * kueri persediaan dan agregat rupiah tidak dijalankan untuk pemegang beranda
 * yang tidak melihat kartunya (lihat `lib/dashboard/statistik-kartu.test.ts`).
 * Tanpa basis data: setiap kueri ditiru.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; name: string; permissions: string[] } } | null,
  argStats: [] as unknown[][],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/dashboard/queries", () => ({
  getDashboardStats: vi.fn(async (...arg: unknown[]) => {
    state.argStats.push(arg);
    return {
      po: { draft: 2, submitted: 0, inProduction: 0, thisWeek: 0, overdue: 0, totalValue: null },
      workOrders: { inProduction: 1, sedangDiproduksi: 1, selesaiSebagian: 0, completedToday: 0 },
      items: { activeCount: 0, lowStockCount: 3, habisCount: 0 },
      suppliers: { activeCount: 4 },
      inventory: { totalValue: null },
      grnsThisWeek: 1,
      movementsToday: 0,
    };
  }),
  getRawMaterialShortage: vi.fn(async () => []),
  getCOGSRawVsFinished: vi.fn(async () => ({ rawValue: 0, finishedValue: 0, rawCount: 0, finishedCount: 0 })),
  getSalesmenSalesSummary: vi.fn(async () => null),
  getTrenPenjualan: vi.fn(async () => []),
}));
vi.mock("@/lib/purchase-orders/queries", () => ({ getOverduePOs: vi.fn(async () => []) }));
vi.mock("@/lib/sales-orders/queries", () => ({
  getMarketplaceKpi: vi.fn(async () => ({ todaySalesTotal: "0", todaySalesCount: 0, pendingFulfillmentCount: 0 })),
}));
vi.mock("@/lib/dashboard/piutang-ringkas", () => ({ ringkasPiutangBeranda: vi.fn(async () => null) }));
vi.mock("@/lib/dashboard/action-items", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/dashboard/action-items")>();
  return {
    buildActionItems: asli.buildActionItems,
    getActionItemCounts: vi.fn(async () => ({
      fieldSalesPendingApproval: 0,
      storeChangesPending: 0,
      taxInvoicePending: 0,
      salesReturnPending: 0,
      journalPending: 0,
    })),
    getClaimsAwaitingVerification: vi.fn(async () => ({ bisaDiputuskan: { count: 0, amount: 0 }, milikSendiri: { count: 0, amount: 0 } })),
  };
});
vi.mock("@/lib/dashboard/antrean-kantor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dashboard/antrean-kantor")>()),
  hitungBarangStokMinus: vi.fn(async () => 0),
  getAntreanKantor: vi.fn(async () => ({})),
}));
vi.mock("./DashboardPageClient", () => ({ DashboardPageClient: () => null }));

const { default: DashboardPage } = await import("./page");

async function buka(izin: string[]): Promise<void> {
  state.sesi = { user: { id: "u1", name: "Uji", permissions: izin } };
  const el = (await DashboardPage()) as ReactElement;
  expect(isValidElement(el)).toBe(true);
}

beforeEach(() => {
  state.sesi = null;
  state.argStats = [];
});

describe("beranda — statistik dimuat per kartu", () => {
  it("pembelian (tanpa inventory:view): kartu stok tersembunyi dikirim ke getDashboardStats", async () => {
    await buka(["dashboard:view", "purchase_orders:view"]);
    expect(state.argStats).toHaveLength(1);
    expect(state.argStats[0][0]).toMatchObject({ stok: false });
  });

  it("gudang (inventory:view): kartu stok tampil", async () => {
    await buka(["dashboard:view", "inventory:view"]);
    expect(state.argStats[0][0]).toMatchObject({ stok: true });
  });

  it("admin (*): kartu tetap dikirim — agregat rupiah yang tidak digambar tidak dijalankan untuk siapa pun", async () => {
    await buka(["*"]);
    expect(state.argStats[0][0]).toMatchObject({ stok: true });
  });
});
