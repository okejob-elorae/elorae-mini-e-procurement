import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { aturanDariKolom, rekomendasiHargaJual } from "./rekomendasi-harga";
import { rekomendasiUntukBarang } from "./rekomendasi-harga-queries";
import { bacaHppTerbaru } from "./riwayat-hpp-queries";

/*
 * Laporan HPP menampilkan SATU rekomendasi per barang (jawaban pemilik P4a, 2026-11-02), dihitung
 * dari masukan yang persis sama dengan halaman barang. Basis data uji; barang milik tes sendiri.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("rekomendasiUntukBarang (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let uomId = "";
  let itemIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `RH${token}`.slice(0, 12), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
  });

  afterEach(async () => {
    await prisma.item.deleteMany({ where: { id: { in: itemIds.map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function barang(lain: Record<string, unknown>) {
    const b = await prisma.item.create({
      data: { sku: `RH-${token}-${itemIds.length}`, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId, ...lain },
      select: { id: true },
    });
    itemIds.push(b.id);
    return b.id;
  }

  it("sama dengan hitungan halaman barang atas masukan yang sama; tanpa HPP → kurang HPP", async () => {
    const a = await barang({ targetMarginPercent: 40, priceRuleBasis: "MARGIN", additionalCost: 2_000 });
    const b = await barang({});
    const hasil = await rekomendasiUntukBarang(prisma, [a, b, a]);
    expect(hasil.size).toBe(2);

    const bawaan = await prisma.jubelioPushDefaults.findFirst({
      select: { defaultMarginPercent: true, defaultPriceRuleBasis: true, defaultAdditionalCost: true },
    });
    for (const id of [a, b]) {
      const item = await prisma.item.findUniqueOrThrow({
        where: { id: seededId(id) },
        select: { targetMarginPercent: true, priceRuleBasis: true, additionalCost: true },
      });
      const hpp = await bacaHppTerbaru(prisma, id);
      const halamanBarang = rekomendasiHargaJual({
        hppTerbaru: hpp,
        aturanBarang: aturanDariKolom(item.targetMarginPercent, item.priceRuleBasis),
        biayaBarang: item.additionalCost != null ? Number(item.additionalCost) : null,
        aturanBawaan: aturanDariKolom(bawaan?.defaultMarginPercent, bawaan?.defaultPriceRuleBasis),
        biayaBawaan: bawaan?.defaultAdditionalCost != null ? Number(bawaan.defaultAdditionalCost) : null,
      });
      expect(hasil.get(id)).toEqual(halamanBarang);
    }
    const tanpaHpp = hasil.get(a);
    expect(tanpaHpp?.ada).toBe(false);
    expect(tanpaHpp && !tanpaHpp.ada && tanpaHpp.kurang).toContain("HPP");
  });

  it("daftar kosong → peta kosong, tanpa membaca apa pun", async () => {
    expect((await rekomendasiUntukBarang(prisma, [])).size).toBe(0);
  });
});
