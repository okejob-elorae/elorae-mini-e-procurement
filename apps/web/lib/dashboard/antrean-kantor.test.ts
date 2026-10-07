import { describe, expect, it } from "vitest";
import { getRequiredPermission, hasPermission } from "@/lib/rbac";
import { buildActionItems, type BuildActionItemsInput } from "./action-items";
import { ANTREAN_KANTOR, bolehLihatAntrean, jalurTautan, KUNCI_ANTREAN, type KunciAntrean } from "./antrean-kantor";

/*
 * Antrean kantor di daftar "perlu ditindaklanjuti" Beranda. Setiap baris:
 * tautannya membawa saringan halaman tujuan, dan barisnya hanya tampil untuk
 * yang bisa MEMBUKA halamannya sekaligus MEMUTUSKAN isinya.
 *
 * Himpunan izin terkecil di bawah ini ditulis dari penjaga `page.tsx` dan aksi
 * server masing-masing halaman — bukan disalin dari `ANTREAN_KANTOR`, supaya
 * tes ini gagal bila salah satunya bergeser.
 */
const IZIN_TERKECIL: Record<KunciAntrean, string[]> = {
  // /backoffice/izin: ROUTE_PERMISSIONS field_sales_orders:view; memutuskan = approve.
  leavePending: ["field_sales_orders:view", "field_sales_orders:approve"],
  // Biaya: halaman = field_sales_orders:view ATAU journals:manage.
  expensesPendingApproval: ["field_sales_orders:view", "field_sales_orders:approve"],
  expensesPendingPayment: ["journals:manage"],
  // Tukar: halaman terbuka untuk penyetuju dan gudang.
  exchangesPendingApproval: ["field_sales_orders:approve"],
  exchangesPendingCompletion: ["inventory:manage"],
  transfersPendingApproval: ["spg_sales:view", "field_sales_orders:approve"],
  transferShortfallsOpen: ["spg_sales:view", "field_sales_orders:approve"],
  stockLossOpen: ["receivables:manage"],
  storeProposalsPending: ["stores:view", "stores:manage"],
  fieldPromisesUnconfirmed: ["receivables:manage"],
  damagedDeliveriesOpen: ["inventory:manage"],
  damagedWarehouseOpen: ["inventory:view", "inventory:manage"],
  claimCorrectionsPending: ["journals:manage"],
  returnCorrectionsPending: ["receivables:manage"],
  shiftSwapsPending: ["spg_sales:view", "stores:manage"],
  stockRequestsUnheld: ["spg_sales:view", "stores:manage"],
  // /backoffice/komisi-spg: ROUTE_PERMISSIONS + penjaga halaman spg_sales:view; menetapkan = receivables:manage.
  spgCommissionsUnset: ["spg_sales:view", "receivables:manage"],
};

/** Saringan yang WAJIB ada di tautan tiap baris — angka Beranda dihitung dengan saringan ini. */
const SARINGAN: Record<KunciAntrean, Record<string, string>> = {
  leavePending: { status: "DIAJUKAN" },
  expensesPendingApproval: { status: "DIAJUKAN", bulan: "semua" },
  expensesPendingPayment: { status: "DISETUJUI", bulan: "semua" },
  exchangesPendingApproval: { status: "DIAJUKAN" },
  exchangesPendingCompletion: { status: "DISETUJUI" },
  transfersPendingApproval: { status: "DIAJUKAN" },
  transferShortfallsOpen: { selisih: "1" },
  stockLossOpen: { status: "TERBUKA" },
  storeProposalsPending: { status: "PENDING" },
  fieldPromisesUnconfirmed: { saring: "belum" },
  damagedDeliveriesOpen: { tab: "terbuka" },
  damagedWarehouseOpen: { tab: "saldo" },
  claimCorrectionsPending: { koreksi: "1" },
  returnCorrectionsPending: { koreksi: "1" },
  shiftSwapsPending: { tab: "tukar" },
  stockRequestsUnheld: { status: "BARU", pemegang: "tanpa" },
  spgCommissionsUnset: { bulan: "lalu" },
};

const nol: BuildActionItemsInput = {
  fieldSalesPendingApproval: 0,
  storeChangesPending: 0,
  taxInvoicePending: 0,
  salesReturnPending: 0,
  journalPending: 0,
  overduePOs: 0,
  draftPOs: 0,
  oversoldSkus: 0,
  unshippedOrders: 0,
};

describe("ANTREAN_KANTOR — tautan membawa saringannya", () => {
  for (const kunci of KUNCI_ANTREAN) {
    it(`${kunci}`, () => {
      const url = new URL(ANTREAN_KANTOR[kunci].href, "http://x");
      expect(url.pathname.startsWith("/backoffice/")).toBe(true);
      expect(Object.fromEntries(url.searchParams)).toEqual(SARINGAN[kunci]);
    });
  }
});

