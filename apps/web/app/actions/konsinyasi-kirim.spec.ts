import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "Kirim titipan" dihentikan (keputusan 2026-10-29 #3): aksinya menolak `PAKAI_PENGIRIMAN` tanpa
 * memanggil penulis, tanpa mengantrekan push stok, dan tanpa mengabari SPG. Pemilih varian masih
 * hidup (dipakai formulir lain). Tanpa basis data: penulis dan antrean ditiru.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dikirim: [] as Record<string, unknown>[],
  push: [] as unknown[][],
  pilihan: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/konsinyasi/writer", () => ({
  kirimTitipan: vi.fn(async (input: Record<string, unknown>) => {
    state.dikirim.push(input);
    return { ok: true, id: "k1", noKirim: "KRM-1", ulang: false, barangBerubah: [] };
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
    return { diantrekan: [], sudahAntre: [], tanpaPemetaan: [], barisGabungan: [], gagal: false };
  }),
}));
vi.mock("@/lib/finance/operasional/kait", () => ({
  kaitBayarGajiKonsi: vi.fn(async () => {}),
  kaitSiklusKonsi: vi.fn(async () => {}),
}));

const aksi = await import("./konsinyasi");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dikirim = [];
  state.push = [];
  state.pilihan = [];
});

const baris = [{ itemId: "i1", variantSku: "B-M", itemName: "Blus", qty: 5, price: 100_000 }];
const kirim = () => aksi.kirimTitipanAction({ storeId: "s1", shippedAt: "2026-07-10", items: baris, idempotencyKey: "k-1" });

describe("kirimTitipanAction", () => {
  it("menolak PAKAI_PENGIRIMAN dan tidak menulis apa pun", async () => {
    masuk(["consignment:manage"]);
    expect(await kirim()).toEqual({ ok: false, kode: "PAKAI_PENGIRIMAN" });
    expect(state.dikirim).toEqual([]);
    expect(state.push).toEqual([]);
  });

  it("tanpa izin tetap TANPA_AKSES lebih dulu", async () => {
    masuk(["consignment:view"]);
    expect(await kirim()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dikirim).toEqual([]);
  });
});

describe("pilihanVarianKirimAction", () => {
  it("pengelola siklus melihat varian; tanpa izin ditolak", async () => {
    masuk(["consignment:manage"]);
    const r = await aksi.pilihanVarianKirimAction("i1");
    expect(r.ok).toBe(true);
    expect(state.pilihan).toEqual(["i1"]);
    masuk([]);
    expect(await aksi.pilihanVarianKirimAction("i1")).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });
});
