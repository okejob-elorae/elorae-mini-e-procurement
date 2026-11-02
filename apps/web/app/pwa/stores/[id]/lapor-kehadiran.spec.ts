import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDisplayDate } from "@/lib/date-only";

/*
 * Halaman toko salesman: ubin lapor pelunasan/retur di luar kunjungan,
 * kartu kehadiran SPG hari ini, dan kartu pesanan konsinyasi lama yang
 * menunggu konfirmasi sampai — semuanya di slot tepat di bawah ringkasan toko.
 * Selama kunjungan, ubin lapor ada di kartu Kunjungan berjalan (bukan di sini).
 * SPG tidak mendapat semuanya, dan kehadiran maupun pesanan lama tidak dibaca
 * untuknya. Tanpa basis data — semua tiruan.
 */

type PesananLamaTiruan = {
  orderId: string;
  orderNo: string;
  storeId: string;
  salesmanId: string;
  approvedAt: Date;
  createdAt: Date;
  baris: Array<{ lineId: string; itemId: string; variantSku: string; productName: string; sisa: number }>;
  jumlahPcs: number;
};

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  aktif: null as null | { id: string; storeId: string },
  kehadiranDibaca: [] as Array<{ storeId: string; sekarang: Date }>,
  pesananLama: [] as PesananLamaTiruan[],
  pesananLamaDibaca: [] as string[][],
  penerima: { penerima: "SALESMAN", pemegangTokoId: "sales-1", namaPemegang: "Budi", jumlahSpg: 0 } as {
    penerima: "SPG" | "SALESMAN" | "TANPA_PENERIMA";
    pemegangTokoId: string | null;
    namaPemegang: string | null;
    jumlahSpg: number;
  },
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
    markupPercent: null,
    priceDiscountPercent: null,
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
vi.mock("@/lib/field-sales/konsi-transfer/pesanan-lama", () => ({
  bacaPesananKonsiCadanganLama: vi.fn(async (_klien: unknown, lingkup: { storeIds?: readonly string[] }) => {
    state.pesananLamaDibaca.push([...(lingkup.storeIds ?? [])]);
    return new Map(state.pesananLama.map((o) => [o.orderId, o]));
  }),
  muatPenerimaToko: vi.fn(async () => state.penerima),
}));
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
vi.mock("@/app/pwa/stores/[id]/PesananLamaToko", () => ({
  PesananLamaToko: function PesananLamaToko() {
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
  state.pesananLama = [];
  state.pesananLamaDibaca = [];
  state.penerima = { penerima: "SALESMAN", pemegangTokoId: "sales-1", namaPemegang: "Budi", jumlahSpg: 0 };
});

describe("halaman toko salesman — lapor dari toko dan kehadiran SPG", () => {
  it("di luar kunjungan: ubin lapor untuk toko ini + kehadiran SPG berjam WIB", async () => {
    const slot = await slotBawahRingkasan();
    const lapor = cari(slot, "LaporDariToko");
    expect(lapor?.props).toMatchObject({ storeId: "toko-1", termsType: "PUTUS" });
    const kehadiran = cari(slot, "KehadiranSpgToko");
    expect(kehadiran?.props.baris).toEqual([
      { userId: "spg-1", nama: "Rina", keadaan: "DI_TOKO", masuk: "08.15", pulang: null, jadwalMulai: null },
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

describe("halaman toko salesman — pesanan konsinyasi lama menunggu konfirmasi sampai", () => {
  const approvedAt = new Date("2026-08-10T03:00:00.000Z");
  const pesananLama = (): PesananLamaTiruan => ({
    orderId: "o-1",
    orderNo: "KONSI/2026/0007",
    storeId: "toko-1",
    salesmanId: "sales-1",
    approvedAt,
    createdAt: approvedAt,
    baris: [
      { lineId: "l-1", itemId: "i-1", variantSku: "KAOS-M", productName: "Kaos Uji", sisa: 4 },
      { lineId: "l-2", itemId: "i-1", variantSku: "KAOS-L", productName: "Kaos Uji", sisa: 2 },
    ],
    jumlahPcs: 6,
  });

  it("pemegang yang check-in di toko ini: kartunya di slot, dibaca hanya untuk toko ini, tanpa harga", async () => {
    state.aktif = { id: "v-1", storeId: "toko-1" };
    state.pesananLama = [pesananLama()];
    const kartu = cari(await slotBawahRingkasan(), "PesananLamaToko");
    expect(kartu?.props).toEqual({
      storeId: "toko-1",
      pesanan: [
        { id: "o-1", orderNo: "KONSI/2026/0007", disetujuiLabel: formatDisplayDate(approvedAt), jumlahBarang: 2, pcs: 6 },
      ],
      penerima: "SALESMAN",
      sayaPemegang: true,
      sudahCheckIn: true,
    });
    expect(JSON.stringify(kartu?.props)).not.toMatch(/harga|price|total/i);
    expect(state.pesananLamaDibaca).toEqual([["toko-1"]]);
  });

  it("salesman lain tanpa kunjungan di toko ini: kartu tetap tampil, tetapi bukan pemegang dan belum check-in", async () => {
    state.sesi = { user: { id: "sales-9", permissions: ["pwa:access"] } };
    state.aktif = { id: "v-2", storeId: "toko-lain" };
    state.pesananLama = [pesananLama()];
    const kartu = cari(await slotBawahRingkasan(), "PesananLamaToko");
    expect(kartu?.props).toMatchObject({ penerima: "SALESMAN", sayaPemegang: false, sudahCheckIn: false });
  });

  it("tanpa pesanan lama: tidak ada kartu", async () => {
    expect(cari(await slotBawahRingkasan(), "PesananLamaToko")).toBeNull();
    expect(state.pesananLamaDibaca).toEqual([["toko-1"]]);
  });

  it("SPG di tokonya: pesanan lama tidak dibaca di halaman toko (dikonfirmasi dari Terima kiriman)", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-1";
    state.pesananLama = [pesananLama()];
    expect(cari(await slotBawahRingkasan(), "PesananLamaToko")).toBeNull();
    expect(state.pesananLamaDibaca).toEqual([]);
  });
});
