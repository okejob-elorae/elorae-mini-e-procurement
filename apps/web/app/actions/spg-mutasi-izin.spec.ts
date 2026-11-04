import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar keputusan kantor atas mutasi antar toko sesudah izinnya dipecah
 * (keputusan pemilik 2026-11-01). Dulu semuanya menumpang
 * `field_sales_orders:approve` — yang menyetujui pesanan lapangan sekalian
 * menyetujui mutasi, memutuskan selisihnya, dan mengatur arah mana yang boleh
 * dikirim tanpa persetujuan. Tanpa basis data: penulisnya ditiru, dan yang
 * diperiksa adalah apakah penulis sempat dipanggil.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dipanggil: [] as string[],
  disimpan: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => null) },
    systemSetting: {
      upsert: vi.fn(async (a: { update: { value: string } }) => {
        state.disimpan.push(a.update.value);
        return {};
      }),
    },
  },
}));
vi.mock("@/lib/stores/queries", () => ({ getActiveVisit: vi.fn(async () => null) }));
vi.mock("@/lib/pwa/kunjungan-antrean", () => ({ cariKunjunganAntrean: vi.fn(async () => null) }));
vi.mock("@/lib/spg/mutasi-writer", () => {
  const penulis = (nama: string) =>
    vi.fn(async () => {
      state.dipanggil.push(nama);
      return { ok: true, id: "m1", docNo: "MTS/2026/00001", status: "DISETUJUI" };
    });
  return {
    ajukanMutasi: vi.fn(),
    kirimMutasi: vi.fn(),
    terimaMutasiKantor: vi.fn(),
    setujuiMutasi: penulis("setujuiMutasi"),
    tolakMutasi: penulis("tolakMutasi"),
    batalkanMutasi: penulis("batalkanMutasi"),
    alihkanTujuanMutasi: penulis("alihkanTujuanMutasi"),
    putuskanSelisihMutasi: penulis("putuskanSelisihMutasi"),
  };
});

const aksi = await import("./spg-mutasi");
const { ATURAN_MUTASI_BAWAAN } = await import("@/lib/spg/mutasi-aturan");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dipanggil = [];
  state.disimpan = [];
});

const DITOLAK = { ok: false, code: "FORBIDDEN" };
const keputusan = () => [
  aksi.setujuiMutasiAction({ transferId: "m1" }),
  aksi.tolakMutasiAction({ transferId: "m1", teks: "stok tujuan penuh" }),
  aksi.batalkanMutasiKantorAction({ transferId: "m1", teks: "salah toko" }),
  aksi.alihkanTujuanMutasiAction({ transferId: "m1", toStoreId: "t3", teks: "toko tujuan tutup" }),
];
const selisih = () => aksi.putuskanSelisihMutasiAction({ transferId: "m1", keputusan: "HILANG" });

describe("menyetujui, menolak, membatalkan, mengalihkan: store_transfers:approve", () => {
  it("penyetuju pesanan lapangan dan pengelola toko ditolak sebelum menyentuh penulis", async () => {
    for (const izin of [["field_sales_orders:approve"], ["stores:manage"], ["store_transfers:decide_shortfall"]]) {
      masuk(izin);
      for (const hasil of await Promise.all(keputusan())) expect(hasil).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin persetujuan mutasi menjalankan keempatnya", async () => {
    masuk(["store_transfers:approve"]);
    for (const hasil of await Promise.all(keputusan())) expect(hasil.ok).toBe(true);
    expect(state.dipanggil.sort()).toEqual(["alihkanTujuanMutasi", "batalkanMutasi", "setujuiMutasi", "tolakMutasi"]);
  });
});

describe("memutuskan selisih mutasi: store_transfers:decide_shortfall", () => {
  it("penyetuju mutasi dan penyetuju pesanan lapangan ditolak", async () => {
    for (const izin of [["store_transfers:approve"], ["field_sales_orders:approve"]]) {
      masuk(izin);
      expect(await selisih()).toEqual(DITOLAK);
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin selisih memutuskannya", async () => {
    masuk(["store_transfers:decide_shortfall"]);
    expect((await selisih()).ok).toBe(true);
    expect(state.dipanggil).toEqual(["putuskanSelisihMutasi"]);
  });
});

describe("aturan mutasi: izin yang sama dengan menyetujui", () => {
  // Arah konsi → konsi boleh LANGSUNG: tanpa persetujuan kantor sama sekali.
  const tanpaPersetujuan = { ...ATURAN_MUTASI_BAWAAN, aturan: { ...ATURAN_MUTASI_BAWAAN.aturan, KONSI_KONSI: "LANGSUNG" as const } };

  it("penyetuju pesanan lapangan tidak bisa mematikan langkah persetujuan mutasi", async () => {
    masuk(["field_sales_orders:approve"]);
    expect(await aksi.simpanAturanMutasi(tanpaPersetujuan)).toEqual(DITOLAK);
    expect(state.disimpan).toEqual([]);
  });

  it("pemegang izin persetujuan mutasi menyimpan aturannya", async () => {
    masuk(["store_transfers:approve"]);
    expect(await aksi.simpanAturanMutasi(tanpaPersetujuan)).toEqual({ ok: true });
    expect(state.disimpan).toHaveLength(1);
    expect(JSON.parse(state.disimpan[0]).aturan.KONSI_KONSI).toBe("LANGSUNG");
  });
});
