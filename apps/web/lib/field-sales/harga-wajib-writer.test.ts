import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Barang PUTUS tanpa harga ditolak penulis pesanan — terhadap basis data uji.
 *
 * Dulu `computeStorePrice(...).price ?? 0` menjadikan barang tanpa harga baris
 * Rp 0 yang lolos sampai persetujuan. Fixture milik tes (pengguna, toko, barang
 * berkode acak); teardown hanya lewat id yang diseed. Aturan pemilik (minimum,
 * jarak jauh, kredit) DITIRUKAN supaya tes tidak mengubah pengaturan bersama.
 */
const { mockMinimum, mockAturanJarakJauh, mockKredit } = vi.hoisted(() => ({
  mockMinimum: vi.fn(),
  mockAturanJarakJauh: vi.fn(),
  mockKredit: vi.fn(),
}));
vi.mock("./minimum-toko", () => ({ muatMinimumToko: mockMinimum }));
vi.mock("./jarak-jauh-toko", () => ({ muatAturanJarakJauh: mockAturanJarakJauh }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: mockKredit }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: vi.fn() }));

import { ATURAN_JARAK_JAUH_BAWAAN } from "./jarak-jauh";
import { bacaAturanMinimum } from "./minimum-pesanan";
import { createFieldSalesOrder } from "./writer";
import { BarangTanpaHargaError } from "./harga-wajib";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `HRG-${Math.random().toString(36).slice(2, 10)}`;

