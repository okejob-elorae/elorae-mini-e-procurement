import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bacaAturanMinimum } from "./minimum-pesanan";

/*
 * Alur publik portal toko terhadap basis data uji, dengan penulis pesanan
 * SUNGGUHAN. Aturan pemilik yang dibaca dari `SystemSetting` bersama
 * (minimum, kredit, aturan portal) DITIRUKAN — tes tidak boleh bergantung
 * pada, atau mengubah, pengaturan yang dipakai orang lain. Kabar ke salesman
 * dan ke kantor juga ditirukan: tidak ada baris lonceng yang bocor ke HP.
 */
const { mockMinToko, mockMinKatalog, mockKabar } = vi.hoisted(() => ({
  mockMinToko: vi.fn(),
  mockMinKatalog: vi.fn(),
  mockKabar: vi.fn(),
}));
vi.mock("./minimum-toko", () => ({ muatMinimumToko: mockMinToko, muatMinimumKatalog: mockMinKatalog }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PESANAN_PORTAL: "PESANAN_PORTAL" },
  kabariPengguna: mockKabar,
}));

import { ATURAN_PORTAL_BAWAAN } from "./portal-toko-aturan";
import { bukaTautanPortal, buatTautanPortal, type AksesPortal } from "./portal-toko";
import {
  awalHariWib,
  kabarPesananPortal,
  katalogPortal,
  kirimPesananPortal,
  kunciIdempotenPortal,
  pesananTokoPortal,
  pratinjauPortal,
} from "./portal-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/** Kunci yang tidak boleh ada di muatan untuk toko konsinyasi, di tingkat mana pun. */
const KUNCI_UANG = ["harga", "price", "priceLabel", "total", "subtotal", "potongan", "potonganPesanan", "hargaSatuan", "minPesan", "unitPrice"];
/** Kunci yang tidak boleh ada di muatan toko mana pun. */
const KUNCI_RAHASIA = ["available", "qtyOnHand", "reservedQty", "avgCost", "marginPercent", "totalValue", "kreditDitahan", "kreditCatatan", "rejectReason"];

function semuaKunci(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) for (const v of x) semuaKunci(v, out);
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
    out.add(k);
    semuaKunci(v, out);
  }
  return out;
}

const minimum = (min: number) => ({ min, jenis: "PERTAMA" as const, aturan: bacaAturanMinimum(null, null) });

