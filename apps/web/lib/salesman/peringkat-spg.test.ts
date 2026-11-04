import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { peringkatSpgBulan } from "./peringkat-spg";

/*
 * Papan peringkat SPG terhadap basis data uji. Bulan lampau acak: SPG lain di
 * basis data bersama tidak punya nota di bulan itu, jadi urutan SPG buatan tes
 * di antara mereka sendiri pasti. Pengaturan `salesman.peringkat` dibaca apa
 * adanya, tidak diubah. Teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const TAHUN = 2003 + Math.floor(Math.random() * 17);
const BULAN = `${TAHUN}-07`;
const tgl = (hari: number) => new Date(`${BULAN}-${String(hari).padStart(2, "0")}T10:00:00+07:00`);
const HARI_INI = tgl(28);

d("peringkat SPG — penjualan bersih (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let tokoId = "";
  let salesId = "";
  let spgA = "";
  let spgB = "";
  let spgC = "";
  let notaIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    tokoId = "";
    salesId = "";
    spgA = "";
    spgB = "";
    spgC = "";
    notaIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PRS-${token}`, nameId: "t", nameEn: "t" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `TEST-PRS-${token}`, nameId: "Barang", nameEn: "Item", type: "FINISHED_GOOD", uomId },
      })
    ).id;
    tokoId = (await prisma.store.create({ data: { code: `TST-PRS-${token}`, name: `Toko PRS ${token}`, address: "x", termsType: "KONSI" } }))
      .id;
    const orang = async (k: string, assignedStoreId: string | null) =>
      (await prisma.user.create({ data: { email: `prs-${k}-${token}@test.local`, name: `${k} ${token}`, assignedStoreId } })).id;
    salesId = await orang("sales", null);
    spgA = await orang("spgA", tokoId);
    spgB = await orang("spgB", tokoId);
    spgC = await orang("spgC", tokoId);

    let n = 0;
    const nota = async (salesmanId: string, qty: number, returnedQty: number, createdAt = tgl(10)) => {
      n += 1;
      const total = qty * 100_000;
      notaIds.push(
        (
          await prisma.spgSale.create({
            data: {
              docNo: `TEST-PRS-${token}-${n}`,
              salesmanId,
              storeId: tokoId,
              subtotal: total,
              total,
              cashReceived: total,
              changeGiven: 0,
              createdById: salesmanId,
              createdAt,
              lines: { create: [{ itemId, productName: "x", qty, unitPrice: 100_000, lineTotal: total, returnedQty }] },
            },
          })
        ).id,
      );
    };
    // A kotor 5 tapi 3 dikembalikan pembeli → bersih 2. B bersih 3. C tidak menjual bulan ini.
    await nota(spgA, 5, 3);
    await nota(spgB, 3, 0);
    // Nota C bulan lalu: tidak dihitung bulan ini.
    await nota(spgC, 9, 0, new Date(`${TAHUN}-06-15T10:00:00+07:00`));
  });

  afterAll(async () => {
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(notaIds) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId, spgA, spgB, spgC].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("urut menurut penjualan BERSIH: retur pembeli menurunkan peringkat", async () => {
    const { baris } = await peringkatSpgBulan(BULAN, spgA, HARI_INI);
    const posisi = (id: string) => baris.findIndex((b) => b.id === id);
    expect(posisi(spgB)).toBeGreaterThanOrEqual(0);
    expect(posisi(spgB)).toBeLessThan(posisi(spgA));
    expect(posisi(spgA)).toBeLessThan(posisi(spgC));
  });

  it("hanya SPG: salesman tidak pernah ikut papan ini", async () => {
    const { baris } = await peringkatSpgBulan(BULAN, spgA, HARI_INI);
    expect(baris.some((b) => b.id === salesId)).toBe(false);
  });

  it("rupiah dan pcs rekan tidak pernah dikirim; milik sendiri ada", async () => {
    const { baris } = await peringkatSpgBulan(BULAN, spgA, HARI_INI);
    const saya = baris.find((b) => b.id === spgA)!;
    expect(saya).toMatchObject({ diriSendiri: true, omzet: 200_000, pcs: 2, nama: `spgA ${token}` });
    for (const b of baris.filter((x) => !x.diriSendiri)) {
      expect(b.omzet).toBeNull();
      expect(b.pcs).toBeNull();
      expect(b.persen).toBeNull();
      // Toko hanya ikut bila namanya juga terlihat.
      if (b.nama === null) expect(b.toko).toBeNull();
    }
  });
});
