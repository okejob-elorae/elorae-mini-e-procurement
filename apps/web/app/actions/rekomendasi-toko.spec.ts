import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Aksi rekomendasi dengan penulis SUNGGUHAN di basis data uji; hanya sesi,
 * toko tetap, revalidate, dan kabar yang dipalsukan. Yang dibuktikan: toko SPG
 * selalu dari server (SPG toko lain ditolak walau HP mengirim toko yang
 * "benar"), pembuat selalu pengguna sesi, SPG tidak bisa membuat, salesman
 * tidak bisa menjawab atas nama SPG.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: new Map<string, string>(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async (id: string) => state.tokoTetap.get(id) ?? null) }));
// Tanpa modul aslinya: ia memuat Firebase admin, yang tidak dibutuhkan di sini.
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { REKOMENDASI_MASUK: "REKOMENDASI_MASUK", REKOMENDASI_DIJAWAB: "REKOMENDASI_DIJAWAB" },
  kabariPengguna: vi.fn(async () => {}),
}));

const { batalkanRekomendasiAction, buatRekomendasiAction, tandaiTokoSetujuAction, terimaRekomendasiAction, tolakRekomendasiAction } = await import(
  "./rekomendasi-toko"
);

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;
const tag = `RKA-${Math.random().toString(36).slice(2, 10)}`;

const SALES = ["pwa:access"];
const SPG = ["pwa:access", "spg_sales:record"];

d("aksi rekomendasi ke toko (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let salesLain = "";
  let spgA = "";
  let spgB = "";
  let kemeja = "";
  let tokoA = "";
  let tokoB = "";
  let k = 0;
  const kunci = () => `${tag}-${k++}`;

  beforeAll(async () => {
    uomId = "";
    sales = "";
    salesLain = "";
    spgA = "";
    spgB = "";
    kemeja = "";
    tokoA = "";
    tokoB = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const orang = async (n: string, assignedStoreId?: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: n, assignedStoreId } })).id;
    sales = await orang("sales");
    salesLain = await orang("sales2");
    kemeja = (await prisma.item.create({ data: { sku: `${tag}-KMJ`, nameId: "Kemeja", nameEn: "Shirt", type: "FINISHED_GOOD", uomId } })).id;
    const toko = async (kode: string) =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode}`, address: "x", termsType: "KONSI", salesmanId: sales } })).id;
    tokoA = await toko("A");
    tokoB = await toko("B");
    spgA = await orang("spga", tokoA);
    spgB = await orang("spgb", tokoB);
    state.tokoTetap = new Map([
      [spgA, tokoA],
      [spgB, tokoB],
    ]);
  });

  beforeEach(() => {
    state.sesi = { user: { id: sales, permissions: SALES } };
  });

  afterAll(async () => {
    const rek = await prisma.storeRecommendation.findMany({ where: { storeId: { in: seededIds([tokoA, tokoB].filter(Boolean)) } }, select: { id: true } });
    const ids = rek.map((r) => r.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreRecommendation", entityId: { in: seededIds(ids) } } });
    await prisma.storeRecommendation.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.item.deleteMany({ where: { id: seededId(kemeja) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain, spgA, spgB].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const sebagai = (id: string, permissions: string[]) => {
    state.sesi = { user: { id, permissions } };
  };
  const buat = async () => {
    sebagai(sales, SALES);
    const r = await buatRekomendasiAction({ storeId: tokoA, baris: [{ itemId: kemeja, variantSku: "", qty: 2, alasan: "MANUAL" }], idempotencyKey: kunci() });
    if (!r.ok) throw new Error(r.kode);
    return r.id;
  };
  const status = async (id: string) => (await prisma.storeRecommendation.findUniqueOrThrow({ where: { id } })).status;

  it("pembuat = pengguna sesi; SPG dan pengguna tanpa akses ditolak membuat", async () => {
    const id = await buat();
    expect((await prisma.storeRecommendation.findUniqueOrThrow({ where: { id } })).salesmanId).toBe(sales);

    sebagai(spgA, SPG);
    expect(await buatRekomendasiAction({ storeId: tokoA, baris: [{ itemId: kemeja, qty: 1 }], idempotencyKey: kunci() })).toEqual({
      ok: false,
      kode: "TANPA_AKSES",
    });
    state.sesi = null;
    expect(await buatRekomendasiAction({ storeId: tokoA, baris: [{ itemId: kemeja, qty: 1 }], idempotencyKey: kunci() })).toEqual({
      ok: false,
      kode: "TANPA_AKSES",
    });
    sebagai(salesLain, ["*"]);
    expect(await buatRekomendasiAction({ storeId: tokoA, baris: [{ itemId: kemeja, qty: 1 }], idempotencyKey: kunci() })).toEqual({
      ok: false,
      kode: "TANPA_AKSES",
    });
  });

  it("SPG toko lain ditolak — tokonya dari server, isian HP tidak dipercaya", async () => {
    const id = await buat();
    sebagai(spgB, SPG);
    const isian = { recommendationId: id, storeId: tokoA } as { recommendationId: string };
    expect(await terimaRekomendasiAction(isian)).toEqual({ ok: false, kode: "BUKAN_TOKO_ANDA" });
    expect(await tolakRekomendasiAction({ recommendationId: id, alasan: "x" })).toEqual({ ok: false, kode: "BUKAN_TOKO_ANDA" });
    expect(await status(id)).toBe("TERKIRIM");

    sebagai(spgA, SPG);
    expect(await terimaRekomendasiAction({ recommendationId: id })).toMatchObject({ ok: true, status: "DITERIMA" });
  });

  it("salesman tidak bisa menjawab atas nama SPG; pengguna SPG-izin tanpa toko tetap ditolak", async () => {
    const id = await buat();
    sebagai(sales, SALES);
    expect(await terimaRekomendasiAction({ recommendationId: id })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sebagai(salesLain, SPG);
    expect(await terimaRekomendasiAction({ recommendationId: id })).toEqual({ ok: false, kode: "TANPA_TOKO" });
    expect(await status(id)).toBe("TERKIRIM");
  });

  it("bukan pembuat ditolak membatalkan dan menandai toko setuju; SPG tidak bisa membatalkan", async () => {
    const id = await buat();
    sebagai(salesLain, SALES);
    expect(await batalkanRekomendasiAction({ recommendationId: id })).toEqual({ ok: false, kode: "BUKAN_PEMBUAT" });
    expect(await tandaiTokoSetujuAction({ recommendationId: id, sumber: "WHATSAPP" })).toEqual({ ok: false, kode: "BUKAN_PEMBUAT" });
    sebagai(spgA, SPG);
    expect(await batalkanRekomendasiAction({ recommendationId: id })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sebagai(sales, SALES);
    expect(await batalkanRekomendasiAction({ recommendationId: id, alasan: "keliru" })).toMatchObject({ ok: true, status: "DIBATALKAN" });
  });
});
