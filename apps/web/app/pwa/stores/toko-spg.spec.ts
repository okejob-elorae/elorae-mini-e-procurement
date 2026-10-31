import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * SPG hanya boleh membuka toko tetapnya (`User.assignedStoreId`).
 *
 * Dulu halaman toko PWA melewati pemeriksaan toko-sendiri untuk SPG ("aturannya
 * sudah dijaga saat check-in"), jadi SPG yang mengetik `/pwa/stores/<toko lain>`
 * menerima markup, tempo, riwayat kunjungan, dan pesanan toko lain; daftar toko
 * pun mengirim SEMUA toko aktif ke HP-nya. Kini SPG di toko lain dikembalikan
 * ke /pwa sebelum satu baris toko itu dibaca, dan daftarnya hanya tokonya.
 * Salesman tidak berubah. Tanpa basis data — semua tiruan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  terkunci: false,
  dibaca: [] as string[],
}));

const TOKO: Record<string, { id: string; salesmanId: string | null; isActive: boolean }> = {
  "toko-spg": { id: "toko-spg", salesmanId: "sales-1", isActive: true },
  "toko-lain": { id: "toko-lain", salesmanId: "sales-2", isActive: true },
};

function barisToko(id: string) {
  const t = TOKO[id];
  if (!t) return null;
  return {
    ...t,
    code: id.toUpperCase(),
    name: `Nama ${id}`,
    address: "Jl. Uji",
    phone: null,
    contactName: null,
    termsType: "KONSI" as const,
    paymentTempo: 30,
    markupPercent: 25,
    priceDiscountPercent: null,
    lat: null,
    lng: null,
    storeClass: null,
  };
}

const catat = <T,>(nama: string, nilai: T) =>
  vi.fn(async () => {
    state.dibaca.push(nama);
    return nilai;
  });

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/stores/queries", () => ({
  getStore: vi.fn(async (id: string) => {
    state.dibaca.push(`getStore:${id}`);
    return barisToko(id);
  }),
  listActiveStoresForPwa: vi.fn(async () => {
    state.dibaca.push("listActiveStoresForPwa");
    return Object.keys(TOKO).map((id) => barisToko(id)!);
  }),
  listVisitsForStore: catat("listVisitsForStore", []),
  getActiveVisit: catat("getActiveVisit", null),
  listVisitPhotos: catat("listVisitPhotos", []),
}));
vi.mock("@/lib/store-changes/queries", () => ({ getPendingStoreChangeRequest: catat("pending", null) }));
vi.mock("@/lib/field-sales/queries", () => ({ getStoreOrderSummary: catat("getStoreOrderSummary", []) }));
vi.mock("@/lib/salesman/ringkasan-toko", () => ({ ringkasanToko: catat("ringkasanToko", null) }));
vi.mock("@/lib/salesman/dasbor", () => ({
  polaPesanan: () => ({ hariSejak: null, jedaMedian: null, waktunya: false }),
}));
vi.mock("@/lib/salesman/queries", () => ({
  saranPesananToko: catat("saranPesananToko", { tanggalPesanan: [], terakhir: null, promo: [] }),
  tokoTerkunci: vi.fn(async () => state.terkunci),
  tokoSaya: catat("tokoSaya", { rencana: [{ storeId: "toko-lain" }] }),
}));
vi.mock("@/lib/salesman/saran-tawar-queries", () => ({ saranTawarToko: catat("saranTawarToko", null) }));
vi.mock("@/lib/spg/kehadiran-toko", async (asli) => ({ ...(await asli<typeof import("@/lib/spg/kehadiran-toko")>()), kehadiranSpgToko: catat("kehadiranSpgToko", []) }));
vi.mock("@/lib/konsinyasi/stok-di-toko", () => ({ kartuStokDiToko: catat("kartuStokDiToko", null) }));
vi.mock("@/lib/field-sales/jarak-jauh-toko", () => ({ izinJarakJauh: catat("izinJarakJauh", { boleh: false }) }));
vi.mock("@/lib/stores/catatan-queries", () => ({
  aksesCatatanToko: catat("aksesCatatanToko", { boleh: false, kelolaSemua: false }),
  catatanTokoUntuk: catat("catatanTokoUntuk", []),
}));
vi.mock("@/lib/field-sales/inden-queries", () => ({ jendelaIndenTerbuka: catat("jendelaIndenTerbuka", []) }));

// Komponen klien tidak dirender — yang diuji hanya pagar dan isi props-nya.
vi.mock("@/app/pwa/stores/[id]/BukanTokoSaya", () => ({ BukanTokoSaya: function BukanTokoSaya() { return null; } }));
vi.mock("@/app/pwa/stores/[id]/StoreDetailShell", () => ({
  StoreDetailShell: function StoreDetailShell() {
    return null;
  },
}));
vi.mock("@/app/pwa/stores/[id]/SaranTawar", () => ({ SaranTawar: () => null }));
vi.mock("@/app/pwa/stores/[id]/StokDiToko", () => ({ StokDiToko: () => null }));
vi.mock("@/app/pwa/stores/[id]/TombolPortalToko", () => ({ TombolPortalToko: () => null }));
vi.mock("@/app/pwa/stores/[id]/CatatanToko", () => ({ CatatanToko: () => null }));
vi.mock("@/app/pwa/stores/[id]/TombolPreorder", () => ({ TombolPreorder: () => null }));
vi.mock("@/app/pwa/stores/[id]/LanjutSetelahCheckIn", () => ({ LanjutSetelahCheckIn: () => null }));
vi.mock("@/app/pwa/stores/StoreList", () => ({
  StoreList: function StoreList() {
    return null;
  },
}));

