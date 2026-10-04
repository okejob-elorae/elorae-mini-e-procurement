import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pagar baca halaman modul piutang.
 *
 * Halaman piutang, pelunasan (BKM), retur toko, kontrabon, beban selisih, dan
 * dasbornya dulu hanya menuntut sudah masuk. Rutenya sengaja tidak dipetakan di
 * ROUTE_PERMISSIONS (proxy meloloskannya) dan layout backoffice tidak menjaga —
 * jadi salesman, SPG, dan orang produksi membuka piutang SELURUH toko lewat
 * alamat yang diketik. Setiap halaman kini memagari dirinya sendiri, dan pagar
 * itu dipasang SEBELUM data dibaca. Daftar giro sudah berpagar sebelumnya; ia
 * ikut diuji supaya pagarnya tetap satu predikat dengan daftar BKM.
 *
 * Tanpa basis data — semua tiruan. Yang diuji: pengguna di luar kembali ke
 * /backoffice tanpa satu kueri pun berjalan, dan pengguna kantor yang sah tetap
 * masuk.
 */

const state = {
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dibaca: 0,
};

const baca = <T,>(nilai: T) =>
  vi.fn(async () => {
    state.dibaca += 1;
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

vi.mock("@elorae/db", () => ({
  prisma: {
    paymentClaim: { findMany: baca([]), findUnique: baca(null) },
    storeReturn: { findMany: baca([]), findUnique: baca(null) },
    storeStockMovement: { count: baca(0) },
  },
}));

vi.mock("@/lib/receivables/queries", () => ({
  daftarPiutang: baca([]),
  ringkasPiutang: vi.fn(() => ({})),
}));
vi.mock("@/lib/receivables/return-queries", () => ({
  katalogBarang: baca([]),
  tokoUntukRetur: baca([]),
  daftarKerjaRetur: baca([]),
  notaBelumBerpasangan: baca([]),
  ringkasKerjaRetur: vi.fn(() => ({})),
  kandidatPenanggung: baca([]),
  rincianRetur: baca({ baris: {}, gudang: null }),
}));
vi.mock("@/lib/receivables/claim-queries", () => ({
  rincianKlaim: baca({ id: "k1", status: "DIKIRIM" }),
}));
vi.mock("@/lib/receivables/tugas-tagih-queries", () => ({ tautanPesanKlaim: baca(new Map()) }));
vi.mock("@/lib/receivables/koreksi", () => ({
  koreksiTertunda: baca(new Map()),
  penggantiUntuk: baca(new Map()),
  riwayatDokumen: baca([]),
}));
vi.mock("@/lib/receivables/dashboard-queries", () => ({
  muatDasbor: baca({}),
  daftarBeban: baca([]),
}));
vi.mock("@/lib/receivables/giro-queries", () => ({
  giroMenunggu: baca([]),
  giroBaruDiputuskan: baca([]),
}));
vi.mock("@/lib/receivables/collection-queries", () => ({
  daftarKontrabon: baca([]),
  piutangSiapKontrabon: baca([]),
  rincianKontrabon: baca({ id: "kb1" }),
}));

// Komponen klien tidak dirender di sini — yang diuji hanya pagarnya.
vi.mock("@/app/backoffice/piutang/PiutangClient", () => ({ PiutangClient: () => null }));
vi.mock("@/app/backoffice/pelunasan/PelunasanClient", () => ({ PelunasanClient: () => null }));
vi.mock("@/app/backoffice/pelunasan/[id]/RincianKlaimClient", () => ({ RincianKlaimClient: () => null }));
vi.mock("@/app/backoffice/pelunasan/giro/DaftarGiroClient", () => ({ DaftarGiroClient: () => null }));
vi.mock("@/app/backoffice/pelunasan-dasbor/DasborClient", () => ({ DasborClient: () => null }));
vi.mock("@/app/backoffice/retur-toko/ReturTokoClient", () => ({ ReturTokoClient: () => null }));
vi.mock("@/app/backoffice/retur-toko/[id]/RincianReturClient", () => ({ RincianReturClient: () => null }));
vi.mock("@/app/backoffice/kontrabon/KontrabonClient", () => ({ KontrabonClient: () => null }));
vi.mock("@/app/backoffice/kontrabon/[id]/RincianKontrabonClient", () => ({ RincianKontrabonClient: () => null }));
vi.mock("@/app/backoffice/beban-selisih/BebanClient", () => ({ BebanClient: () => null }));

const halamanPiutang = (await import("@/app/backoffice/piutang/page")).default;
const halamanPelunasan = (await import("@/app/backoffice/pelunasan/page")).default;
const halamanRincianKlaim = (await import("@/app/backoffice/pelunasan/[id]/page")).default;
const halamanGiro = (await import("@/app/backoffice/pelunasan/giro/page")).default;
const halamanDasbor = (await import("@/app/backoffice/pelunasan-dasbor/page")).default;
const halamanRetur = (await import("@/app/backoffice/retur-toko/page")).default;
const halamanRincianRetur = (await import("@/app/backoffice/retur-toko/[id]/page")).default;
const halamanKontrabon = (await import("@/app/backoffice/kontrabon/page")).default;
const halamanRincianKontrabon = (await import("@/app/backoffice/kontrabon/[id]/page")).default;
const halamanBeban = (await import("@/app/backoffice/beban-selisih/page")).default;

const id = { params: Promise.resolve({ id: "x1" }) };

// Tujuan persis, bukan awalan: "/backoffice/pelunasan" juga diawali "/backoffice".
const KE_BACKOFFICE = /^__REDIRECT__:\/backoffice$/;
const KE_LOGIN = /^__REDIRECT__:\/login$/;

/** Setiap halaman beserta siapa yang SAH membukanya. */
const HALAMAN: { nama: string; buka: () => Promise<unknown>; sah: string[][] }[] = [
  {
    nama: "piutang",
    buka: () => halamanPiutang({ searchParams: Promise.resolve({}) }),
    sah: [["receivables:view"], ["receivables:manage"]],
  },
  {
    nama: "pelunasan",
    buka: () => halamanPelunasan(),
    sah: [["receivables:view"], ["receivables:manage"], ["journals:manage"]],
  },
  {
    nama: "pelunasan/[id]",
    buka: () => halamanRincianKlaim(id),
    sah: [["receivables:view"], ["receivables:manage"], ["journals:manage"]],
  },
  {
    // Satu predikat dengan daftar BKM: yang boleh membuka daftar boleh membuka giro.
    nama: "pelunasan/giro",
    buka: () => halamanGiro(),
    sah: [["receivables:view"], ["receivables:manage"], ["journals:manage"]],
  },
  {
    nama: "pelunasan-dasbor",
    buka: () => halamanDasbor(),
    sah: [["receivables:view"], ["receivables:manage"]],
  },
  {
    nama: "retur-toko",
    buka: () => halamanRetur(),
    sah: [["receivables:view"], ["receivables:manage"], ["inventory_opname:count"], ["journals:manage"]],
  },
  {
    nama: "retur-toko/[id]",
    buka: () => halamanRincianRetur(id),
    sah: [["receivables:view"], ["receivables:manage"], ["inventory_opname:count"], ["journals:manage"]],
  },
  { nama: "kontrabon", buka: () => halamanKontrabon(), sah: [["receivables:view"], ["receivables:manage"]] },
  {
    nama: "kontrabon/[id]",
    buka: () => halamanRincianKontrabon(id),
    sah: [["receivables:view"], ["receivables:manage"]],
  },
  {
    nama: "beban-selisih",
    buka: () => halamanBeban(),
    sah: [["receivables:view"], ["receivables:manage"]],
  },
];

/** Bukan orang piutang: lapangan, produksi, pembelian, konsinyasi saja. */
const LUAR: [string, string[]][] = [
  ["salesman", ["pwa:access"]],
  ["SPG", ["pwa:access", "spg_sales:record"]],
  ["produksi", ["dashboard:view", "work_orders:view", "inventory_opname:view"]],
  ["pembelian", ["dashboard:view", "purchase_orders:view"]],
  ["konsinyasi saja", ["consignment:view", "consignment:manage"]],
];

beforeEach(() => {
  state.sesi = null;
  state.dibaca = 0;
});

describe("halaman modul piutang — pagar baca", () => {
  for (const h of HALAMAN) {
    describe(h.nama, () => {
      it("sends a signed-out visitor to /login", async () => {
        await expect(h.buka()).rejects.toThrow(KE_LOGIN);
        expect(state.dibaca).toBe(0);
      });

      for (const [peran, izin] of LUAR) {
        it(`refuses ${peran} before reading any data`, async () => {
          state.sesi = { user: { id: "u1", permissions: izin } };
          await expect(h.buka()).rejects.toThrow(KE_BACKOFFICE);
          expect(state.dibaca).toBe(0);
        });
      }

      // Keuangan tidak membuka piutang/kontrabon/beban/dasbor; gudang hanya retur.
      if (!h.sah.some((izin) => izin.includes("journals:manage"))) {
        it("refuses finance (journals:manage) where it has no work", async () => {
          state.sesi = { user: { id: "u1", permissions: ["journals:manage"] } };
          await expect(h.buka()).rejects.toThrow(KE_BACKOFFICE);
        });
      }
      if (!h.sah.some((izin) => izin.includes("inventory_opname:count"))) {
        it("refuses the warehouse (inventory_opname:count) where it has no work", async () => {
          state.sesi = { user: { id: "u1", permissions: ["inventory_opname:count"] } };
          await expect(h.buka()).rejects.toThrow(KE_BACKOFFICE);
        });
      }

      for (const izin of [...h.sah, ["*"]]) {
        it(`lets ${izin.join("+")} in`, async () => {
          state.sesi = { user: { id: "u1", permissions: izin } };
          await expect(h.buka()).resolves.toBeDefined();
          expect(state.dibaca).toBeGreaterThan(0);
        });
      }
    });
  }
});
