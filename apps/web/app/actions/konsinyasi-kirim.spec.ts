import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi "Kirim titipan": kunci formulir diteruskan, rincian kurang stok sampai ke layar, dan
 * push stok Jubelio diantrekan SESUDAH kiriman tercatat — sekali, bukan pada kiriman ulang.
 * Tanpa basis data: penulis dan antrean ditiru.
 */

type HasilTiruan = Record<string, unknown>;

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dikirim: [] as Record<string, unknown>[],
  hasil: { ok: true } as HasilTiruan,
  push: [] as unknown[][],
  pushGagal: false,
  pilihan: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/konsinyasi/writer", () => ({
  kirimTitipan: vi.fn(async (input: Record<string, unknown>) => {
    state.dikirim.push(input);
    return state.hasil;
  }),
}));
vi.mock("@/lib/konsinyasi/laporan-spg", () => ({ bahanLaporanSpg: vi.fn() }));
vi.mock("@/lib/konsinyasi/varian-kirim", () => ({
  pilihanVarianKirim: vi.fn(async (itemId: string) => {
    state.pilihan.push(itemId);
    return { perluVarian: true, varian: [{ sku: "B-M", label: "M (B-M)", tersedia: 4 }], tersediaTanpaVarian: null };
  }),
}));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({
  antrekanPushStok: vi.fn(async (...args: unknown[]) => {
    state.push.push(args);
    if (state.pushGagal) throw new Error("antrean mati");
    return { diantrekan: [], sudahAntre: [], tanpaPemetaan: [], barisGabungan: [], gagal: false };
  }),
}));

const aksi = await import("./konsinyasi");

const KELOLA = ["consignment:manage"];
const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dikirim = [];
  state.hasil = { ok: true };
  state.push = [];
  state.pushGagal = false;
  state.pilihan = [];
});

const baris = [{ itemId: "i1", variantSku: "B-M", itemName: "Blus", qty: 5, price: 100_000 }];
const kirim = (over: Record<string, unknown> = {}) =>
  aksi.kirimTitipanAction({ storeId: "t1", shippedAt: "2026-10-02", items: baris, idempotencyKey: "kunci-1", ...over });

describe("kirimTitipanAction", () => {
  it("tanpa izin: ditolak, penulis tidak dipanggil", async () => {
    expect(await kirim()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    masuk(["consignment:view", "receivables:manage"]);
    expect(await kirim()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dikirim).toHaveLength(0);
  });

  it("berhasil: kunci & varian diteruskan, push stok Jubelio diantrekan untuk barang yang bergerak", async () => {
    masuk(KELOLA);
    state.hasil = { ok: true, id: "k1", noKirim: "KKIRIM/2026/0007", ulang: false, barangBerubah: ["i1"] };
    expect(await kirim()).toEqual({ ok: true, noKirim: "KKIRIM/2026/0007", ulang: false });
    expect(state.dikirim[0]).toMatchObject({ storeId: "t1", idempotencyKey: "kunci-1", olehUserId: "u1", items: baris });
    expect(state.push).toEqual([[["i1"], { sumber: "ADJUSTMENT", ref: "KKIRIM/2026/0007", userId: "u1" }]]);
  });

  it("kiriman ulang (kunci sudah tercatat): berhasil tanpa push kedua", async () => {
    masuk(KELOLA);
    state.hasil = { ok: true, id: "k1", noKirim: "KKIRIM/2026/0007", ulang: true, barangBerubah: [] };
    expect(await kirim()).toEqual({ ok: true, noKirim: "KKIRIM/2026/0007", ulang: true });
    expect(state.push).toHaveLength(0);
  });

  it("stok kurang: rincian kurang sampai ke layar, tidak ada push", async () => {
    masuk(KELOLA);
    const kurang = [{ itemId: "i1", variantSku: "B-M", itemName: "Blus", variantLabel: "M (B-M)", requested: 16, available: 12 }];
    state.hasil = { ok: false, alasan: "STOK_KURANG", kurang };
    expect(await kirim()).toEqual({ ok: false, kode: "STOK_KURANG", kurang });
    expect(state.push).toHaveLength(0);
  });

  it("antrean push gagal: kirimannya tetap sah", async () => {
    masuk(KELOLA);
    state.pushGagal = true;
    state.hasil = { ok: true, id: "k1", noKirim: "KKIRIM/2026/0008", ulang: false, barangBerubah: ["i1"] };
    expect(await kirim()).toEqual({ ok: true, noKirim: "KKIRIM/2026/0008", ulang: false });
  });

  it("jumlah bukan bilangan bulat atau harga tidak sah: ditolak sebelum penulis", async () => {
    masuk(KELOLA);
    expect(await kirim({ items: [{ ...baris[0], qty: 1.5 }] })).toEqual({ ok: false, kode: "NILAI_TIDAK_VALID" });
    expect(await kirim({ items: [{ ...baris[0], price: -1 }] })).toEqual({ ok: false, kode: "NILAI_TIDAK_VALID" });
    expect(await kirim({ items: [{ ...baris[0], price: Number.NaN }] })).toEqual({ ok: false, kode: "NILAI_TIDAK_VALID" });
    expect(state.dikirim).toHaveLength(0);
  });
});

describe("pilihanVarianKirimAction", () => {
  it("hanya pengelola konsinyasi", async () => {
    expect(await aksi.pilihanVarianKirimAction("i1")).toEqual({ ok: false, kode: "TANPA_AKSES" });
    masuk(KELOLA);
    expect(await aksi.pilihanVarianKirimAction("i1")).toEqual({
      ok: true,
      pilihan: { perluVarian: true, varian: [{ sku: "B-M", label: "M (B-M)", tersedia: 4 }], tersediaTanpaVarian: null },
    });
    expect(state.pilihan).toEqual(["i1"]);
  });
});
