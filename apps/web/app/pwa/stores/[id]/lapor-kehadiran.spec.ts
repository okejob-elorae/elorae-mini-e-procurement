import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Halaman toko salesman: ubin lapor pelunasan/retur di luar kunjungan dan
 * kartu kehadiran SPG hari ini, keduanya di slot tepat di bawah ringkasan toko.
 * Selama kunjungan, ubin lapor ada di kartu Kunjungan berjalan (bukan di sini).
 * SPG tidak mendapat keduanya dan kehadiran tidak dibaca untuknya.
 * Tanpa basis data — semua tiruan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  aktif: null as null | { id: string; storeId: string },
  kehadiranDibaca: [] as Array<{ storeId: string; sekarang: Date }>,
}));

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
  getStore: vi.fn(async (id: string) => ({
    id,
    salesmanId: "sales-1",
    isActive: true,
    code: "T1",
    name: "Toko Satu",
    address: "Jl. Uji",
    phone: null,
    contactName: null,
    termsType: "PUTUS" as const,
    paymentTempo: 30,
    marginPercent: null,
    lat: null,
    lng: null,
    storeClass: null,
  })),
  listVisitsForStore: vi.fn(async () => []),
  getActiveVisit: vi.fn(async () =>
    state.aktif
      ? {
          ...state.aktif,
          store: { name: "Toko Satu" },
          checkinOutOfRadius: false,
          checkinDistanceMeters: null,
          checkinAt: new Date("2026-10-06T01:00:00.000Z"),
        }
      : null,
  ),
  listVisitPhotos: vi.fn(async () => []),
}));
vi.mock("@/lib/store-changes/queries", () => ({ getPendingStoreChangeRequest: vi.fn(async () => null) }));
vi.mock("@/lib/field-sales/queries", () => ({ getStoreOrderSummary: vi.fn(async () => []) }));
vi.mock("@/lib/salesman/ringkasan-toko", () => ({ ringkasanToko: vi.fn(async () => null) }));
vi.mock("@/lib/salesman/dasbor", () => ({
  polaPesanan: () => ({ hariSejak: null, jedaMedian: null, waktunya: false }),
}));
vi.mock("@/lib/salesman/queries", () => ({
  saranPesananToko: vi.fn(async () => ({ tanggalPesanan: [], terakhir: null, promo: [] })),
  tokoTerkunci: vi.fn(async () => false),
}));
vi.mock("@/lib/salesman/saran-tawar-queries", () => ({ saranTawarToko: vi.fn(async () => null) }));
vi.mock("@/lib/konsinyasi/stok-di-toko", () => ({ kartuStokDiToko: vi.fn(async () => null) }));
vi.mock("@/lib/field-sales/jarak-jauh-toko", () => ({ izinJarakJauh: vi.fn(async () => ({ boleh: false })) }));
vi.mock("@/lib/stores/catatan-queries", () => ({
  aksesCatatanToko: vi.fn(async () => ({ boleh: false, kelolaSemua: false })),
  catatanTokoUntuk: vi.fn(async () => []),
}));
vi.mock("@/lib/field-sales/inden-queries", () => ({ jendelaIndenTerbuka: vi.fn(async () => []) }));
vi.mock("@/lib/spg/kehadiran-toko", async (asli) => ({
  ...(await asli<typeof import("@/lib/spg/kehadiran-toko")>()),
  kehadiranSpgToko: vi.fn(async (storeId: string, sekarang: Date) => {
    state.kehadiranDibaca.push({ storeId, sekarang });
    return [
      {
        userId: "spg-1",
        nama: "Rina",
        keadaan: "DI_TOKO",
        masuk: new Date("2026-10-06T01:15:00.000Z"),
        pulang: null,
        jenisIzin: null,
        jadwalMulai: null,
      },
    ];
  }),
}));

