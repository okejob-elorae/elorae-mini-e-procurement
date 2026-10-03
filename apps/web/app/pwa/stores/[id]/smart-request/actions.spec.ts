import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: auth, peran, kunci toko, pemuat bahan, rasio pack, dan penulis
 * pesanan ditirukan — tidak menyentuh basis data. Yang dipasak: penjaga server
 * (SPG, pwa:access, toko aktif, kunci "hanya toko sendiri") menolak SEBELUM
 * apa pun dibaca atau ditulis; HP tidak pernah bisa mengirim harga; draf
 * konsinyasi tidak membawa harga walaupun pemuat (keliru) memberinya.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  tokoTetap: vi.fn(async (): Promise<string | null> => null),
  terkunci: vi.fn(async () => false),
  store: vi.fn(),
  kategori: vi.fn(async () => [{ id: "k1", name: "Kaos" }]),
  rasio: vi.fn(async () => [
    { size: "S", qty: 1 },
    { size: "M", qty: 2 },
  ]),
  muat: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: h.tokoTetap }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: h.terkunci }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", () => ({ prisma: { store: { findUnique: h.store }, itemCategory: { findMany: h.kategori } } }));
vi.mock("@/app/actions/settings/pack-ratio", () => ({ getPackRatio: h.rasio }));
vi.mock("@/lib/field-sales/smart-request/rencana-queries", () => ({ muatBahanRencana: h.muat }));
vi.mock("@/lib/field-sales/writer", () => ({ createFieldSalesOrder: h.create }));

import { KreditDiblokirError } from "@/lib/field-sales/kredit-pesanan";
import { NoActiveVisitError } from "@/lib/field-sales/errors";
import { bangunRencanaKirimAction, kirimRencanaKirimAction } from "./actions";

const kriteria = {
  storeId: "s1",
  kategoriIds: ["k1"],
  sumber: ["BELUM_DIKIRIM"],
  jumlah: { mode: "PCS", pcs: 6 },
  hariBaru: 90,
  lewatiSisaMin: null,
  maksArtikel: 10,
  anggaran: 1_000_000,
};
const kiriman = {
  storeId: "s1",
  visitId: "v1",
  idempotencyKey: "kunci-draf-1",
  lines: [{ itemId: "i1", variantSku: "i1-S", productName: "Kaos — S", qty: 2, unitPrice: 99_999 }],
};

const toko = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  isActive: true,
  termsType: "PUTUS",
  marginPercent: null,
  salesmanId: "u1",
  ...over,
});

/** Bahan satu barang i1 dengan dua ukuran. `harga` sengaja diisi juga di `info` untuk konsinyasi. */
const bahanSatuBarang = () => ({
  bahan: {
    kandidat: [
      {
        itemId: "i1",
        sku: "KAOS-1",
        kategoriId: "k1",
        variants: [
          { variantSku: "i1-S", size: "S" },
          { variantSku: "i1-M", size: "M" },
        ],
        available: { "i1-S": 9, "i1-M": 9 },
        harga: null,
      },
    ],
    pernahDikirim: new Set<string>(),
    stokTokoDiketahui: false,
    stokToko: new Map(),
    dipesanToko: new Map(),
    jualTokoLain: new Map(),
    umurHari: new Map(),
  },
  info: new Map([["i1", { sku: "KAOS-1", nama: "Kaos Satu", kategoriId: "k1", variantsMentah: [], harga: 12_345 }]]),
  dasarLaku: "RIWAYAT_PESANAN",
});

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
  h.tokoTetap.mockReset().mockResolvedValue(null);
  h.terkunci.mockReset().mockResolvedValue(false);
  h.store.mockReset().mockResolvedValue(toko());
  h.muat.mockReset().mockResolvedValue(bahanSatuBarang());
  h.create.mockReset().mockResolvedValue({ orderId: "o1", orderNo: "PUTUS/1", oversell: [], kreditDitahan: false });
});

