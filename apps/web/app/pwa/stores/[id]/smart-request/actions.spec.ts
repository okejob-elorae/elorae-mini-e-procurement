import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/*
 * Rencana kirim (bagian pertama): unit saja — auth, peran, kunci toko, pemuat
 * bahan, rasio pack, dan penulis pesanan ditirukan; `prisma.store` dan
 * `prisma.itemCategory` ditirukan selama `h.unit` menyala. Yang dipasak: penjaga
 * server (SPG, pwa:access, toko aktif, kunci "hanya toko sendiri") menolak
 * SEBELUM apa pun dibaca atau ditulis; HP tidak pernah bisa mengirim harga; draf
 * konsinyasi tidak membawa harga walaupun pemuat (keliru) memberinya.
 *
 * Pesanan cepat per kategori (bagian kedua) memakai basis data uji sungguhan:
 * suite-nya mematikan `h.unit`, jadi `prisma` kembali ke klien aslinya.
 */
const h = vi.hoisted(() => ({
  unit: true,
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
vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  const prisma = new Proxy(actual.prisma, {
    get(target, prop) {
      if (h.unit && prop === "store") return { findUnique: h.store };
      if (h.unit && prop === "itemCategory") return { findMany: h.kategori };
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { ...actual, prisma };
});
vi.mock("@/app/actions/settings/pack-ratio", () => ({ getPackRatio: h.rasio }));
vi.mock("@/lib/field-sales/smart-request/rencana-queries", () => ({ muatBahanRencana: h.muat }));
vi.mock("@/lib/field-sales/writer", () => ({ createFieldSalesOrder: h.create }));

import { KreditDiblokirError } from "@/lib/field-sales/kredit-pesanan";
import { NoActiveVisitError } from "@/lib/field-sales/errors";
import { prisma, seededId } from "@elorae/db";
import { bangunRencanaKirimAction, buildSmartRequestAction, kirimRencanaKirimAction, submitSmartRequestOrder } from "./actions";

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
  markupPercent: null,
  priceDiscountPercent: null,
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
  h.unit = true;
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
    h.store.mockResolvedValue(toko({ termsType: "KONSI", markupPercent: 30 }));
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

/*
 * Pesanan cepat per kategori, terhadap basis data uji. Rasio pack ditirukan
 * (`h.rasio`), jadi `putus.packRatio` bersama di basis data tidak dibaca dan
 * tidak pernah ditulis.
 */
const DB_URL = process.env.DATABASE_URL ?? "";
const isProd = DB_URL.includes(":3307") || DB_URL.includes("api.elorae.cloud");
const packRatio: Array<{ size: string; qty: number }> = [
  { size: "S", qty: 1 },
  { size: "M", qty: 2 },
];
const d = isProd ? describe.skip : describe;
const suiteName = "buildSmartRequestAction (test bed only)";

d(suiteName, () => {
  const tag = `SMARTREQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let categoryId = ""; let storeId = ""; let plainStoreId = "";

  beforeEach(async () => {
    h.unit = false;
    uomId = ""; itemId = ""; categoryId = ""; storeId = ""; plainStoreId = "";
    h.rasio.mockResolvedValue(packRatio);

    const salesman = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    h.auth.mockResolvedValue({ user: { id: salesman.id, email: "test@example.com", permissions: [] } });

    const category = await prisma.itemCategory.create({ data: { name: `Cat ${tag}` } });
    categoryId = category.id;

    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    // One variant per size the real ratio names, with stock that exactly satisfies that size's
    // required qty — sufficient for expandPack to place one pack of this single candidate item.
    const variants = packRatio.map((row, i) => ({ sku: `${tag}-V${i}`, size: row.size }));
    const item = await prisma.item.create({
      data: {
        sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true,
        sellingPrice: 5000, categoryId, variants,
      },
    });
    itemId = item.id;
    await prisma.inventoryValue.createMany({
      data: variants.map((v, i) => ({ itemId, variantSku: v.sku, qtyOnHand: packRatio[i].qty, reservedQty: 0 })),
    });

    const store = await prisma.store.create({
      data: { code: `${tag}-DISC`, name: "Toko Smart Request Diskon", address: "Jl. Test", termsType: "PUTUS", priceDiscountPercent: 10, isActive: true },
    });
    storeId = store.id;

    const plainStore = await prisma.store.create({
      data: { code: `${tag}-PLAIN`, name: "Toko Smart Request Biasa", address: "Jl. Test", termsType: "PUTUS", isActive: true },
    });
    plainStoreId = plainStore.id;

    for (const id of [storeId, plainStoreId]) {
      await prisma.storeVisit.create({ data: { storeId: id, userId: salesman.id, checkinLat: 0, checkinLng: 0 } });
    }
  });

  afterEach(async () => {
    h.unit = false;
    await prisma.storeVisit.deleteMany({ where: { storeId: { in: [storeId, plainStoreId].map(seededId) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(categoryId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [storeId, plainStoreId].map(seededId) } } });
  });

  it("prices the smart-request preview line off the store's priceDiscountPercent", async () => {
    const res = await buildSmartRequestAction({ storeId, categories: [{ categoryId, packs: 1 }] });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const line = res.lines.find((l) => l.itemId === itemId);
    expect(line).toBeDefined();
    expect(line!.unitPrice).toBe(4500); // 5000 * (1 - 10/100)
  });

  it("prices at list for a store with no discount", async () => {
    const res = await buildSmartRequestAction({ storeId: plainStoreId, categories: [{ categoryId, packs: 1 }] });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const line = res.lines.find((l) => l.itemId === itemId);
    expect(line).toBeDefined();
    expect(line!.unitPrice).toBe(5000);
  });
});

/*
 * The refusal guards sit ahead of the pack-ratio read, so they need no ratio, item or stock — only
 * stores and visits.
 */
const g = isProd ? describe.skip : describe;

g("smart-request guards (test bed only)", () => {
  const tag = `SMARTGUARD-${Math.random().toString(36).slice(2, 10)}`;
  const categoryId = "guard-category-not-read";
  let noVisitStoreId = ""; let konsiStoreId = ""; let foreignVisitId = "";

  beforeEach(async () => {
    h.unit = false;
    noVisitStoreId = ""; konsiStoreId = ""; foreignVisitId = "";

    const salesman = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    h.auth.mockResolvedValue({ user: { id: salesman.id, email: "test@example.com", permissions: [] } });

    const noVisitStore = await prisma.store.create({
      data: { code: `${tag}-NOVIS`, name: "Toko Tanpa Kunjungan", address: "Jl. Test", termsType: "PUTUS", isActive: true },
    });
    noVisitStoreId = noVisitStore.id;

    const konsiStore = await prisma.store.create({
      data: { code: `${tag}-KONSI`, name: "Toko Konsi", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    konsiStoreId = konsiStore.id;

    await prisma.storeVisit.create({ data: { storeId: konsiStoreId, userId: salesman.id, checkinLat: 0, checkinLng: 0 } });
  });

  afterEach(async () => {
    h.unit = false;
    await prisma.storeVisit.deleteMany({ where: { storeId: { in: [noVisitStoreId, konsiStoreId].map(seededId) } } });
    await prisma.store.deleteMany({ where: { id: { in: [noVisitStoreId, konsiStoreId].map(seededId) } } });
  });

  it("fails fast with NO_ACTIVE_VISIT when the salesman has no open visit at the store", async () => {
    const res = await buildSmartRequestAction({ storeId: noVisitStoreId, categories: [{ categoryId, packs: 1 }] });
    expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
  });

  it("fails with NO_ACTIVE_VISIT for a visit that belongs to another user", async () => {
    const other = await prisma.user.findFirstOrThrow({ where: { email: { not: "salesman@elorae.com" } } });
    const foreign = await prisma.storeVisit.create({ data: { storeId: noVisitStoreId, userId: other.id, checkinLat: 0, checkinLng: 0 } });
    foreignVisitId = foreign.id;
    const res = await buildSmartRequestAction({ storeId: noVisitStoreId, visitId: foreignVisitId, categories: [{ categoryId, packs: 1 }] });
    expect(res).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
  });

  it("rejects a KONSI store on build, even with an open visit", async () => {
    const res = await buildSmartRequestAction({ storeId: konsiStoreId, categories: [{ categoryId, packs: 1 }] });
    expect(res).toEqual({ ok: false, code: "KONSI_NOT_SUPPORTED" });
  });

  it("rejects a KONSI store on submit before touching the order writer", async () => {
    const res = await submitSmartRequestOrder({
      storeId: konsiStoreId,
      lines: [{ itemId: "guard-item-not-read", variantSku: "", productName: "T", qty: 1, unitPrice: 5000 }],
    });
    expect(res).toEqual({ ok: false, code: "KONSI_NOT_SUPPORTED" });
  });
});