describe("ANTREAN_KANTOR — pagar: membuka halaman DAN bisa memutuskan", () => {
  for (const kunci of KUNCI_ANTREAN) {
    const terkecil = IZIN_TERKECIL[kunci];

    it(`${kunci}: tampil untuk himpunan izin terkecilnya dan untuk admin`, () => {
      expect(bolehLihatAntrean(kunci, ["dashboard:view", ...terkecil])).toBe(true);
      expect(bolehLihatAntrean(kunci, ["*"])).toBe(true);
    });

    it(`${kunci}: hilang begitu satu izin dari himpunan terkecilnya dicabut`, () => {
      for (const cabut of terkecil) {
        expect(bolehLihatAntrean(kunci, ["dashboard:view", ...terkecil.filter((p) => p !== cabut)])).toBe(false);
      }
      expect(bolehLihatAntrean(kunci, ["dashboard:view"])).toBe(false);
    });

    it(`${kunci}: yang lolos pagar selalu lolos ROUTE_PERMISSIONS halamannya`, () => {
      const rute = getRequiredPermission(jalurTautan(ANTREAN_KANTOR[kunci].href));
      if (rute) expect(hasPermission(terkecil, rute)).toBe(true);
    });
  }
});

describe("buildActionItems — baris antrean kantor", () => {
  const semua = Object.fromEntries(KUNCI_ANTREAN.map((k, i) => [k, i + 1]));

  it("dengan izin admin: setiap antrean bernilai jadi satu baris, membawa tautan dan angkanya", () => {
    const items = buildActionItems({ ...nol, antrean: semua }, ["*"]);
    for (const [i, kunci] of KUNCI_ANTREAN.entries()) {
      expect(items.find((x) => x.key === kunci)).toMatchObject({
        count: i + 1,
        href: ANTREAN_KANTOR[kunci].href,
        labelKey: kunci,
        tone: "waiting",
      });
    }
  });

  it("baris nol dibuang", () => {
    const items = buildActionItems({ ...nol, antrean: { leavePending: 0, stockLossOpen: 2 } }, ["*"]);
    expect(items.map((x) => x.key)).toEqual(["stockLossOpen"]);
  });

  it("disaring per izin: gudang hanya melihat antrean gudang", () => {
    const gudang = ["dashboard:view", "inventory:view", "inventory:manage"];
    const items = buildActionItems({ ...nol, antrean: semua }, gudang);
    expect(items.map((x) => x.key).sort()).toEqual([
      "damagedDeliveriesOpen",
      "damagedWarehouseOpen",
      "exchangesPendingCompletion",
    ]);
  });

  it("tanpa izin penonton baris antrean tidak pernah ikut, walau datanya dioper", () => {
    const items = buildActionItems({ ...nol, antrean: semua });
    expect(items.some((x) => (KUNCI_ANTREAN as readonly string[]).includes(x.key))).toBe(false);
  });
});

/*
 * Baris lama juga: angka Beranda = baris yang tampil saat tautannya dibuka.
 * Dua baris belum bisa memenuhinya tanpa mengubah berkas di luar Beranda —
 * dicatat dengan alasannya, supaya baris baru tanpa saringan tidak lolos diam-diam.
 */
const TANPA_SARINGAN: Record<string, string> = {
  // Belum ada halaman yang mendaftar jurnal yang GAGAL diposting.
  journalPending: "daftar jurnal tertunda belum ada",
  // Antrean pemenuhan menyaring fulfillmentStatus, bukan status pesanan.
  unshippedOrders: "antrean pemenuhan belum bisa disaring per status pesanan",
};

describe("buildActionItems — setiap baris membawa saringan halaman tujuannya", () => {
  it("semua baris (lama dan baru) memakai saringan URL, kecuali yang tercatat", () => {
    const satu = Object.fromEntries(KUNCI_ANTREAN.map((k) => [k, 1]));
    const items = buildActionItems(
      {
        fieldSalesPendingApproval: 1,
        storeChangesPending: 1,
        taxInvoicePending: 1,
        salesReturnPending: 1,
        journalPending: 1,
        overduePOs: 1,
        draftPOs: 1,
        oversoldSkus: 1,
        unshippedOrders: 1,
        overduePromises: { count: 1, amount: 1 },
        claimsAwaitingVerification: { count: 1, amount: 1 },
        antrean: satu,
      },
      ["*"],
    );
    expect(items.length).toBe(11 + KUNCI_ANTREAN.length);
    for (const item of items) {
      if (item.key in TANPA_SARINGAN) continue;
      expect(item.href, item.key).toContain("?");
    }
    const href = (k: string) => items.find((i) => i.key === k)?.href;
    expect(href("claimsAwaitingVerification")).toBe("/backoffice/pelunasan?status=DIKIRIM");
    expect(href("storeChangesPending")).toBe("/backoffice/stores?perubahan=menunggu");
  });
});