d("createFieldSalesOrder — barang PUTUS tanpa harga (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let kaos = "";
  let topi = "";
  let gratis = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let visitId = "";
  let visitKonsiId = "";
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    sales = (await prisma.user.create({ data: { email: `${tag}-sales@test.local`.toLowerCase(), name: `Sales ${tag}` } })).id;
    const barang = async (kode: string, sellingPrice: number | null) =>
      (
        await prisma.item.create({
          data: { sku: `${tag}-${kode}`, nameId: `${kode} Uji`, nameEn: kode, type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice },
        })
      ).id;
    kaos = await barang("KAOS", 35000);
    topi = await barang("TOPI", null);
    gratis = await barang("GRATIS", 0);
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "x", termsType, isActive: true, salesmanId: sales, markupPercent: termsType === "KONSI" ? 20 : null },
        })
      ).id;
    tokoPutus = await toko("PUTUS", "PUTUS");
    tokoKonsi = await toko("KONSI", "KONSI");
  });

  beforeEach(async () => {
    visitId = "";
    visitKonsiId = "";
    mockMinimum.mockReset().mockResolvedValue({ min: 1, jenis: "PERTAMA", aturan: bacaAturanMinimum(null, null) });
    mockAturanJarakJauh.mockReset().mockResolvedValue({ ...ATURAN_JARAK_JAUH_BAWAAN });
    mockKredit.mockReset().mockResolvedValue(null);
    const ids = seededIds([kaos, topi, gratis].filter(Boolean));
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(ids) } } });
    for (const itemId of ids) {
      await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });
    }
    visitId = (await prisma.storeVisit.create({ data: { storeId: tokoPutus, userId: sales, checkinLat: 0, checkinLng: 0 } })).id;
    visitKonsiId = (await prisma.storeVisit.create({ data: { storeId: tokoKonsi, userId: sales, checkinLat: 0, checkinLng: 0 } })).id;
  });

  afterEach(async () => {
    const tokoIds = seededIds([tokoPutus, tokoKonsi].filter(Boolean));
    const pesanan = await prisma.fieldSalesOrder.findMany({ where: { storeId: { in: tokoIds } }, select: { id: true, orderNo: true } });
    const orderIds = pesanan.map((p) => p.id);
    const orderNos = pesanan.map((p) => p.orderNo);
    // Catatan kantor yang ditulis penulis: dicocokkan di JS lewat metadata pesanan tes ini.
    const catatan = await prisma.adminNotification.findMany({
      where: { category: { in: ["PENDING_ORDER_APPROVAL", "STOCK_OVERSELL_RISK"] } },
      select: { id: true, metadata: true },
    });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return (
          (typeof m?.orderId === "string" && orderIds.includes(m.orderId)) ||
          (typeof m?.orderNo === "string" && orderNos.includes(m.orderNo))
        );
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesOrder", entityId: { in: seededIds(orderIds) } } });
    const lineIds = (await prisma.fieldSalesOrderLine.findMany({ where: { orderId: { in: seededIds(orderIds) } }, select: { id: true } })).map((l) => l.id);
    await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(lineIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds([visitId, visitKonsiId].filter(Boolean)) } } });
  });

  afterAll(async () => {
    const ids = seededIds([kaos, topi, gratis].filter(Boolean));
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(ids) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoKonsi].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: seededId(sales) } });
  });

  const baris = (itemId: string, qty: number) => ({ itemId, variantSku: "", productName: `Barang ${itemId}`, qty, unitPrice: 0 });
  const putus = (lines: ReturnType<typeof baris>[], extra: Partial<Parameters<typeof createFieldSalesOrder>[0]> = {}) =>
    createFieldSalesOrder({ storeId: tokoPutus, salesmanId: sales, visitId, lines, idempotencyKey: kunci(), ...extra });
  const jumlahPesanan = (storeId: string) => prisma.fieldSalesOrder.count({ where: { storeId } });
  const dipesan = async (itemId: string) => Number((await prisma.inventoryValue.findFirstOrThrow({ where: { itemId } })).reservedQty);
  const tolakan = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e;
    }
    throw new Error("expected the writer to refuse");
  };

  it("refuses a PUTUS line whose item has no price (null): nothing recorded, nothing reserved", async () => {
    const e = await tolakan(putus([baris(kaos, 2), baris(topi, 3)]));
    expect(e).toBeInstanceOf(BarangTanpaHargaError);
    expect((e as BarangTanpaHargaError).itemIds).toEqual([topi]);
    expect(await jumlahPesanan(tokoPutus)).toBe(0);
    expect(await dipesan(kaos)).toBe(0);
    expect(await dipesan(topi)).toBe(0);
  });

  it("refuses a PUTUS line priced 0 the same way, and names every unpriced item once", async () => {
    const e = await tolakan(putus([baris(gratis, 1), baris(kaos, 1), baris(topi, 1), { ...baris(gratis, 2), variantSku: "" }]));
    expect(e).toBeInstanceOf(BarangTanpaHargaError);
    expect((e as BarangTanpaHargaError).itemIds).toEqual([gratis, topi]);
    expect(await jumlahPesanan(tokoPutus)).toBe(0);
  });

  it("refuses an unknown item (no price to look up) instead of recording a Rp 0 line", async () => {
    const e = await tolakan(putus([baris(kaos, 1), baris(`${tag}-tidak-ada`, 1)]));
    expect(e).toBeInstanceOf(BarangTanpaHargaError);
    expect((e as BarangTanpaHargaError).itemIds).toEqual([`${tag}-tidak-ada`]);
    expect(await jumlahPesanan(tokoPutus)).toBe(0);
  });

  it("a priced PUTUS order still goes through at the server price", async () => {
    const r = await putus([baris(kaos, 2)]);
    const o = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: r.orderId }, include: { lines: true } });
    expect(o.lines.map((l) => [Number(l.unitPrice), Number(l.lineTotal)])).toEqual([[35000, 70000]]);
    expect(Number(o.total)).toBe(70000);
    expect(await dipesan(kaos)).toBe(2);
  });

  it("KONSI is untouched: an unpriced item is still captured (no price ever comes from the salesman)", async () => {
    const r = await createFieldSalesOrder({ storeId: tokoKonsi, salesmanId: sales, visitId: visitKonsiId, lines: [baris(topi, 2)], idempotencyKey: kunci() });
    const o = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: r.orderId }, include: { lines: true } });
    expect(o.orderType).toBe("KONSI");
    expect(o.lines.map((l) => [l.itemId, l.qty, Number(l.unitPrice)])).toEqual([[topi, 2, 0]]);
  });

  it("editing a pending order into one with an unpriced item is refused and the old order stays pending", async () => {
    const lama = await putus([baris(kaos, 2)]);
    const e = await tolakan(putus([baris(kaos, 2), baris(topi, 1)], { replacesOrderId: lama.orderId }));
    expect(e).toBeInstanceOf(BarangTanpaHargaError);
    const o = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: lama.orderId } });
    expect(o.status).toBe("PENDING_APPROVAL");
    expect(o.cancelledAt).toBeNull();
    expect(await jumlahPesanan(tokoPutus)).toBe(1);
    expect(await dipesan(kaos)).toBe(2);
  });

  it("a replay of an order recorded before the item lost its price still returns that order", async () => {
    const k = kunci();
    const pertama = await putus([baris(kaos, 1)], { idempotencyKey: k });
    await prisma.item.update({ where: { id: kaos }, data: { sellingPrice: null } });
    try {
      const ulang = await putus([baris(kaos, 1)], { idempotencyKey: k });
      expect(ulang.orderId).toBe(pertama.orderId);
    } finally {
      await prisma.item.update({ where: { id: kaos }, data: { sellingPrice: 35000 } });
    }
  });
});