// Komponen klien tidak dirender — yang diuji hanya susunan props-nya.
vi.mock("@/app/pwa/stores/[id]/StoreDetailShell", () => ({
  StoreDetailShell: function StoreDetailShell() {
    return null;
  },
}));
vi.mock("@/app/pwa/stores/[id]/BukanTokoSaya", () => ({ BukanTokoSaya: () => null }));
vi.mock("@/app/pwa/stores/[id]/SaranTawar", () => ({ SaranTawar: () => null }));
vi.mock("@/app/pwa/stores/[id]/StokDiToko", () => ({ StokDiToko: () => null }));
vi.mock("@/app/pwa/stores/[id]/TombolPortalToko", () => ({ TombolPortalToko: () => null }));
vi.mock("@/app/pwa/stores/[id]/CatatanToko", () => ({ CatatanToko: () => null }));
vi.mock("@/app/pwa/stores/[id]/TombolPreorder", () => ({ TombolPreorder: () => null }));
vi.mock("@/app/pwa/stores/[id]/LanjutSetelahCheckIn", () => ({ LanjutSetelahCheckIn: () => null }));
vi.mock("@/app/pwa/stores/[id]/KehadiranSpgToko", () => ({
  KehadiranSpgToko: function KehadiranSpgToko() {
    return null;
  },
}));
vi.mock("@/app/pwa/stores/[id]/UbinLapor", () => ({
  LaporDariToko: function LaporDariToko() {
    return null;
  },
}));

const halamanToko = (await import("@/app/pwa/stores/[id]/page")).default;
const buka = (id: string) => halamanToko({ params: Promise.resolve({ id }) });

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
  if (typeof tipe !== "string" && tipe !== Fragment && tipe?.name === nama) return el;
  return cari(el.props.children as ReactNode, nama);
}

/** Isi slot di bawah ringkasan toko (prop `catatanToko` StoreDetailShell). */
async function slotBawahRingkasan() {
  const shell = cari((await buka("toko-1")) as ReactNode, "StoreDetailShell");
  expect(shell).not.toBeNull();
  return shell!.props.catatanToko as ReactNode;
}

beforeEach(() => {
  state.sesi = { user: { id: "sales-1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.aktif = null;
  state.kehadiranDibaca = [];
});

describe("halaman toko salesman — lapor dari toko dan kehadiran SPG", () => {
  it("di luar kunjungan: ubin lapor untuk toko ini + kehadiran SPG berjam WIB", async () => {
    const slot = await slotBawahRingkasan();
    const lapor = cari(slot, "LaporDariToko");
    expect(lapor?.props).toMatchObject({ storeId: "toko-1", termsType: "PUTUS" });
    const kehadiran = cari(slot, "KehadiranSpgToko");
    expect(kehadiran?.props.baris).toEqual([
      { userId: "spg-1", nama: "Rina", keadaan: "DI_TOKO", masuk: "08.15", pulang: null, jenisIzin: null, jadwalMulai: null },
    ]);
    expect(state.kehadiranDibaca.map((k) => k.storeId)).toEqual(["toko-1"]);
  });

  it("selama kunjungan di toko ini: ubin lapor pindah ke kartu kunjungan, kehadiran tetap tampil", async () => {
    state.aktif = { id: "v-1", storeId: "toko-1" };
    const slot = await slotBawahRingkasan();
    expect(cari(slot, "LaporDariToko")).toBeNull();
    expect(cari(slot, "KehadiranSpgToko")).not.toBeNull();
  });

  it("kunjungan di toko LAIN tidak menyembunyikan ubin lapor toko ini", async () => {
    state.aktif = { id: "v-2", storeId: "toko-lain" };
    expect(cari(await slotBawahRingkasan(), "LaporDariToko")).not.toBeNull();
  });

  it("SPG di tokonya: tanpa ubin lapor, kehadiran tidak dibaca", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-1";
    const slot = await slotBawahRingkasan();
    expect(cari(slot, "LaporDariToko")).toBeNull();
    expect(cari(slot, "KehadiranSpgToko")?.props.baris).toEqual([]);
    expect(state.kehadiranDibaca).toEqual([]);
  });
});
