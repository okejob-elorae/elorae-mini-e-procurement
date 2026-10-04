import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pagar baca arsip dokumen.
 *
 * `/backoffice/archive` dan folder per toko dulu hanya menuntut sudah masuk,
 * padahal menu sampingnya hanya muncul untuk `purchase_orders:view`. Folder
 * "Nota toko" berisi nota tagihan setiap toko beserta nilainya — bagian
 * piutang — jadi pembaca piutang juga boleh membukanya, tetapi hanya bagian
 * itu: retur pemasok dan SPK tetap milik pembelian.
 *
 * Tanpa basis data — semua tiruan.
 */

const state = {
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dibaca: [] as string[],
};

const ARSIP = { folders: [], totalDocs: 0, totalPending: 0 };

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));
vi.mock("@/lib/archive/queries", () => ({
  getNotaTokoArchive: vi.fn(async () => {
    state.dibaca.push("nota");
    return ARSIP;
  }),
  getReturPemasokArchive: vi.fn(async () => {
    state.dibaca.push("retur");
    return ARSIP;
  }),
  getWorkOrderArchive: vi.fn(async () => {
    state.dibaca.push("wo");
    return ARSIP;
  }),
  getStoreDeliveries: vi.fn(async () => {
    state.dibaca.push("toko");
    return { storeName: "Toko A", rows: [], totalValue: 0, pendingTax: 0 };
  }),
}));
vi.mock("@/app/backoffice/archive/ArchiveTabs", () => ({ ArchiveTabs: () => null }));
vi.mock("@/app/backoffice/archive/toko/[storeId]/StoreArchiveClient", () => ({ StoreArchiveClient: () => null }));

const halamanArsip = (await import("@/app/backoffice/archive/page")).default;
const halamanArsipToko = (await import("@/app/backoffice/archive/toko/[storeId]/page")).default;

type Elemen = { props: Record<string, unknown> };

// Tujuan persis, bukan awalan.
const KE_BACKOFFICE = /^__REDIRECT__:\/backoffice$/;
const KE_LOGIN = /^__REDIRECT__:\/login$/;

const LUAR: [string, string[]][] = [
  ["salesman", ["pwa:access"]],
  ["SPG", ["pwa:access", "spg_sales:record"]],
  ["produksi", ["dashboard:view", "work_orders:view", "inventory_opname:view"]],
  ["gudang", ["dashboard:view", "inventory:view", "inventory_opname:count"]],
  ["konsinyasi saja", ["consignment:view", "consignment:manage"]],
];

beforeEach(() => {
  state.sesi = null;
  state.dibaca = [];
});

describe("arsip dokumen — pagar baca", () => {
  it("sends a signed-out visitor to /login", async () => {
    await expect(halamanArsip()).rejects.toThrow(KE_LOGIN);
    expect(state.dibaca).toEqual([]);
  });

  for (const [peran, izin] of LUAR) {
    it(`refuses ${peran} before reading any archive`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(halamanArsip()).rejects.toThrow(KE_BACKOFFICE);
      expect(state.dibaca).toEqual([]);
    });
  }

  it("gives purchasing (the sidebar permission) all three archives, as before", async () => {
    state.sesi = { user: { id: "u1", permissions: ["purchase_orders:view"] } };
    const el = (await halamanArsip()) as Elemen;
    expect(state.dibaca.sort()).toEqual(["nota", "retur", "wo"]);
    expect(el.props.retur).not.toBeNull();
    expect(el.props.workOrder).not.toBeNull();
  });

  it("gives a receivables reader the store-note archive only — no vendor returns, no work orders", async () => {
    state.sesi = { user: { id: "u1", permissions: ["receivables:view"] } };
    const el = (await halamanArsip()) as Elemen;
    expect(state.dibaca).toEqual(["nota"]);
    expect(el.props.retur).toBeNull();
    expect(el.props.workOrder).toBeNull();
  });

  it("lets the admin wildcard see everything", async () => {
    state.sesi = { user: { id: "u1", permissions: ["*"] } };
    await halamanArsip();
    expect(state.dibaca.sort()).toEqual(["nota", "retur", "wo"]);
  });
});

describe("arsip nota satu toko — pagar baca", () => {
  const buka = () => halamanArsipToko({ params: Promise.resolve({ storeId: "s1" }) });

  it("sends a signed-out visitor to /login", async () => {
    await expect(buka()).rejects.toThrow(KE_LOGIN);
  });

  for (const [peran, izin] of LUAR) {
    it(`refuses ${peran} before reading the store's notes`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(buka()).rejects.toThrow(KE_BACKOFFICE);
      expect(state.dibaca).toEqual([]);
    });
  }

  for (const izin of [["purchase_orders:view"], ["receivables:view"], ["receivables:manage"], ["*"]]) {
    it(`lets ${izin.join("+")} in`, async () => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(buka()).resolves.toBeDefined();
      expect(state.dibaca).toEqual(["toko"]);
    });
  }
});
