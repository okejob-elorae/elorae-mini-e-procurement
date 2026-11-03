import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index";
import { isiKategoriPenjualanSpg } from "./spg-sale-category";
import { seededId, seededIds } from "./spec-teardown";

// Writes rows — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Owner answers 2026-11-02: P8 (commission uses the category stored on the sale line, with its
 * date) and P69 (a piece sold while its item had no category takes the item's category the first
 * time it gets one, then freezes). Pinned against a real database because the guard lives in the
 * WHERE of one statement.
 */
d("isiKategoriPenjualanSpg (test bed only)", () => {
  const tag = `SKAT${Math.random().toString(36).slice(2, 8)}`;
  const jual = new Date("2026-10-05T03:00:00.000Z");
  const isi = new Date("2026-10-20T03:00:00.000Z");

  let uomId = "";
  let tokoId = "";
  let orangId = "";
  let katA = "";
  let katB = "";
  let barang = "";
  let barangLain = "";
  let notaIds: string[] = [];
  let urut = 0;

  beforeEach(async () => {
    uomId = "";
    tokoId = "";
    orangId = "";
    katA = "";
    katB = "";
    barang = "";
    barangLain = "";
    notaIds = [];
    urut += 1;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}-${urut}`, nameId: "pcs", nameEn: "pcs" } })).id;
    tokoId = (await prisma.store.create({ data: { code: `${tag}-S${urut}`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    orangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-${urut}@uji.local`, name: `${tag} SPG`, passwordHash: "x" } })).id;
    katA = (await prisma.itemCategory.create({ data: { name: `${tag} Blus` } })).id;
    katB = (await prisma.itemCategory.create({ data: { name: `${tag} Rok` } })).id;
    barang = (await prisma.item.create({ data: { sku: `${tag}-A${urut}`, nameId: "Blus", nameEn: "Blouse", type: "FINISHED_GOOD", uomId } })).id;
    barangLain = (await prisma.item.create({ data: { sku: `${tag}-B${urut}`, nameId: "Rok", nameEn: "Skirt", type: "FINISHED_GOOD", uomId } })).id;
  });

  afterEach(async () => {
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(notaIds) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: [barang, barangLain].map(seededId) } } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: [katA, katB].map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.user.deleteMany({ where: { id: seededId(orangId) } });
  });

  type Baris = { itemId: string; categoryId: string | null; categoryAt: Date | null };

  /** One SPG note with the given lines; returns the line ids in the same order. */
  async function nota(baris: Baris[]): Promise<string[]> {
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}/${urut}/${notaIds.length + 1}`,
        salesmanId: orangId,
        storeId: tokoId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: orangId,
        createdAt: jual,
        lines: { create: baris.map((b) => ({ ...b, productName: "uji", qty: 1, unitPrice: 100_000, lineTotal: 100_000 })) },
      },
      select: { id: true },
    });
    notaIds.push(s.id);
    // Matched back in input order: the ids of a nested create are not guaranteed to sort by insert.
    const sisa = await prisma.spgSaleLine.findMany({ where: { spgSaleId: s.id }, select: { id: true, itemId: true, categoryId: true, categoryAt: true } });
    return baris.map((b) => {
      const i = sisa.findIndex((x) => x.itemId === b.itemId && x.categoryId === b.categoryId && (x.categoryAt?.getTime() ?? null) === (b.categoryAt?.getTime() ?? null));
      return sisa.splice(i, 1)[0].id;
    });
  }

  const baca = (id: string) =>
    prisma.spgSaleLine.findUniqueOrThrow({
      where: { id: seededId(id) },
      select: { categoryId: true, categoryAt: true, categoryFilledLater: true },
    });

  it("fills a line sold with no category, once, and stamps when and that it was filled later", async () => {
    const [kosong] = await nota([{ itemId: barang, categoryId: null, categoryAt: jual }]);

    const n = await prisma.$transaction((tx) => isiKategoriPenjualanSpg(tx, { itemId: barang, categoryId: katA, waktu: isi }));

    expect(n).toBe(1);
    expect(await baca(kosong)).toEqual({ categoryId: katA, categoryAt: isi, categoryFilledLater: true });
  });

  it("never changes a line that already has a category, so a later item change does not re-rate it", async () => {
    const [kosong, berkategori] = await nota([
      { itemId: barang, categoryId: null, categoryAt: jual },
      { itemId: barang, categoryId: katB, categoryAt: jual },
    ]);

    await prisma.$transaction((tx) => isiKategoriPenjualanSpg(tx, { itemId: barang, categoryId: katA, waktu: isi }));
    const lagi = await prisma.$transaction((tx) =>
      isiKategoriPenjualanSpg(tx, { itemId: barang, categoryId: katB, waktu: new Date("2026-10-25T03:00:00.000Z") }),
    );

    expect(lagi).toBe(0);
    expect(await baca(kosong)).toEqual({ categoryId: katA, categoryAt: isi, categoryFilledLater: true });
    expect(await baca(berkategori)).toEqual({ categoryId: katB, categoryAt: jual, categoryFilledLater: false });
  });

  it("leaves a deploy-window line (no categoryAt) and another item's line untouched", async () => {
    const [jendela, lain] = await nota([
      { itemId: barang, categoryId: null, categoryAt: null },
      { itemId: barangLain, categoryId: null, categoryAt: jual },
    ]);

    const n = await prisma.$transaction((tx) => isiKategoriPenjualanSpg(tx, { itemId: barang, categoryId: katA, waktu: isi }));

    expect(n).toBe(0);
    expect(await baca(jendela)).toEqual({ categoryId: null, categoryAt: null, categoryFilledLater: false });
    expect(await baca(lain)).toEqual({ categoryId: null, categoryAt: jual, categoryFilledLater: false });
  });

  it("is a no-op when the item has no category", async () => {
    const [kosong] = await nota([{ itemId: barang, categoryId: null, categoryAt: jual }]);

    const n = await prisma.$transaction((tx) => isiKategoriPenjualanSpg(tx, { itemId: barang, categoryId: null, waktu: isi }));

    expect(n).toBe(0);
    expect(await baca(kosong)).toEqual({ categoryId: null, categoryAt: jual, categoryFilledLater: false });
  });

  it("racing two fills with different categories fills the line exactly once", async () => {
    const [kosong] = await nota([{ itemId: barang, categoryId: null, categoryAt: jual }]);

    const hasil = await Promise.all(
      [katA, katB].map((categoryId) =>
        prisma.$transaction((tx) => isiKategoriPenjualanSpg(tx, { itemId: barang, categoryId, waktu: isi })),
      ),
    );

    expect(hasil.reduce((a, b) => a + b, 0)).toBe(1);
    const akhir = await baca(kosong);
    expect([katA, katB]).toContain(akhir.categoryId);
    expect(akhir.categoryId).toBe(hasil[0] === 1 ? katA : katB);
  });
});
