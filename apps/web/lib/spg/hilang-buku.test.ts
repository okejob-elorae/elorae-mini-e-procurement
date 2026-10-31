import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { rencanaBalikHilang } from "./hilang-buku";
import { buatBarangHilang, batalkanBarangHilang } from "./hilang-writer";
import { bukaHilangDariOpname } from "./hilang-sumber";
import { kurangDariOpname, KATEGORI_NOTIF_HILANG } from "./hilang";
import { catatOpname } from "./stok-writer";
import { KUNCI_BARANG_HILANG } from "./pengaturan";

/*
 * Barang hilang MANUAL di toko yang punya buku stok: bukunya ikut berkurang
 * (gerakan HILANG) di transaksi yang sama, sehingga opname sesudahnya atas
 * potong yang sama tidak membuka catatan kedua; pembatalan membaliknya.
 * Terhadap basis data uji; teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `HBK-${Math.random().toString(36).slice(2, 9)}`;

describe("rencanaBalikHilang", () => {
  const t = (iso: string) => new Date(iso);
  it("membalik bersih per barang × ukuran; yang sudah dihitung opname sesudahnya dilewati", () => {
    const r = rencanaBalikHilang(
      [
        { itemId: "A", variantSku: "M", qty: -2, createdAt: t("2026-10-01T03:00:00Z") },
        { itemId: "A", variantSku: "L", qty: -1, createdAt: t("2026-10-01T03:00:00Z") },
        { itemId: "B", variantSku: "", qty: -3, createdAt: t("2026-10-01T03:00:00Z") },
        { itemId: "B", variantSku: "", qty: 3, createdAt: t("2026-10-02T03:00:00Z") },
      ],
      new Map([["A::L", t("2026-10-01T05:00:00Z")]]),
    );
    expect(r.balik).toEqual([{ itemId: "A", variantSku: "M", qty: 2 }]);
    expect(r.dilewati).toEqual([{ itemId: "A", variantSku: "L", qty: 1 }]);
  });

  it("hitungan opname SEBELUM catatan tidak menghalangi pembalik", () => {
    const r = rencanaBalikHilang(
      [{ itemId: "A", variantSku: "", qty: -2, createdAt: t("2026-10-01T03:00:00Z") }],
      new Map([["A::", t("2026-09-30T03:00:00Z")]]),
    );
    expect(r.balik).toEqual([{ itemId: "A", variantSku: "", qty: 2 }]);
  });
});

d("barang hilang manual menggerakkan buku stok toko (test bed only)", () => {
  let uomId = "";
  let barang = "";
  let tokoBuku = "";
  let tokoTanpaBuku = "";
  let kantor = "";
  let spg = "";
  let aturanAwal: string | null = null;
  let adaAturanAwal = false;
  let ke = 0;
  const kunci = () => `${tag}-kunci-${++ke}`;
  const tokoIds = () => seededIds([tokoBuku, tokoTanpaBuku].filter(Boolean));

  const saldo = async (storeId = tokoBuku) =>
    (await prisma.storeStockMovement.aggregate({ where: { storeId: seededId(storeId), itemId: seededId(barang) }, _sum: { qty: true } }))._sum.qty ?? 0;
  const hilangManual = async (qty: number, storeId = tokoBuku, idempotencyKey = kunci()) => {
    const r = await buatBarangHilang({ storeId, baris: [{ itemId: barang, variantSku: "", qty }], catatan: "uji", idempotencyKey, userId: kantor });
    if (!r.ok) throw new Error(r.kode);
    return r.id;
  };

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_BARANG_HILANG }, select: { value: true } });
    adaAturanAwal = ada !== null;
    aturanAwal = ada?.value ?? null;
    const isi = JSON.stringify({ dasarNilai: "HARGA_ELORAE", maksPotongPersen: 50, dariOpname: true });
    await prisma.systemSetting.upsert({ where: { key: KUNCI_BARANG_HILANG }, create: { key: KUNCI_BARANG_HILANG, value: isi }, update: { value: isi } });

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    barang = (
      await prisma.item.create({ data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, sellingPrice: 100_000 } })
    ).id;
    const pengguna = async (n: string) => (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}` } })).id;
    kantor = await pengguna("kantor");
    spg = await pengguna("spg");
    const toko = async (k: string) =>
      (await prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType: "KONSI", markupPercent: 20 } })).id;
    tokoBuku = await toko("B");
    tokoTanpaBuku = await toko("T");
  });

  beforeEach(async () => {
    // Buku dibuka opname pembuka 10 potong, sehari lalu.
    await prisma.storeStockMovement.create({
      data: { storeId: tokoBuku, itemId: barang, variantSku: "", qty: 10, kind: "OPNAME", createdById: spg, createdAt: new Date(Date.now() - 86_400_000) },
    });
  });

  afterEach(async () => {
    const losses = await prisma.stockLoss.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const lossIds = losses.map((l) => l.id);
    const catatan = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { id: true, metadata: true } });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.lossId === "string" && lossIds.includes(m.lossId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(lossIds) } } });
    await prisma.stockLossShare.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLossLine.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(lossIds) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeOpnameLine.deleteMany({ where: { opname: { storeId: { in: tokoIds() } } } });
    await prisma.storeOpname.deleteMany({ where: { storeId: { in: tokoIds() } } });
  });

  afterAll(async () => {
    if (adaAturanAwal && aturanAwal !== null) {
      await prisma.systemSetting.update({ where: { key: KUNCI_BARANG_HILANG }, data: { value: aturanAwal } });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_BARANG_HILANG) } });
    }
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([kantor, spg].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: seededId(barang) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("catatan manual mengurangi buku toko berbuku di transaksi yang sama; toko tanpa buku tidak dibukakan buku", async () => {
    const id = await hilangManual(2);
    const gerak = await prisma.storeStockMovement.findMany({ where: { storeId: tokoBuku, kind: "HILANG" } });
    expect(gerak).toEqual([expect.objectContaining({ itemId: barang, variantSku: "", qty: -2, refType: "StockLoss", refId: id, createdById: kantor })]);
    expect(await saldo()).toBe(8);
    expect(await prisma.auditLog.findFirst({ where: { entityId: id, action: "STOCK_LOSS_OPENED" }, select: { metadata: true } })).toMatchObject({
      metadata: expect.objectContaining({ bukuToko: { baris: 1 } }),
    });

    await hilangManual(1, tokoTanpaBuku);
    expect(await prisma.storeStockMovement.count({ where: { storeId: tokoTanpaBuku } })).toBe(0);
  });

  it("opname sesudahnya atas potong yang sama tidak membuka catatan barang hilang kedua", async () => {
    await hilangManual(2);
    const o = await catatOpname({ storeId: tokoBuku, userId: spg, baris: [{ itemId: barang, variantSku: "", qtyCounted: 8 }] });
    if (!o.ok) throw new Error(o.alasan);
    expect(o.selisih).toBe(0);
    const baris = await prisma.storeOpnameLine.findMany({
      where: { opnameId: o.opnameId },
      select: { itemId: true, variantSku: true, productName: true, qtySystem: true, qtyCounted: true },
    });
    expect(baris).toEqual([expect.objectContaining({ qtySystem: 8, qtyCounted: 8 })]);
    expect(kurangDariOpname(baris)).toEqual([]);
    expect(await bukaHilangDariOpname(o.opnameId, spg)).toEqual({ ok: false, kode: "TANPA_BARIS" });
    expect(await prisma.stockLoss.count({ where: { storeId: tokoBuku } })).toBe(1);
    expect(await saldo()).toBe(8);
  });

  it("membatalkan catatan membalik bukunya; barang yang sudah dihitung opname sesudahnya tidak dibalik", async () => {
    const a = await hilangManual(2);
    expect(await batalkanBarangHilang({ lossId: a, alasan: "ketemu di gudang toko", olehUserId: kantor })).toEqual({ ok: true, id: a });
    expect(await saldo()).toBe(10);
    expect(
      await prisma.storeStockMovement.aggregate({ where: { storeId: tokoBuku, kind: "HILANG", refId: a }, _sum: { qty: true } }),
    ).toMatchObject({ _sum: { qty: 0 } });

    // Hilang 3, lalu opname menghitung 10 (ternyata ada): opname sudah meluruskan buku,
    // jadi pembatalan sesudahnya tidak menambah lagi.
    const b = await hilangManual(3);
    const o = await catatOpname({ storeId: tokoBuku, userId: spg, baris: [{ itemId: barang, variantSku: "", qtyCounted: 10 }] });
    if (!o.ok) throw new Error(o.alasan);
    expect(await saldo()).toBe(10);
    expect(await batalkanBarangHilang({ lossId: b, alasan: "ketemu", olehUserId: kantor })).toEqual({ ok: true, id: b });
    expect(await saldo()).toBe(10);
    const jejak = await prisma.auditLog.findFirst({ where: { entityId: b, action: "STOCK_LOSS_CANCELLED" }, select: { metadata: true } });
    expect(jejak?.metadata).toMatchObject({ bukuToko: { balik: [], dilewati: [{ itemId: barang, variantSku: "", qty: 3 }] } });
  });

  it("balapan: dua pembatalan bersamaan membalik buku sekali saja", async () => {
    const id = await hilangManual(2);
    const hasil = await Promise.all([
      batalkanBarangHilang({ lossId: id, alasan: "ketemu", olehUserId: kantor }),
      batalkanBarangHilang({ lossId: id, alasan: "ketemu", olehUserId: kantor }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(await saldo()).toBe(10);
    expect(await prisma.storeStockMovement.count({ where: { storeId: tokoBuku, kind: "HILANG", qty: { gt: 0 } } })).toBe(1);
  });

  it("balapan: kiriman ganda pencatatan manual menulis satu catatan dan satu gerakan buku", async () => {
    const k = kunci();
    const ids = await Promise.all([hilangManual(2, tokoBuku, k), hilangManual(2, tokoBuku, k)]);
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.stockLoss.count({ where: { storeId: tokoBuku } })).toBe(1);
    expect(await prisma.storeStockMovement.count({ where: { storeId: tokoBuku, kind: "HILANG" } })).toBe(1);
    expect(await saldo()).toBe(8);
  });
});
