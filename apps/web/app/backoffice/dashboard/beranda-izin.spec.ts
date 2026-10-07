import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Halaman beranda (server) hanya memuat kartu yang boleh dilihat penggunanya.
 *
 * Dulu sebelas kueri berjalan untuk setiap pemegang `dashboard:view`, dan
 * hasilnya — umur piutang, penjualan per salesman, nilai persediaan — dikirim
 * ke browser orang gudang, pembelian, dan produksi. Menyembunyikan kartunya di
 * browser saja tidak cukup: datanya tetap ada di muatan halaman. Tanpa basis
 * data: setiap kueri ditiru dan dicatat namanya.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; name: string; permissions: string[] } } | null,
  dimuat: [] as string[],
  izinAntrean: [] as string[][],
  klaimUntuk: [] as (string | null)[],
}));

const catat = <T,>(nama: string, nilai: T) =>
  vi.fn(async () => {
    state.dimuat.push(nama);
    return nilai;
  });

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/dashboard/queries", () => ({
  // Bentuk penuh `DashboardStats`, termasuk dua angka rupiah yang TIDAK
  // digambar beranda: nilai seluruh persediaan dan nilai seluruh PO.
  getDashboardStats: catat("stats", {
    po: { draft: 2, submitted: 5, inProduction: 1, thisWeek: 3, overdue: 1, totalValue: 245_000_000 },
    workOrders: { inProduction: 1, sedangDiproduksi: 1, selesaiSebagian: 0, completedToday: 0 },
    items: { activeCount: 120, lowStockCount: 3, habisCount: 2 },
    suppliers: { activeCount: 4 },
    inventory: { totalValue: 60_500_000 },
    grnsThisWeek: 1,
    movementsToday: 7,
  }),
  getRawMaterialShortage: catat("kekurangan", []),
  getCOGSRawVsFinished: catat("nilaiStok", { rawValue: 12_500_000, finishedValue: 48_000_000, rawCount: 5, finishedCount: 9 }),
  getSalesmenSalesSummary: catat("perSalesman", {
    rows: [],
    totals: { realised: { amount: 7_250_000, count: 3 }, outstanding: { amount: 0, count: 0 } },
  }),
  getTrenPenjualan: catat("tren", []),
}));
vi.mock("@/lib/purchase-orders/queries", () => ({ getOverduePOs: catat("poTerlambat", []) }));
vi.mock("@/lib/sales-orders/queries", () => ({
  getMarketplaceKpi: catat("marketplace", { todaySalesTotal: "1500000", todaySalesCount: 2, pendingFulfillmentCount: 4 }),
}));
vi.mock("@/lib/dashboard/piutang-ringkas", () => ({
  ringkasPiutangBeranda: catat("piutang", {
    total: 18_450_000,
    umur: [],
    lewatJumlah: 2,
    lewatNilai: 3_100_000,
    tertahanNilai: 0,
  }),
}));
vi.mock("@/lib/dashboard/action-items", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/dashboard/action-items")>();
  return {
    buildActionItems: asli.buildActionItems,
    getActionItemCounts: catat("hitungTindakan", {
      fieldSalesPendingApproval: 1,
      storeChangesPending: 1,
      taxInvoicePending: 1,
      salesReturnPending: 1,
      journalPending: 1,
    }),
    getClaimsAwaitingVerification: vi.fn(async (userId?: string | null) => {
      state.dimuat.push("klaimMenunggu");
      state.klaimUntuk.push(userId ?? null);
      return { bisaDiputuskan: { count: 2, amount: 900_000 }, milikSendiri: { count: 1, amount: 50_000 } };
    }),
  };
});
vi.mock("@/lib/dashboard/antrean-kantor", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/dashboard/antrean-kantor")>();
  return {
    ...asli,
    hitungBarangStokMinus: catat("oversold", 1),
    // Satu untuk SETIAP antrean, apa pun izinnya: yang menyaring baris adalah
    // `buildActionItems` dengan izin penonton (kueri yang disaring diuji di
    // `lib/dashboard/antrean-kantor-kueri.test.ts`).
    getAntreanKantor: vi.fn(async (izin: string[]) => {
      state.izinAntrean.push(izin);
      return Object.fromEntries(asli.KUNCI_ANTREAN.map((k) => [k, 1]));
    }),
  };
});
vi.mock("./DashboardPageClient", () => ({ DashboardPageClient: () => null }));