describe("penjaga server rencana kirim", () => {
  it.each([
    ["SPG (toko tetap)", () => h.tokoTetap.mockResolvedValue("toko-spg")],
    ["tanpa pwa:access", () => h.auth.mockResolvedValue({ user: { id: "u1", permissions: [] } })],
    ["tanpa sesi", () => h.auth.mockResolvedValue(null)],
  ])("refuses %s on build and send, before anything is read or written", async (_n, atur) => {
    atur();
    expect(await bangunRencanaKirimAction(kriteria)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await kirimRencanaKirimAction(kiriman)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(h.store).not.toHaveBeenCalled();
    expect(h.muat).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses an inactive or missing store", async () => {
    h.store.mockResolvedValue(toko({ isActive: false }));
    expect(await bangunRencanaKirimAction(kriteria)).toEqual({ ok: false, code: "TOKO_TIDAK_AKTIF" });
    expect(await kirimRencanaKirimAction(kiriman)).toEqual({ ok: false, code: "TOKO_TIDAK_AKTIF" });
    h.store.mockResolvedValue(null);
    expect(await bangunRencanaKirimAction(kriteria)).toEqual({ ok: false, code: "TOKO_TIDAK_AKTIF" });
    expect(h.muat).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses a store held by someone else while the own-store lock is on, and allows it when off", async () => {
    h.store.mockResolvedValue(toko({ salesmanId: "orang-lain" }));
    h.terkunci.mockResolvedValue(true);
    expect(await bangunRencanaKirimAction(kriteria)).toEqual({ ok: false, code: "BUKAN_TOKO_SAYA" });
    expect(await kirimRencanaKirimAction(kiriman)).toEqual({ ok: false, code: "BUKAN_TOKO_SAYA" });
    expect(h.create).not.toHaveBeenCalled();
    h.terkunci.mockResolvedValue(false);
    expect((await bangunRencanaKirimAction(kriteria)).ok).toBe(true);
  });

  it("refuses malformed criteria and out-of-range numbers", async () => {
    expect(await bangunRencanaKirimAction({ ...kriteria, sumber: [] })).toEqual({ ok: false, code: "TIDAK_VALID" });
    expect(await bangunRencanaKirimAction({ ...kriteria, sumber: ["SEMBARANG"] })).toEqual({ ok: false, code: "TIDAK_VALID" });
    expect(await bangunRencanaKirimAction({ ...kriteria, jumlah: { mode: "PCS", pcs: 5000 } })).toEqual({ ok: false, code: "TIDAK_VALID" });
    expect(await bangunRencanaKirimAction({ ...kriteria, maksArtikel: 0 })).toEqual({ ok: false, code: "TIDAK_VALID" });
    expect(h.muat).not.toHaveBeenCalled();
  });

  it("one pack without a pack ratio is refused with NO_RATIO", async () => {
    h.rasio.mockResolvedValueOnce([]);
    expect(await bangunRencanaKirimAction({ ...kriteria, jumlah: { mode: "PACK" } })).toEqual({ ok: false, code: "NO_RATIO" });
  });
});

describe("bangunRencanaKirimAction", () => {
  it("a consignment draft carries no price, total or rupiah — even if the loader handed one over", async () => {
    h.store.mockResolvedValue(toko({ termsType: "KONSI", marginPercent: 30 }));
    const r = await bangunRencanaKirimAction(kriteria);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.konsi).toBe(true);
    expect(r.artikel.map((a) => a.baris.map((b) => [b.variantSku, b.qty]))).toEqual([[["i1-S", 2], ["i1-M", 4]]]);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/harga|price|total|nilai|anggaran|budget|rupiah/i);
    expect(json).not.toContain("Rp");
    expect(json).not.toContain("12345");
    expect(h.muat).toHaveBeenCalledWith(expect.objectContaining({ termsType: "KONSI", storeId: "s1" }));
  });

  it("a putus draft prices every line from the server and honours the budget", async () => {
    h.muat.mockResolvedValue({
      ...bahanSatuBarang(),
      bahan: { ...bahanSatuBarang().bahan, kandidat: bahanSatuBarang().bahan.kandidat.map((k) => ({ ...k, harga: 12_345 })) },
    });
    const r = await bangunRencanaKirimAction(kriteria);
    expect(r.ok && !r.konsi && r.artikel[0].baris.every((b) => b.hargaSatuan === 12_345)).toBe(true);

    // 6 × 12.345 = 74.070 > 50.000 → dilewati, bukan dipotong diam-diam.
    const kecil = await bangunRencanaKirimAction({ ...kriteria, anggaran: 50_000 });
    expect(kecil.ok && kecil.artikel).toEqual([]);
    expect(kecil.ok && kecil.dilewati).toEqual([{ itemId: "i1", sku: "KAOS-1", nama: "Kaos Satu", sebab: { jenis: "MELEBIHI_ANGGARAN" } }]);
  });
});

describe("kirimRencanaKirimAction", () => {
  it("never forwards a price from the phone, skips the putus minimum, and keeps the draft's idempotency key", async () => {
    const r = await kirimRencanaKirimAction(kiriman);
    expect(r).toEqual({ ok: true, orderId: "o1", orderNo: "PUTUS/1", kreditDitahan: false });
    expect(h.create).toHaveBeenCalledWith({
      storeId: "s1",
      salesmanId: "u1",
      visitId: "v1",
      lines: [{ itemId: "i1", variantSku: "i1-S", productName: "Kaos — S", qty: 2, unitPrice: 0 }],
      idempotencyKey: "kunci-draf-1",
      skipMinQty: true,
    });
  });

  it("an empty draft or a missing key is refused before the writer runs", async () => {
    expect(await kirimRencanaKirimAction({ ...kiriman, lines: [] })).toEqual({ ok: false, code: "EMPTY" });
    expect(await kirimRencanaKirimAction({ ...kiriman, idempotencyKey: undefined })).toEqual({ ok: false, code: "EMPTY" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("maps the writer's refusals to codes instead of throwing", async () => {
    h.create.mockRejectedValueOnce(new NoActiveVisitError("s1", "u1"));
    expect(await kirimRencanaKirimAction(kiriman)).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
    const alasan = [{ kode: "MELEBIHI_BATAS_FAKTUR", faktur: 5, batas: 3 }];
    h.create.mockRejectedValueOnce(new KreditDiblokirError(alasan as never));
    expect(await kirimRencanaKirimAction(kiriman)).toEqual({ ok: false, code: "KREDIT_DIBLOKIR", alasan });
  });
});