d("portal toko — alur publik (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const sku = `TEST-PTL-${token}`;
  const mulai = new Date();
  const aturan = { ...ATURAN_PORTAL_BAWAAN };
  let uomId = "";
  let itemId = "";
  let varianId = "";
  let tanpaHargaId = "";
  let salesmanId = "";
  let putusId = "";
  let konsiId = "";
  let tokenPutus = "";
  let tokenKonsi = "";

  async function akses(t: string, override: Partial<typeof aturan> = {}): Promise<AksesPortal> {
    const b = await bukaTautanPortal(t, { aturan: { ...aturan, ...override } });
    if (!b.ok) throw new Error(b.code);
    return b.akses;
  }

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    varianId = "";
    tanpaHargaId = "";
    salesmanId = "";
    putusId = "";
    konsiId = "";
    tokenPutus = "";
    tokenKonsi = "";
    mockMinToko.mockReset().mockResolvedValue(minimum(1));
    mockMinKatalog.mockReset().mockResolvedValue({ min: 1, pesanUlang: false, perBarang: {} });
    mockKabar.mockReset().mockResolvedValue(undefined);

    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const a = await prisma.item.create({
      data: { sku, nameId: "Kaos Portal", nameEn: "Portal Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
    });
    itemId = a.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });
    const v = await prisma.item.create({
      data: { sku: `${sku}-V`, nameId: "Kemeja Portal", nameEn: "Portal Shirt", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 80000 },
    });
    varianId = v.id;
    await prisma.inventoryValue.create({ data: { itemId: varianId, variantSku: `${sku}-V-S`, qtyOnHand: 50, reservedQty: 0, avgCost: 2000, totalValue: 100000 } });
    await prisma.inventoryValue.create({ data: { itemId: varianId, variantSku: `${sku}-V-M`, qtyOnHand: 0, reservedQty: 0, avgCost: 2000, totalValue: 0 } });
    const n = await prisma.item.create({
      data: { sku: `${sku}-N`, nameId: "Topi Tanpa Harga", nameEn: "Unpriced Cap", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: null },
    });
    tanpaHargaId = n.id;
    await prisma.inventoryValue.create({ data: { itemId: tanpaHargaId, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 500, totalValue: 25000 } });

    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" }, select: { id: true } });
    salesmanId = user!.id;
    const p = await prisma.store.create({
      data: { code: `S-${sku}-P`, name: "Toko Portal Putus", address: "Uji", termsType: "PUTUS", isActive: true, salesmanId },
    });
    putusId = p.id;
    const k = await prisma.store.create({
      data: { code: `S-${sku}-K`, name: "Toko Portal Konsi", address: "Uji", termsType: "KONSI", marginPercent: 30, isActive: true, salesmanId },
    });
    konsiId = k.id;
    const lp = await buatTautanPortal({ storeId: putusId, createdById: salesmanId, aturan });
    const lk = await buatTautanPortal({ storeId: konsiId, createdById: salesmanId, aturan });
    if (!lp.ok || !lk.ok) throw new Error("tautan uji gagal dibuat");
    tokenPutus = lp.token;
    tokenKonsi = lk.token;
  });

  afterEach(async () => {
    const tokoIds = [putusId, konsiId].filter((x) => x !== "");
    const itemIds = [itemId, varianId, tanpaHargaId].filter((x) => x !== "");
    const pesanan = await prisma.fieldSalesOrder.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true, orderNo: true } });
    const orderIds = pesanan.map((p) => p.id);
    for (const p of pesanan) {
      await prisma.adminNotification.deleteMany({
        where: { category: "PENDING_ORDER_APPROVAL", createdAt: { gte: new Date(mulai) }, message: { contains: seededId(p.orderNo) } },
      });
    }
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    const tautan = await prisma.storePortalLink.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } });
    const linkIds = tautan.map((t) => t.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "StorePortalLink", entityId: { in: seededIds(linkIds) } } });
    await prisma.storePortalLink.deleteMany({ where: { id: { in: seededIds(linkIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(itemIds) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const kunci = () => `k${Math.random().toString(36).slice(2, 12)}`;
  const kaos = (qty: number) => [{ itemId, variantSku: "", qty }];

  describe("katalog", () => {
    it("PUTUS shows server prices and stock BUCKETS — never a stock number, cost or margin", async () => {
      const k = await katalogPortal(await akses(tokenPutus));
      expect(k?.jenis).toBe("PUTUS");
      if (k?.jenis !== "PUTUS") return;
      const a = k.barang.find((b) => b.itemId === itemId)!;
      expect(a).toMatchObject({ nama: "Kaos Portal", harga: 35000, ketersediaan: "TERSEDIA", varian: [] });
      const v = k.barang.find((b) => b.itemId === varianId)!;
      expect(v.ketersediaan).toBe("TERSEDIA");
      expect(v.varian.map((x) => [x.variantSku, x.ketersediaan])).toEqual([
        [`${sku}-V-M`, "HABIS"],
        [`${sku}-V-S`, "TERSEDIA"],
      ]);
      expect(k.barang.find((b) => b.itemId === tanpaHargaId)!.harga).toBeNull();
      const kunciMuatan = semuaKunci(k);
      for (const r of KUNCI_RAHASIA) expect(kunciMuatan.has(r), r).toBe(false);
    });

    it("KONSI payload carries no price-shaped key at all, for any item", async () => {
      const k = await katalogPortal(await akses(tokenKonsi));
      expect(k?.jenis).toBe("KONSI");
      expect(k!.barang.length).toBeGreaterThan(0);
      const kunciMuatan = semuaKunci(JSON.parse(JSON.stringify(k)));
      for (const r of [...KUNCI_UANG, ...KUNCI_RAHASIA]) expect(kunciMuatan.has(r), r).toBe(false);
    });
  });

  describe("pratinjau", () => {
    it("PUTUS: prices computed by the server, never taken from the browser", async () => {
      const p = await pratinjauPortal(await akses(tokenPutus), [{ itemId, variantSku: "", qty: 3, unitPrice: 1 } as never]);
      expect(p).toMatchObject({ ok: true, jenis: "PUTUS", total: 105000 });
    });

    it("KONSI: exactly { ok, jenis } — no number of any kind", async () => {
      const p = await pratinjauPortal(await akses(tokenKonsi), kaos(3));
      expect(p).toEqual({ ok: true, jenis: "KONSI" });
    });
  });

  describe("kirim", () => {
    it("records a PORTAL order under the store's holder, scoped idempotency key, and tells the holder", async () => {
      const a = await akses(tokenPutus);
      const k = kunci();
      const r = await kirimPesananPortal(a, { lines: kaos(4), note: "  tolong cepat ", idempotencyKey: k });
      expect(r).toMatchObject({ ok: true, jenis: "PUTUS", total: 140000, ulang: false });
      const o = await prisma.fieldSalesOrder.findFirstOrThrow({ where: { storeId: seededId(putusId) } });
      expect(o).toMatchObject({
        remoteChannel: "PORTAL",
        salesmanId,
        visitId: null,
        status: "PENDING_APPROVAL",
        idempotencyKey: kunciIdempotenPortal(a.linkId, k),
        note: "tolong cepat",
      });
      expect(mockKabar).toHaveBeenCalledTimes(1);
      expect(mockKabar).toHaveBeenCalledWith(salesmanId, expect.objectContaining({ jenis: "PESANAN_PORTAL", data: { orderId: o.id } }));
      const t = await prisma.storePortalLink.findUniqueOrThrow({ where: { id: seededId(a.linkId) } });
      expect(t.lastUsedAt).not.toBeNull();
    });

    it("a replay with the same key returns the same order: one row, one notification", async () => {
      const a = await akses(tokenPutus);
      const k = kunci();
      const r1 = await kirimPesananPortal(a, { lines: kaos(2), idempotencyKey: k });
      const r2 = await kirimPesananPortal(a, { lines: kaos(2), idempotencyKey: k });
      expect(r1.ok && r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r2.orderNo).toBe(r1.orderNo);
      expect(r2.ulang).toBe(true);
      expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(putusId) } })).toBe(1);
      expect(mockKabar).toHaveBeenCalledTimes(1);
    });

    it("the same client key under ANOTHER link never returns this link's order", async () => {
      const k = kunci();
      const r1 = await kirimPesananPortal(await akses(tokenPutus), { lines: kaos(2), idempotencyKey: k });
      const lain = await buatTautanPortal({ storeId: putusId, createdById: salesmanId, aturan });
      if (!lain.ok) throw new Error(lain.code);
      const r2 = await kirimPesananPortal(await akses(lain.token), { lines: kaos(2), idempotencyKey: k });
      expect(r1.ok && r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r2.orderNo).not.toBe(r1.orderNo);
      expect(r2.ulang).toBe(false);
    });

    it("a store id smuggled into the payload is ignored — the order lands on the link's store", async () => {
      const r = await kirimPesananPortal(await akses(tokenKonsi), { storeId: putusId, lines: kaos(2), idempotencyKey: kunci() });
      expect(r.ok).toBe(true);
      expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(putusId) } })).toBe(0);
      expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(konsiId) } })).toBe(1);
    });

    it("rate limit: the (N+1)th PORTAL order of the WIB day is refused, a replay of an earlier one is not", async () => {
      const a = await akses(tokenPutus, { maksPesananPerHari: 2 });
      const k1 = kunci();
      expect((await kirimPesananPortal(a, { lines: kaos(1), idempotencyKey: k1 })).ok).toBe(true);
      expect((await kirimPesananPortal(a, { lines: kaos(1), idempotencyKey: kunci() })).ok).toBe(true);
      expect(await kirimPesananPortal(a, { lines: kaos(1), idempotencyKey: kunci() })).toEqual({ ok: false, code: "BATAS_HARIAN", batas: 2 });
      expect(await kirimPesananPortal(a, { lines: kaos(1), idempotencyKey: k1 })).toMatchObject({ ok: true, ulang: true });
      expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(putusId) } })).toBe(2);
    });

    it("KONSI success carries no total", async () => {
      const r = await kirimPesananPortal(await akses(tokenKonsi), { lines: kaos(3), idempotencyKey: kunci() });
      expect(r).toMatchObject({ ok: true, jenis: "KONSI", ulang: false });
      expect(Object.keys(r)).not.toContain("total");
      const kabar = mockKabar.mock.calls[0][1] as { isi: string };
      expect(kabar.isi).not.toMatch(/Rp/);
    });

    it("refuses stock beyond what is available, sold-out and unknown variants, unknown items and unpriced items — by name, no numbers", async () => {
      const a = await akses(tokenPutus);
      expect(await kirimPesananPortal(a, { lines: kaos(101), idempotencyKey: kunci() })).toEqual({
        ok: false,
        code: "BARIS",
        masalah: { code: "STOK_KURANG", nama: ["Kaos Portal"] },
      });
      expect(await kirimPesananPortal(a, { lines: [{ itemId: varianId, variantSku: `${sku}-V-M`, qty: 1 }], idempotencyKey: kunci() })).toMatchObject({
        code: "BARIS",
        masalah: { code: "STOK_KURANG" },
      });
      expect(await kirimPesananPortal(a, { lines: [{ itemId: varianId, variantSku: "", qty: 1 }], idempotencyKey: kunci() })).toMatchObject({
        masalah: { code: "BARANG_TIDAK_TERSEDIA" },
      });
      expect(await kirimPesananPortal(a, { lines: [{ itemId: varianId, variantSku: "BUKAN-VARIAN", qty: 1 }], idempotencyKey: kunci() })).toMatchObject({
        masalah: { code: "BARANG_TIDAK_TERSEDIA" },
      });
      expect(await kirimPesananPortal(a, { lines: [{ itemId: "bukan-barang", variantSku: "", qty: 1 }], idempotencyKey: kunci() })).toEqual({
        ok: false,
        code: "BARIS",
        masalah: { code: "BARANG_TIDAK_TERSEDIA", nama: [] },
      });
      expect(await kirimPesananPortal(a, { lines: [{ itemId: tanpaHargaId, variantSku: "", qty: 1 }], idempotencyKey: kunci() })).toMatchObject({
        masalah: { code: "HARGA_BELUM_ADA", nama: ["Topi Tanpa Harga"] },
      });
      expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(putusId) } })).toBe(0);
    });

    it("a variant order goes through with the variant label in the product name", async () => {
      const r = await kirimPesananPortal(await akses(tokenPutus), {
        lines: [{ itemId: varianId, variantSku: `${sku}-V-S`, qty: 2 }],
        idempotencyKey: kunci(),
      });
      expect(r).toMatchObject({ ok: true, total: 160000 });
      const l = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { order: { storeId: seededId(putusId) } } });
      expect(l).toMatchObject({ itemId: varianId, variantSku: `${sku}-V-S`, qty: 2 });
    });

    it("refuses malformed input before anything else", async () => {
      const a = await akses(tokenPutus);
      expect(await kirimPesananPortal(a, { lines: kaos(1) })).toEqual({ ok: false, code: "TIDAK_SAH" });
      expect(await kirimPesananPortal(a, { lines: kaos(0), idempotencyKey: kunci() })).toEqual({ ok: false, code: "TIDAK_SAH" });
      expect(await kirimPesananPortal(a, { lines: kaos(1.5), idempotencyKey: kunci() })).toEqual({ ok: false, code: "TIDAK_SAH" });
      expect(await kirimPesananPortal(a, { lines: [], idempotencyKey: kunci() })).toEqual({ ok: false, code: "TIDAK_SAH" });
      const banyak = Array.from({ length: 201 }, (_, i) => ({ itemId: `x${i}`, variantSku: "", qty: 1 }));
      expect(await kirimPesananPortal(a, { lines: banyak, idempotencyKey: kunci() })).toEqual({ ok: false, code: "TIDAK_SAH" });
      expect(await kirimPesananPortal(a, { lines: kaos(1), idempotencyKey: "bad key!" })).toEqual({ ok: false, code: "TIDAK_SAH" });
    });

    it("the order minimum is reported by item name", async () => {
      mockMinToko.mockResolvedValue(minimum(10));
      const r = await kirimPesananPortal(await akses(tokenPutus), { lines: kaos(2), idempotencyKey: kunci() });
      expect(r).toEqual({ ok: false, code: "MIN_PESAN", kurang: [{ nama: "Kaos Portal", min: 10, jumlah: 2 }] });
    });

    it("holder removed after the link was opened → refused by the writer, nothing recorded", async () => {
      const a = await akses(tokenPutus);
      await prisma.store.update({ where: { id: seededId(putusId) }, data: { salesmanId: null } });
      expect(await kirimPesananPortal(a, { lines: kaos(1), idempotencyKey: kunci() })).toEqual({ ok: false, code: "GAGAL" });
      expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(putusId) } })).toBe(0);
      expect(mockKabar).not.toHaveBeenCalled();
    });
  });

  describe("pesanan saya", () => {
    it("lists the store's orders; PUTUS with totals, KONSI without the key", async () => {
      await kirimPesananPortal(await akses(tokenPutus), { lines: kaos(2), idempotencyKey: kunci() });
      const p = await pesananTokoPortal(await akses(tokenPutus));
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ keadaan: "MENUNGGU", dariPortal: true, jumlahPcs: 2, total: 70000 });

      await kirimPesananPortal(await akses(tokenKonsi), { lines: kaos(3), idempotencyKey: kunci() });
      const k = await pesananTokoPortal(await akses(tokenKonsi));
      expect(k).toHaveLength(1);
      expect(k[0]).toMatchObject({ keadaan: "MENUNGGU", dariPortal: true, jumlahPcs: 3 });
      const kunciMuatan = semuaKunci(JSON.parse(JSON.stringify(k)));
      for (const r of [...KUNCI_UANG, ...KUNCI_RAHASIA]) expect(kunciMuatan.has(r), r).toBe(false);
    });

    it("a rejected order shows as rejected without the office's reason", async () => {
      await kirimPesananPortal(await akses(tokenPutus), { lines: kaos(2), idempotencyKey: kunci() });
      await prisma.fieldSalesOrder.updateMany({ where: { storeId: seededId(putusId) }, data: { status: "REJECTED", rejectReason: "tagihan nunggak 3 bulan" } });
      const p = await pesananTokoPortal(await akses(tokenPutus));
      expect(p[0].keadaan).toBe("DITOLAK");
      expect(JSON.stringify(p)).not.toContain("nunggak");
      expect(p[0].total).toBeUndefined();
    });
  });
});

describe("portal toko — murni", () => {
  it("WIB day starts at 17:00 UTC the day before", () => {
    expect(awalHariWib(new Date("2026-10-01T16:59:00Z")).toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(awalHariWib(new Date("2026-10-01T17:00:00Z")).toISOString()).toBe("2026-10-01T17:00:00.000Z");
  });

  it("the holder's notification shows money only for PUTUS", () => {
    const putus = kabarPesananPortal({ orderId: "o1", orderNo: "PUTUS/1", namaToko: "Toko A", jenis: "PUTUS", total: 70000, jumlahPcs: 2 });
    expect(putus).toMatchObject({ jenis: "PESANAN_PORTAL", data: { orderId: "o1" } });
    expect(putus.isi).toMatch(/Rp/);
    const konsi = kabarPesananPortal({ orderId: "o2", orderNo: "KONSI/1", namaToko: "Toko B", jenis: "KONSI", total: 999, jumlahPcs: 3 });
    expect(konsi.isi).not.toMatch(/Rp|999/);
  });
});