const { default: DashboardPage } = await import("./page");
const { KUNCI_ANTREAN } = await import("@/lib/dashboard/antrean-kantor");

type PropsKlien = {
  actionItems: Array<{ key: string; permission: string | null }>;
  initialStats: unknown;
  marketplaceKpi: unknown;
  initialSalesmenSales: unknown;
  piutang: unknown;
  trenPenjualan: unknown;
  initialCogsRawVsFinished: unknown;
  oversoldCount: unknown;
};

async function bukaBeranda(izin: string[]): Promise<PropsKlien> {
  state.sesi = { user: { id: "u1", name: "Uji", permissions: izin } };
  const el = (await DashboardPage()) as ReactElement<{ children: ReactElement<PropsKlien> }>;
  expect(isValidElement(el)).toBe(true);
  return el.props.children.props;
}

const PURCHASER = ["dashboard:view", "sales_orders:view", "purchase_orders:view", "suppliers:view"];
const WAREHOUSE = ["dashboard:view", "sales_orders:view", "inventory:view", "inventory_opname:count"];
const PRODUCTION = ["dashboard:view", "sales_orders:view", "work_orders:view"];

beforeEach(() => {
  state.sesi = null;
  state.dimuat = [];
  state.izinAntrean = [];
  state.klaimUntuk = [];
});

