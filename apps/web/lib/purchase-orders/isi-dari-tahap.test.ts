import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ruangKerjaTahap } from "@/lib/production/jadwal-queries";
import { isiPoDariTahap } from "./isi-dari-tahap";

/*
 * PO baru terisi dari tahap — terhadap basis data uji. Kekurangan = kebutuhan
 * kartu Kebutuhan bahan − PO tahap yang tidak batal. Tahun plan acak 2050–2099.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `IPT-${Math.random().toString(36).slice(2, 9)}`;

d("isiPoDariTahap (test bed only)", () => {
  let user = "";
  let planYear = "";
  let kategori = "";
  let tahap = "";
  let tahapTanpaBarang = "";
  let kategoriKosong = "";
  let jenis = "";
  let pemasok = "";
  let uomKg = "";
  let uomPcs = "";
  let kaos = "";
  let kain = "";
  let kancing = "";
  let rib = "";
  const poIds: string[] = [];

  beforeAll(async () => {
    user = planYear = kategori = tahap = tahapTanpaBarang = kategoriKosong = jenis = pemasok = "";
    uomKg = uomPcs = kaos = kain = kancing = rib = "";
    poIds.length = 0;
    user = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: `PO ${tag}` } })).id;
    let tahun = 2050 + Math.floor(Math.random() * 50);
    while (await prisma.planYear.findUnique({ where: { year: tahun }, select: { id: true } })) tahun = 2050 + ((tahun - 2049) % 50);
    planYear = (await prisma.planYear.create({ data: { year: tahun, createdById: user } })).id;
    uomKg = (await prisma.uOM.create({ data: { code: `KG-${tag}`, nameId: "kg", nameEn: "kg" } })).id;
    uomPcs = (await prisma.uOM.create({ data: { code: `PC-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = (sku: string, type: "FINISHED_GOOD" | "FABRIC" | "ACCESSORIES", uomId: string) =>
      prisma.item.create({ data: { sku: `${tag}-${sku}`, nameId: `${sku} uji`, nameEn: sku, type, uomId } }).then((i) => i.id);
    kaos = await barang("KAOS", "FINISHED_GOOD", uomPcs);
    kain = await barang("KAIN", "FABRIC", uomKg);
    kancing = await barang("KANCING", "ACCESSORIES", uomPcs);
    rib = await barang("RIB", "FABRIC", uomKg);
    await prisma.consumptionRule.createMany({
      data: [
        { finishedGoodId: kaos, materialId: kain, qtyRequired: 0.27, wastePercent: 5 },
        { finishedGoodId: kaos, materialId: kancing, qtyRequired: 6, wastePercent: 0 },
        { finishedGoodId: kaos, materialId: rib, qtyRequired: 0.05, wastePercent: 0 },
      ],
    });
    kategori = (await prisma.planCategory.create({ data: { planYearId: planYear, code: `${tag}-K`, name: `Kaos ${tag}`, itemId: kaos } })).id;
    kategoriKosong = (await prisma.planCategory.create({ data: { planYearId: planYear, code: `${tag}-L`, name: `Lain ${tag}`, sortOrder: 1 } })).id;
    tahap = (await prisma.planStage.create({ data: { name: `Batch 1 ${tag}`, planCategoryId: kategori, targetQty: 1000 } })).id;
    tahapTanpaBarang = (await prisma.planStage.create({ data: { name: `Batch X ${tag}`, planCategoryId: kategoriKosong, targetQty: 10 } })).id;

    jenis = (await prisma.supplierType.create({ data: { code: tag, name: `Jenis ${tag}` } })).id;
    pemasok = (await prisma.supplier.create({ data: { code: `${tag}-S`, name: `Kain ${tag}`, typeId: jenis } })).id;
    const po = async (kode: string, status: "DRAFT" | "SUBMITTED" | "CANCELLED", baris: { itemId: string; qty: number; uomId: string }[]) => {
      const p = await prisma.purchaseOrder.create({
        data: {
          docNumber: `PO-${tag}-${kode}`,
          supplierId: pemasok,
          status,
          createdById: user,
          planStageId: tahap,
          items: { create: baris.map((b) => ({ ...b, price: 1000 })) },
        },
      });
      poIds.push(p.id);
    };
    // Kain butuh 1000 × 0,27 × 1,05 = 283,5; sudah 100 + 50 di PO hidup.
    await po("1", "SUBMITTED", [{ itemId: kain, qty: 100, uomId: uomKg }]);
    await po("2", "DRAFT", [
      { itemId: kain, qty: 50, uomId: uomKg },
      { itemId: rib, qty: 50, uomId: uomKg },
    ]);
    // PO batal tidak dihitung.
    await po("3", "CANCELLED", [{ itemId: kancing, qty: 6000, uomId: uomPcs }]);
  });

  afterAll(async () => {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
    await prisma.planStage.deleteMany({ where: { id: { in: seededIds([tahap, tahapTanpaBarang].filter(Boolean)) } } });
    await prisma.planCategory.deleteMany({ where: { id: { in: seededIds([kategori, kategoriKosong].filter(Boolean)) } } });
    await prisma.planYear.deleteMany({ where: { id: seededId(planYear) } });
    await prisma.consumptionRule.deleteMany({ where: { finishedGoodId: seededId(kaos) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, kain, kancing, rib].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: { in: seededIds([uomKg, uomPcs].filter(Boolean)) } } });
    await prisma.supplier.deleteMany({ where: { id: seededId(pemasok) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(jenis) } });
    await prisma.user.deleteMany({ where: { id: seededId(user) } });
  });

  it("mengisi kekurangan tiap bahan, satuan bahan, dan catatan Produksi <tahap> · <jenis>", async () => {
    const hasil = await isiPoDariTahap(tahap, { isiKurang: true });
    expect(hasil?.tahap).toEqual({ id: tahap, kode: `${tag}-K`, nama: `Batch 1 ${tag}` });
    expect(hasil?.isi).toEqual({
      notes: `Produksi Batch 1 ${tag} · Kaos ${tag}`,
      items: [
        { itemId: kain, uomId: uomKg, qty: 133.5 },
        { itemId: kancing, uomId: uomPcs, qty: 6000 },
      ],
    });
  });

  it("kekurangan = angka kartu Kebutuhan bahan (satu rumus)", async () => {
    const kartu = await ruangKerjaTahap(tahap, { lihatPo: true, lihatSpk: false });
    const hasil = await isiPoDariTahap(tahap, { isiKurang: false });
    expect(hasil?.isi).toBeNull();
    expect(hasil?.kebutuhan.targetQty).toBe(1000);
    expect(hasil?.kebutuhan.bahan.map((b) => [b.itemId, b.butuh, b.diPo])).toEqual(
      kartu!.kebutuhan.map((k) => [k.itemId, k.butuh, k.diPo]),
    );
    const kain_ = hasil!.kebutuhan.bahan.find((b) => b.itemId === kain)!;
    expect([kain_.butuh, kain_.diPo]).toEqual([283.5, 150]);
  });

  it("pilihan bahan menyaring; bahan yang sudah cukup tidak terisi", async () => {
    const hasil = await isiPoDariTahap(tahap, { isiKurang: true, bahan: [kancing, rib] });
    expect(hasil?.isi?.items).toEqual([{ itemId: kancing, uomId: uomPcs, qty: 6000 }]);
  });

  it("tahap tanpa barang jadi → tanpa kebutuhan, tanpa baris; tahap tidak ada → null", async () => {
    const hasil = await isiPoDariTahap(tahapTanpaBarang, { isiKurang: true });
    expect(hasil?.kebutuhan.bahan).toEqual([]);
    expect(hasil?.isi).toEqual({ notes: `Produksi Batch X ${tag} · Lain ${tag}`, items: [] });
    expect(await isiPoDariTahap(`tidak-ada-${tag}`, { isiKurang: true })).toBeNull();
  });
});
