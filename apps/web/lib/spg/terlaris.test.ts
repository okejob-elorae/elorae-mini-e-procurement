import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { terlarisToko } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

/**
 * "Terlaris" di beranda SPG: laku BERSIH — barang yang dikembalikan pembeli
 * (layak maupun rusak) bukan penjualan. Terhadap basis data uji; teardown
 * lewat `seededId(s)`.
 */
d("terlarisToko — laku bersih (test bed only)", () => {
  const tag = `TRL${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let kaos = "";
  let topi = "";
  let toko = "";
  let spg = "";
  const nota: string[] = [];

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = async (k: string) =>
      (await prisma.item.create({ data: { sku: `${tag}-${k}`, nameId: `${k} ${tag}`, nameEn: k, type: "FINISHED_GOOD", uomId } })).id;
    kaos = await barang("KAOS");
    topi = await barang("TOPI");
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    spg = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: tag, assignedStoreId: toko } })).id;
    const jual = async (itemId: string, qty: number, returnedQty: number) => {
      const s = await prisma.spgSale.create({
        data: {
          docNo: `${tag}-${nota.length}`,
          salesmanId: spg,
          storeId: toko,
          subtotal: 0,
          total: 0,
          cashReceived: 0,
          changeGiven: 0,
          createdById: spg,
          createdAt: new Date(Date.now() - 2 * 86_400_000),
          lines: { create: [{ itemId, productName: itemId === kaos ? "Kaos" : "Topi", qty, unitPrice: 0, lineTotal: 0, returnedQty }] },
        },
        select: { id: true },
      });
      nota.push(s.id);
    };
    // Kaos 5 terjual tapi 3 kembali (bersih 2); topi 3 terjual, tidak ada yang kembali; topi lain 1 terjual dan kembali.
    await jual(kaos, 5, 3);
    await jual(topi, 3, 0);
    await jual(topi, 1, 1);
  });

  afterAll(async () => {
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(nota) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    await prisma.user.deleteMany({ where: { id: seededId(spg) } });
    await prisma.store.deleteMany({ where: { id: seededId(toko) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, topi].filter(Boolean)) } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("urut menurut laku bersih, bukan jumlah di nota", async () => {
    const t = await terlarisToko(toko, new Date());
    expect(t.map((x) => [x.itemId, x.qty])).toEqual([
      [topi, 3],
      [kaos, 2],
    ]);
  });
});