const halamanToko = (await import("@/app/pwa/stores/[id]/page")).default;
const halamanDaftar = (await import("@/app/pwa/stores/page")).default;

const buka = (id: string) => halamanToko({ params: Promise.resolve({ id }) });

/** Cari elemen pertama berkomponen bernama `nama` di pohon yang dikembalikan halaman. */
function cari(node: ReactNode, nama: string): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = cari(n, nama);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown>>;
  const tipe = el.type as { name?: string } | string;
  if (typeof tipe !== "string" && tipe?.name === nama) return el;
  return cari(el.props.children as ReactNode, nama);
}

beforeEach(() => {
  state.sesi = null;
  state.tokoTetap = null;
  state.terkunci = false;
  state.dibaca = [];
});

describe("halaman toko PWA — SPG hanya tokonya sendiri", () => {
  it("SPG membuka toko lain dikembalikan ke /pwa tanpa membaca toko itu", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-spg";
    await expect(buka("toko-lain")).rejects.toThrow("__REDIRECT__:/pwa");
    expect(state.dibaca).toEqual([]);
  });

  it("SPG membuka toko lain tetap ditolak walau kunci toko-sendiri mati", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-spg";
    state.terkunci = false;
    await expect(buka("toko-lain")).rejects.toThrow("__REDIRECT__:/pwa");
  });

  it("SPG membuka tokonya sendiri tetap boleh, tanpa angka komersial di payload", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-spg";
    const hasil = await buka("toko-spg");
    const shell = cari(hasil as ReactNode, "StoreDetailShell");
    expect(shell).not.toBeNull();
    const props = shell!.props as { spg: boolean; store: Record<string, unknown>; orders: unknown[] };
    expect(props.spg).toBe(true);
    expect(props.store.id).toBe("toko-spg");
    expect(props.store.markupPercent).toBeNull();
    expect(props.orders).toEqual([]);
    expect(state.dibaca).not.toContain("getStoreOrderSummary");
  });

  it("salesman tetap membuka toko mana pun selama kunci mati, lengkap dengan markup", async () => {
    state.sesi = { user: { id: "sales-9", permissions: ["pwa:access"] } };
    const hasil = await buka("toko-lain");
    const shell = cari(hasil as ReactNode, "StoreDetailShell");
    expect(shell).not.toBeNull();
    const props = shell!.props as { spg: boolean; store: Record<string, unknown> };
    expect(props.spg).toBe(false);
    expect(props.store.markupPercent).toBe(25);
    expect(props.store.paymentTempo).toBe(30);
  });

  it("salesman di toko orang lain saat kunci menyala tetap melihat BukanTokoSaya", async () => {
    state.sesi = { user: { id: "sales-9", permissions: ["pwa:access"] } };
    state.terkunci = true;
    const hasil = await buka("toko-lain");
    expect(cari(hasil as ReactNode, "BukanTokoSaya")).not.toBeNull();
    expect(cari(hasil as ReactNode, "StoreDetailShell")).toBeNull();
  });
});

describe("daftar toko PWA — SPG hanya tokonya sendiri", () => {
  it("SPG hanya menerima tokonya; daftar semua toko tidak dibaca", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-spg";
    const hasil = await halamanDaftar();
    const daftar = cari(hasil as ReactNode, "StoreList");
    expect(daftar).not.toBeNull();
    const props = daftar!.props as { stores: Array<{ id: string }>; milikSaya: string[] };
    expect(props.stores.map((s) => s.id)).toEqual(["toko-spg"]);
    expect(props.milikSaya).toEqual(["toko-spg"]);
    expect(state.dibaca).not.toContain("listActiveStoresForPwa");
  });

  it("SPG yang tokonya nonaktif menerima daftar kosong", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-spg";
    TOKO["toko-spg"].isActive = false;
    try {
      const hasil = await halamanDaftar();
      const props = cari(hasil as ReactNode, "StoreList")!.props as { stores: unknown[] };
      expect(props.stores).toEqual([]);
    } finally {
      TOKO["toko-spg"].isActive = true;
    }
  });

  it("salesman tetap menerima semua toko aktif seperti sebelumnya", async () => {
    state.sesi = { user: { id: "sales-9", permissions: ["pwa:access"] } };
    const hasil = await halamanDaftar();
    const props = cari(hasil as ReactNode, "StoreList")!.props as {
      stores: Array<{ id: string }>;
      milikSaya: string[];
    };
    expect(props.stores.map((s) => s.id)).toEqual(["toko-spg", "toko-lain"]);
    expect(props.milikSaya).toEqual(["toko-lain"]);
  });
});
