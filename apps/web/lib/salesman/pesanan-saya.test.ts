import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { pesananSaya } from "./queries";

/*
 * Kartu "Pesanan saya" di HP salesman terhadap basis data uji. Yang dipasak: "terkirim bulan ini"
 * tidak menghitung nota yang dibatalkan ("tidak jadi dikirim", `FieldSalesDelivery.voidedAt`) —
 * aturan yang sama dengan rincian pesanan (`pesananSayaById`); nota itu tidak pernah terkirim.
 *
 * Semua baris milik pengguna buatan tes pada bulan lampau yang acak; teardown hanya lewat id yang
 * diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const pad = (n: number) => String(n).padStart(2, "0");
const BULAN = `${2004 + Math.floor(Math.random() * 16)}-${pad(2 + Math.floor(Math.random() * 10))}`;
const tgl = (hari: number) => new Date(`${BULAN}-${pad(hari)}T10:00:00+07:00`);
/** Dilihat pada pertengahan bulan itu. */
const HARI_INI = tgl(15);

d("pesananSaya — terkirim bulan ini (test bed only)", () => {
  let salesId = "";
  let tokoId = "";
  let orderId = "";
  let deliveryIds: string[] = [];

  beforeAll(async () => {
    salesId = "";
    tokoId = "";
    orderId = "";
    deliveryIds = [];
    salesId = (await prisma.user.create({ data: { email: `ps-${token}@test.local`, name: `Sales PS ${token}` } })).id;
    tokoId = (await prisma.store.create({ data: { code: `TEST-PS-${token}`, name: `Toko PS ${token}`, address: "x", termsType: "PUTUS" } })).id;
    orderId = (
      await prisma.fieldSalesOrder.create({
        data: { orderNo: `TEST-PS-${token}`, storeId: tokoId, salesmanId: salesId, status: "APPROVED", subtotal: 200_000, total: 200_000 },
      })
    ).id;
    let n = 0;
    for (const hari of [3, 5]) {
      n += 1;
      const dl = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-PS-DLV-${token}-${n}`,
          orderId,
          deliveredAt: tgl(hari),
          deliveredById: salesId,
          invoiceDate: tgl(hari),
          dueDate: tgl(hari),
          subtotal: 100_000,
          total: 100_000,
        },
      });
      deliveryIds.push(dl.id);
    }
  });

  afterAll(async () => {
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesId) } });
  });

  it("nota yang dibatalkan tidak dihitung terkirim; mengembalikannya menghitungnya lagi", async () => {
    expect((await pesananSaya(salesId, HARI_INI)).terkirimBulanIni).toBe(2);

    await prisma.fieldSalesDelivery.update({
      where: { id: seededId(deliveryIds[0]) },
      data: { voidedAt: tgl(6), voidReason: "tidak jadi dikirim (uji)" },
    });
    expect((await pesananSaya(salesId, HARI_INI)).terkirimBulanIni).toBe(1);

    await prisma.fieldSalesDelivery.update({ where: { id: seededId(deliveryIds[0]) }, data: { voidedAt: null, voidReason: null } });
    expect((await pesananSaya(salesId, HARI_INI)).terkirimBulanIni).toBe(2);
  });
});
