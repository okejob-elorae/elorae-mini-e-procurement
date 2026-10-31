import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { getTrenPenjualan } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * KEPUTUSAN 19 sampai ke grafik: nota SPG di toko KONSI tercatat dengan harga
 * toko, tetapi grafik tren menghitungnya dengan harga Elorae. Basis data
 * dipakai bersama, jadi yang diperiksa SELISIH titik hari ini.
 */
d("getTrenPenjualan — nota SPG toko KONSI (test bed only)", () => {
  let tag = "";
  let userId = "";
  let tokoKonsiId = "";
  let tokoPutusId = "";
  let saleIds: string[] = [];

  beforeEach(async () => {
    tag = `TSK-${Math.random().toString(36).slice(2, 10)}`;
    userId = "";
    tokoKonsiId = "";
    tokoPutusId = "";
    saleIds = [];
    userId = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "SPG uji" } })).id;
    tokoKonsiId = (
      await prisma.store.create({
        data: { code: `${tag}-K`, name: "Konsi", address: "-", termsType: "KONSI", markupPercent: 25, isActive: true },
      })
    ).id;
    tokoPutusId = (
      await prisma.store.create({
        data: { code: `${tag}-P`, name: "Putus", address: "-", termsType: "PUTUS", isActive: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(saleIds) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoKonsiId, tokoPutusId].filter(Boolean)) } } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  async function nota(n: number, storeId: string, total: number) {
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-${n}`,
        salesmanId: userId,
        createdById: userId,
        storeId,
        subtotal: total,
        total,
        cashReceived: total,
        changeGiven: 0,
      },
    });
    saleIds.push(s.id);
  }

  it("100.000 di toko KONSI markup 25% masuk 80.000; toko PUTUS apa adanya", async () => {
    const sekarang = new Date();
    const sebelum = (await getTrenPenjualan(sekarang)).at(-1)!;

    await nota(1, tokoKonsiId, 100_000);
    await nota(2, tokoPutusId, 40_000);

    const sesudah = (await getTrenPenjualan(sekarang)).at(-1)!;
    expect(sesudah.spg - sebelum.spg).toBe(120_000);
    expect(sesudah.lapangan - sebelum.lapangan).toBe(120_000);
  });
});
