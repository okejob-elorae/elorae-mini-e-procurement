import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { recordSpgSale } from "./sale-writer";
import { catatReturPembeli, kembaliPerNota, notaUntukKembali, rapikanBarisReturPembeli } from "./retur-pembeli";
import { JEJAK } from "@/lib/receivables/jejak";

describe("rapikanBarisReturPembeli", () => {
  it("merges the same sale line + condition and drops zero quantities", () => {
    expect(
      rapikanBarisReturPembeli([
        { saleLineId: "a", qty: 1 },
        { saleLineId: "a", qty: 2, condition: "LAYAK" },
        { saleLineId: "a", qty: 1, condition: "RUSAK" },
        { saleLineId: "b", qty: 0 },
      ]),
    ).toEqual({
      ok: true,
      baris: [
        { saleLineId: "a", qty: 3, condition: "LAYAK" },
        { saleLineId: "a", qty: 1, condition: "RUSAK" },
      ],
    });
  });

  it("refuses fractional or negative quantities, and an empty list", () => {
    expect(rapikanBarisReturPembeli([{ saleLineId: "a", qty: 1.5 }])).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisReturPembeli([{ saleLineId: "a", qty: -1 }])).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(rapikanBarisReturPembeli([])).toEqual({ ok: false, alasan: "TANPA_BARIS" });
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Terhadap basis data sungguhan: penjaga sisa di bawah balapan, buku stok toko,
 * `SalesHistory`, dan jejak. Pengguna DIPINJAM; penghapusan lewat `seededId()`.
 */
d("catatReturPembeli (test bed only)", () => {
  const tag = `RPB-${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let itemId = "";
  let spgId = "";
  let lainId = "";
  let storeId = "";
  let tokoLainId = "";
  let saleIds: string[] = [];
  let returIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    spgId = "";
    lainId = "";
    storeId = "";
    tokoLainId = "";
    saleIds = [];
    returIds = [];

    const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
    if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
    spgId = orang[0].id;
    lainId = orang[1].id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: {
          sku: tag,
          nameId: `Kaos ${tag}`,
          nameEn: "Tee",
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          sellingPrice: 50_000,
          variants: [{ sku: `${tag}-M`, size: "M" }],
        },
      })
    ).id;
    const buat = (akhiran: string) =>
      prisma.store.create({ data: { code: `${tag}-${akhiran}`, name: `${tag} ${akhiran}`, address: "uji", termsType: "KONSI", marginPercent: 20, isActive: true } });
    storeId = (await buat("A")).id;
    tokoLainId = (await buat("B")).id;
  });

  afterEach(async () => {
    if (returIds.some(Boolean)) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: returIds.filter(Boolean).map(seededId) } } });
    }
    const toko = () => [storeId, tokoLainId].filter(Boolean).map(seededId);
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: toko() } } });
    const nota = () => saleIds.filter(Boolean).map(seededId);
    if (nota().length) {
      await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: { in: nota() } } });
      await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: nota() } }, select: { id: true } })).map((x) => x.id) } } });
      await prisma.spgSale.deleteMany({ where: { id: { in: nota() } } });
    }
    if (itemId) {
      await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.delete({ where: { id: seededId(itemId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (toko().length) await prisma.store.deleteMany({ where: { id: { in: toko() } } });
  });

  async function jual(qty: number) {
    const h = await recordSpgSale({ salesmanId: spgId, storeId, lines: [{ itemId, variantSku: `${tag}-M`, qty }] });
    if (!h.ok) throw new Error(`jual gagal: ${h.code}`);
    saleIds.push(h.spgSaleId);
    const line = await prisma.spgSaleLine.findFirstOrThrow({ where: { spgSaleId: seededId(h.spgSaleId) } });
    return { saleId: h.spgSaleId, docNo: h.docNo, lineId: line.id };
  }

  const kembali = (saleId: string, baris: { saleLineId: string; qty: number; condition?: "LAYAK" | "RUSAK" }[], kunci: string, userId = spgId, toko = storeId) =>
    catatReturPembeli({ spgSaleId: saleId, storeId: toko, userId, baris, alasan: "ukuran tidak pas", idempotencyKey: `${tag}-${kunci}` }).then((h) => {
      if (h.ok) returIds.push(h.returnId);
      return h;
    });

  it("records the return: returnedQty, RETUR_PEMBELI for sellable goods only, SalesHistory net, audit", async () => {
    const n = await jual(3);
    const h = await kembali(n.saleId, [
      { saleLineId: n.lineId, qty: 1, condition: "LAYAK" },
      { saleLineId: n.lineId, qty: 1, condition: "RUSAK" },
    ], "a");
    expect(h.ok).toBe(true);

    const line = await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: n.lineId } });
    expect(line.returnedQty).toBe(2);

    const buku = await prisma.storeStockMovement.findMany({ where: { storeId: seededId(storeId), kind: "RETUR_PEMBELI" } });
    expect(buku.map((b) => [b.qty, b.variantSku])).toEqual([[1, `${tag}-M`]]);

    const sh = await prisma.salesHistory.findFirstOrThrow({ where: { channel: "OFFLINE", orderId: n.docNo } });
    expect([sh.quantity, sh.returnedQuantity, sh.netQuantity]).toEqual([3, 2, 1]);

    const jejak = await prisma.auditLog.findMany({ where: { entityId: seededId(h.ok ? h.returnId : "") } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].action).toBe(JEJAK.RETUR_PEMBELI_DICATAT);
  });

  it("refuses more than was sold and not yet returned", async () => {
    const n = await jual(2);
    expect((await kembali(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "a")).ok).toBe(true);
    expect(await kembali(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "b")).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
  });

  it("two phones returning the same line at once cannot both exceed what was sold", async () => {
    const n = await jual(3);
    const [a, b] = await Promise.all([
      kembali(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "a"),
      kembali(n.saleId, [{ saleLineId: n.lineId, qty: 2 }], "b"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    const line = await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: n.lineId } });
    expect(line.returnedQty).toBe(2);
    const sh = await prisma.salesHistory.findFirstOrThrow({ where: { channel: "OFFLINE", orderId: n.docNo } });
    expect(sh.netQuantity).toBe(1);
  });

  it("a replay with the same key records once (checked before the remaining quantity)", async () => {
    const n = await jual(1);
    const a = await kembali(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "k");
    const b = await kembali(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "k");
    expect(a).toEqual(b);
    const line = await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: n.lineId } });
    expect(line.returnedQty).toBe(1);
  });

  it("only the SPG's own sale at their own store can be returned", async () => {
    const n = await jual(2);
    expect(await kembali(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "x", lainId)).toEqual({ ok: false, alasan: "NOTA_TIDAK_DITEMUKAN" });
    expect(await kembali(n.saleId, [{ saleLineId: n.lineId, qty: 1 }], "y", spgId, tokoLainId)).toEqual({
      ok: false,
      alasan: "NOTA_TIDAK_DITEMUKAN",
    });
  });

  it("requires a reason", async () => {
    const n = await jual(1);
    expect(
      await catatReturPembeli({ spgSaleId: n.saleId, storeId, userId: spgId, baris: [{ saleLineId: n.lineId, qty: 1 }], alasan: " ", idempotencyKey: `${tag}-r` }),
    ).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
  });

  it("reads back for the phone (no prices) and the office (per line + history)", async () => {
    const n = await jual(3);
    await kembali(n.saleId, [{ saleLineId: n.lineId, qty: 1, condition: "RUSAK" }], "a");
    const hp = await notaUntukKembali(n.saleId, spgId, storeId);
    expect(hp?.baris).toEqual([expect.objectContaining({ saleLineId: n.lineId, qty: 3, returnedQty: 1, sisa: 2 })]);
    expect(JSON.stringify(hp)).not.toMatch(/price|Price|total/);
    expect(await notaUntukKembali(n.saleId, lainId, storeId)).toBeNull();

    const kantor = await kembaliPerNota(n.saleId);
    expect(kantor.perBaris[0]).toMatchObject({ qty: 3, returnedQty: 1 });
    expect(kantor.riwayat[0]).toMatchObject({ alasan: "ukuran tidak pas", baris: [expect.objectContaining({ qty: 1, condition: "RUSAK" })] });
  });
});