describe("beranda — kartu per izin, dari server", () => {
  it("tanpa sesi → login, tanpa satu kueri pun", async () => {
    await expect(DashboardPage()).rejects.toThrow("__REDIRECT__:/login");
    expect(state.dimuat).toEqual([]);
  });

  it("admin (*) memuat dan menerima semua kartu", async () => {
    const p = await bukaBeranda(["*"]);
    for (const nama of ["piutang", "perSalesman", "nilaiStok", "oversold", "tren", "marketplace", "klaimMenunggu"]) {
      expect(state.dimuat).toContain(nama);
    }
    expect(p.piutang).not.toBeNull();
    expect(p.initialSalesmenSales).not.toBeNull();
    expect(p.initialCogsRawVsFinished).not.toBeNull();
    expect(p.trenPenjualan).not.toBeNull();
    expect(p.marketplaceKpi).not.toBeNull();
  });

  for (const [peran, izin] of [
    ["PURCHASER", PURCHASER],
    ["WAREHOUSE", WAREHOUSE],
    ["PRODUCTION", PRODUCTION],
  ] as const) {
    it(`${peran}: piutang, penjualan per salesman, dan tren semua saluran tidak dimuat maupun dikirim`, async () => {
      const p = await bukaBeranda([...izin]);
      expect(state.dimuat).not.toContain("piutang");
      expect(state.dimuat).not.toContain("perSalesman");
      expect(state.dimuat).not.toContain("tren");
      expect(state.dimuat).not.toContain("klaimMenunggu");
      expect(p.piutang).toBeNull();
      expect(p.initialSalesmenSales).toBeNull();
      expect(p.trenPenjualan).toBeNull();
      // Pemenuhan pesanan marketplace memang pekerjaan mereka.
      expect(p.marketplaceKpi).not.toBeNull();
    });
  }

  it("PURCHASER dan PRODUCTION tidak memuat nilai stok; WAREHOUSE memuatnya", async () => {
    for (const izin of [PURCHASER, PRODUCTION]) {
      state.dimuat = [];
      const p = await bukaBeranda(izin);
      expect(state.dimuat).not.toContain("nilaiStok");
      expect(state.dimuat).not.toContain("oversold");
      expect(p.initialCogsRawVsFinished).toBeNull();
      expect(p.oversoldCount).toBeNull();
    }
    state.dimuat = [];
    const g = await bukaBeranda(WAREHOUSE);
    expect(state.dimuat).toContain("nilaiStok");
    expect(g.initialCogsRawVsFinished).toEqual({
      rawValue: 12_500_000,
      finishedValue: 48_000_000,
      rawCount: 5,
      finishedCount: 9,
    });
  });

  it("statistik: hanya angka yang digambar yang dikirim — nilai persediaan dan nilai PO tidak pernah", async () => {
    for (const izin of [PURCHASER, PRODUCTION, WAREHOUSE, ["*"]]) {
      const p = await bukaBeranda([...izin]);
      const muatan = JSON.stringify(p.initialStats);
      // Rp 60.500.000 (persediaan) dan Rp 245.000.000 (PO) tidak digambar di
      // mana pun; dulu keduanya ikut ke browser setiap pemegang beranda.
      expect(muatan).not.toContain("60500000");
      expect(muatan).not.toContain("245000000");
      expect(muatan).not.toContain("totalValue");
    }
  });

  it("statistik: hitungan stok menipis hanya untuk pemegang inventory:view", async () => {
    const pembelian = await bukaBeranda(PURCHASER);
    expect(pembelian.initialStats).toEqual({
      po: { draft: 2 },
      workOrders: { sedangDiproduksi: 1, selesaiSebagian: 0, completedToday: 0 },
      suppliers: { activeCount: 4 },
      grnsThisWeek: 1,
      items: null,
    });
    const gudang = await bukaBeranda(WAREHOUSE);
    expect(gudang.initialStats).toMatchObject({ items: { lowStockCount: 3, habisCount: 2 } });
  });

  it("tanpa sales_orders:view, angka marketplace tidak dimuat", async () => {
    const p = await bukaBeranda(["dashboard:view", "work_orders:view"]);
    expect(state.dimuat).not.toContain("marketplace");
    expect(p.marketplaceKpi).toBeNull();
  });

  it("pemegang receivables:manage menerima piutang tanpa harus memegang receivables:view", async () => {
    const p = await bukaBeranda(["dashboard:view", "receivables:manage"]);
    expect(state.dimuat).toContain("piutang");
    expect(p.piutang).toMatchObject({ total: 18_450_000, lewatNilai: 3_100_000 });
  });

  it("daftar tindakan disaring di server: baris yang izinnya tidak dipegang tidak dikirim", async () => {
    const p = await bukaBeranda(PRODUCTION);
    const izinBaris = p.actionItems.map((i) => i.permission);
    for (const izin of izinBaris) {
      expect(izin === null || PRODUCTION.includes(izin)).toBe(true);
    }
    expect(p.actionItems.map((i) => i.key)).toContain("unshippedOrders");
    expect(p.actionItems.map((i) => i.key)).not.toContain("fieldSalesPendingApproval");
  });

  it("antrean kantor dihitung dengan izin penonton, dan barisnya disaring dengannya", async () => {
    const p = await bukaBeranda(PRODUCTION);
    expect(state.izinAntrean).toEqual([PRODUCTION]);
    const antrean = new Set(KUNCI_ANTREAN as readonly string[]);
    expect(p.actionItems.filter((i) => antrean.has(i.key))).toEqual([]);
  });

  it("gudang (inventory:manage) melihat antrean gudang saja; admin melihat semuanya", async () => {
    const gudang = await bukaBeranda([...WAREHOUSE, "inventory:manage"]);
    const antrean = new Set(KUNCI_ANTREAN as readonly string[]);
    expect(gudang.actionItems.filter((i) => antrean.has(i.key)).map((i) => i.key).sort()).toEqual([
      "damagedDeliveriesOpen",
      "damagedWarehouseOpen",
      "exchangesPendingCompletion",
    ]);
    const admin = await bukaBeranda(["*"]);
    expect(admin.actionItems.filter((i) => antrean.has(i.key))).toHaveLength(KUNCI_ANTREAN.length);
  });

  it("BKM menunggu: dihitung untuk penonton ini — yang bisa ia putuskan dan miliknya sendiri jadi dua baris", async () => {
    const p = await bukaBeranda(["*"]);
    expect(state.klaimUntuk).toEqual(["u1"]);
    const baris = p.actionItems as Array<{ key: string; count?: number }>;
    expect(baris.find((i) => i.key === "claimsAwaitingVerification")).toMatchObject({ count: 2 });
    expect(baris.find((i) => i.key === "claimsAwaitingOthers")).toMatchObject({ count: 1 });
  });
});
