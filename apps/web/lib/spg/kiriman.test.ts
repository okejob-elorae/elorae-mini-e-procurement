import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { kirimanMenunggu } from "./kiriman";
import { stokToko } from "./queries";
import { terimaKiriman } from "./stok-writer";

/**
 * Kiriman menunggu + terima + saldo, terhadap basis data sungguhan.
 *
 * Kuerinya menggabungkan tiga sumber, batas tanggal pelacakan, dan penerimaan
 * yang sudah ada — tempat kesalahan hidup tanpa ketahuan oleh tes murni.
 * Basis data dipakai bersama data dev: setiap penghapusan lewat `seededId()`.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("kiriman ke toko (basis data)", () => {
  const tag = `KRM-${Math.random().toString(36).slice(2, 8)}`;
  let storeId = "";
  let uomId = "";
  let itemId = "";
  let kirimBaruId = "";
  let kirimLamaId = "";
  const receiptIds: string[] = [];

  beforeEach(async () => {
    storeId = "";
    uomId = "";
    itemId = "";
    kirimBaruId = "";
    kirimLamaId = "";
    receiptIds.length = 0;

    storeId = (await prisma.store.create({ data: { code: tag, name: `${tag} Toko`, address: "uji", termsType: "KONSI", isActive: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({ data: { sku: tag, nameId: "Kemeja Uji", nameEn: "Test", type: "FINISHED_GOOD", uomId, isActive: true } })
    ).id;

    const hariLalu = (n: number) => new Date(Date.now() - n * 86_400_000);
    kirimBaruId = (
      await prisma.consignmentShipment.create({
        data: {
          noKirim: `${tag}-1`,
          storeId,
          shippedAt: hariLalu(3),
          items: { create: [{ itemId, itemName: "Kemeja Uji", qty: 6, price: 0, amount: 0 }, { itemName: "Hanger", qty: 10, price: 0, amount: 0 }] },
        },
      })
    ).id;
    kirimLamaId = (
      await prisma.consignmentShipment.create({
        data: { noKirim: `${tag}-2`, storeId, shippedAt: hariLalu(45), items: { create: [{ itemId, itemName: "Kemeja Uji", qty: 4, price: 0, amount: 0 }] } },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: receiptIds.map(seededId) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: [kirimBaruId, kirimLamaId].filter(Boolean).map(seededId) } } });
    if (itemId) await prisma.item.delete({ where: { id: itemId } });
    if (uomId) await prisma.uOM.delete({ where: { id: uomId } });
    if (storeId) await prisma.store.delete({ where: { id: storeId } });
  });

  it("offers only the last 30 days while the store is not tracked yet", async () => {
    const menunggu = await kirimanMenunggu(storeId);
    expect(menunggu.map((k) => k.docNo)).toEqual([`${tag}-1`]);
    expect(menunggu[0].lines).toHaveLength(2);
  });

  it("receiving moves stock by the counted quantity and removes the shipment from the waiting list", async () => {
    const [k] = await kirimanMenunggu(storeId);
    const hasil = await terimaKiriman({
      storeId,
      userId: "uji-spg",
      sourceType: k.sourceType,
      sourceId: k.sourceId,
      diterima: k.lines.map((l) => ({ lineId: l.lineId, qtyReceived: l.itemId ? 5 : 10 })),
    });
    if (!hasil.ok) throw new Error(hasil.alasan);
    receiptIds.push(hasil.receiptId);

    expect(await kirimanMenunggu(storeId)).toEqual([]);
    const stok = await stokToko(storeId);
    expect(stok).toEqual([expect.objectContaining({ itemId, qty: 5, nama: "Kemeja Uji" })]);
  });

  it("the same shipment cannot be received twice", async () => {
    const [k] = await kirimanMenunggu(storeId);
    const diterima = k.lines.map((l) => ({ lineId: l.lineId, qtyReceived: 1 }));
    const pertama = await terimaKiriman({ storeId, userId: "uji-spg", sourceType: k.sourceType, sourceId: k.sourceId, diterima });
    if (pertama.ok) receiptIds.push(pertama.receiptId);
    const kedua = await terimaKiriman({ storeId, userId: "uji-spg", sourceType: k.sourceType, sourceId: k.sourceId, diterima });
    expect(kedua).toEqual({ ok: false, alasan: "SUDAH_DITERIMA" });
    const stok = await stokToko(storeId);
    expect(stok[0].qty).toBe(1);
  });

  it("refuses a shipment addressed to another store", async () => {
    const hasil = await terimaKiriman({
      storeId: "toko-lain",
      userId: "uji-spg",
      sourceType: "KONSI_SHIPMENT",
      sourceId: kirimBaruId,
      diterima: [],
    });
    expect(hasil).toEqual({ ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" });
  });
});
