import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bacaTambahan } from "@/lib/spg/saran-minta";
import { mintaDariPembeli } from "../stok/minta/dari-pembeli";
import { barangDicariUntukMinta } from "../dicari/minta-queries";
import { barangTitipMenunggu } from "./minta-queries";

/*
 * Bahan tautan "Minta ke salesman" dari titip pesan dan barang dicari: hanya
 * milik toko/pencatat pemanggil, hanya titip pesan yang masih menunggu, dan
 * barang ketik bebas terhitung tanpa ikut terisi.
 *
 * Jangan pernah dijalankan ke basis data produksi (terowongan :3307 / host VPS).
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("bahan 'Minta ke salesman' dari titip pesan dan barang dicari (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let tokoA = "";
  let tokoB = "";
  let spgA = "";
  let spgB = "";
  const titipIds: string[] = [];
  const dicariIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    tokoA = "";
    tokoB = "";
    spgA = "";
    spgB = "";
    titipIds.length = 0;
    dicariIds.length = 0;
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-MTP-${token}`, nameId: "t", nameEn: "t" } })).id;
    itemId = (
      await prisma.item.create({ data: { sku: `TEST-MTP-${token}`, nameId: "Kaos MTP", nameEn: "Tee MTP", type: "FINISHED_GOOD", uomId } })
    ).id;
    spgA = (await prisma.user.create({ data: { email: `test-mtp-a-${token}@example.com`, name: "SPG A" } })).id;
    spgB = (await prisma.user.create({ data: { email: `test-mtp-b-${token}@example.com`, name: "SPG B" } })).id;
    tokoA = (await prisma.store.create({ data: { code: `TEST-MTP-A-${token}`, name: `Toko A ${token}`, address: "x", termsType: "KONSI" } })).id;
    tokoB = (await prisma.store.create({ data: { code: `TEST-MTP-B-${token}`, name: `Toko B ${token}`, address: "x", termsType: "KONSI" } })).id;

    const titip = (storeId: string, data: { itemId?: string | null; variantSku?: string; qty: number; status?: string; description: string }) =>
      prisma.customerRequest.create({
        data: { storeId, customerId: `cust-${token}`, createdById: spgA, itemId: data.itemId ?? null, variantSku: data.variantSku ?? "", qty: data.qty, status: data.status ?? "MENUNGGU", description: data.description },
        select: { id: true },
      });
    titipIds.push((await titip(tokoA, { itemId, variantSku: "MTP-XL", qty: 2, description: "Kaos MTP XL" })).id);
    titipIds.push((await titip(tokoA, { qty: 1, description: "kemeja flanel hijau" })).id);
    titipIds.push((await titip(tokoA, { itemId, variantSku: "MTP-M", qty: 4, status: "DIKABARI", description: "Kaos MTP M" })).id);
    titipIds.push((await titip(tokoB, { itemId, variantSku: "MTP-S", qty: 3, description: "Kaos MTP S" })).id);

    const dicari = (userId: string, data: { itemId?: string | null; variantSku?: string; qty: number; storeId?: string }) =>
      prisma.lostSale.create({
        data: { storeId: data.storeId ?? tokoA, userId, itemId: data.itemId ?? null, variantSku: data.variantSku ?? "", qty: data.qty, description: "dicari" },
        select: { id: true },
      });
    dicariIds.push((await dicari(spgA, { itemId, variantSku: "MTP-L", qty: 5 })).id);
    dicariIds.push((await dicari(spgA, { qty: 1 })).id);
    dicariIds.push((await dicari(spgB, { itemId, qty: 2 })).id);
    // Catatan SPG A di toko lamanya (toko B) — sesudah dipindah ke toko A tidak boleh ikut diminta.
    dicariIds.push((await dicari(spgA, { itemId, variantSku: "MTP-S", qty: 7, storeId: tokoB })).id);
  });

  afterAll(async () => {
    await prisma.customerRequest.deleteMany({ where: { id: { in: seededIds(titipIds) } } });
    await prisma.lostSale.deleteMany({ where: { id: { in: seededIds(dicariIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgB]) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("titip pesan: only this store's WAITING requests, typed-name ones counted but not filled", async () => {
    const bahan = await barangTitipMenunggu(tokoA, titipIds);
    expect([...bahan.keys()].sort()).toEqual([titipIds[0], titipIds[1]].sort());
    const h = mintaDariPembeli([bahan.get(titipIds[0])!, bahan.get(titipIds[1])!], "TITIP_PEMBELI");
    expect(h.terisi).toBe(1);
    expect(h.tanpaBarang).toBe(1);
    expect(bacaTambahan(new URL(h.alamat, "https://x.test").searchParams.get("tambah"))).toEqual([
      { itemId, variantSku: "MTP-XL", qty: 2, alasan: "TITIP_PEMBELI" },
    ]);
  });

  it("barang dicari: only the SPG's own records AT THIS STORE, with the recorded size and quantity", async () => {
    const bahan = await barangDicariUntukMinta(spgA, tokoA, dicariIds);
    expect([...bahan.keys()].sort()).toEqual([dicariIds[0], dicariIds[1]].sort());
    expect(bahan.get(dicariIds[0])).toEqual({ itemId, variantSku: "MTP-L", qty: 5 });
    expect(bahan.get(dicariIds[1])).toEqual({ itemId: null, variantSku: "", qty: 1 });
    // Di toko lamanya, catatan itu miliknya — hanya di sana ia bisa diminta.
    expect([...(await barangDicariUntukMinta(spgA, tokoB, dicariIds)).keys()]).toEqual([dicariIds[3]]);
  });

  it("no ids → no query, empty", async () => {
    expect((await barangTitipMenunggu(tokoA, [])).size).toBe(0);
    expect((await barangDicariUntukMinta(spgA, tokoA, [])).size).toBe(0);
  });
});
