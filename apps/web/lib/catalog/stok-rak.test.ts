import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { listCatalogForPwa, saldoDariPeta, tempelStokRak, type CatalogItem } from "./queries";
import { katalogPortal } from "@/lib/field-sales/portal-writer";
import { ATURAN_PORTAL_BAWAAN } from "@/lib/field-sales/portal-toko-aturan";

/**
 * "Di rak: N" di katalog salesman — saldo buku stok toko (StoreStockMovement),
 * pcs saja. Toko tanpa buku tidak membawa apa-apa; portal toko tidak pernah.
 */

const barang = (over: Partial<CatalogItem> & Pick<CatalogItem, "itemId">): CatalogItem => ({
  sku: over.itemId,
  nameId: over.itemId,
  categoryId: null,
  categoryName: null,
  primaryImageUrl: null,
  available: 10,
  price: null,
  priceLabel: null,
  neverSent: false,
  minOrderQty: 6,
  variants: [],
  ...over,
});

describe("tempelStokRak", () => {
  const varianA = [
    { variantSku: "A-S", variantLabel: "S", available: 3 },
    { variantSku: "A-M", variantLabel: "M", available: 0 },
    { variantSku: "A-L", variantLabel: "L", available: 5 },
  ];
  const items = [barang({ itemId: "A", variants: varianA }), barang({ itemId: "B" }), barang({ itemId: "C" })];

  it("menjumlah saldo per barang dan menaruh saldo per varian; negatif apa adanya", () => {
    const hasil = tempelStokRak(items, [
      { itemId: "A", variantSku: "A-S", qty: 4 },
      { itemId: "A", variantSku: "A-M", qty: -1 },
      // baris gabungan (tanpa varian) pada barang bervarian ikut ke total barang
      { itemId: "A", variantSku: "", qty: 2 },
      { itemId: "B", variantSku: "", qty: 7 },
      // barang yang tidak ada di katalog diabaikan
      { itemId: "X", variantSku: "", qty: 3 },
    ]);
    const a = hasil.find((i) => i.itemId === "A")!;
    expect(a.diRak).toBe(5);
    expect(a.variants.map((v) => [v.variantSku, v.diRak])).toEqual([
      ["A-S", 4],
      ["A-M", -1],
      // varian tanpa baris buku di toko yang berbuku = 0 di rak
      ["A-L", 0],
    ]);
    expect(hasil.find((i) => i.itemId === "B")!.diRak).toBe(7);
    // barang yang tidak pernah bergerak di toko ini: tidak ada kuncinya sama sekali
    expect("diRak" in hasil.find((i) => i.itemId === "C")!).toBe(false);
    expect(hasil.map((i) => i.itemId)).toEqual(["A", "B", "C"]);
  });

  it("saldo yang habis tetap tampil sebagai 0", () => {
    const hasil = tempelStokRak(items, [
      { itemId: "B", variantSku: "", qty: 6 },
      { itemId: "B", variantSku: "", qty: -6 },
    ]);
    expect(hasil.find((i) => i.itemId === "B")!.diRak).toBe(0);
  });

  it("peta saldo pembaca buku (`itemId::variantSku`) diurai kembali utuh", () => {
    const peta = new Map([
      ["A::A-S", 4],
      ["B::", 7],
      ["A::X::Y", -1],
    ]);
    expect(saldoDariPeta(peta)).toEqual([
      { itemId: "A", variantSku: "A-S", qty: 4 },
      { itemId: "B", variantSku: "", qty: 7 },
      { itemId: "A", variantSku: "X::Y", qty: -1 },
    ]);
    expect(saldoDariPeta(new Map())).toEqual([]);
  });

  it("tanpa buku tidak menambah kunci apa pun dan tidak mengubah masukan", () => {
    const salinan = JSON.stringify(items);
    expect(JSON.stringify(tempelStokRak(items, []))).not.toContain("diRak");
    tempelStokRak(items, [{ itemId: "A", variantSku: "A-S", qty: 4 }]);
    expect(JSON.stringify(items)).toBe(salinan);
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listCatalogForPwa — stok rak (test bed only)", () => {
  const sku = `TEST-RAK-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let varianId = "";
  let polosId = "";
  let asingId = "";
  let konsiId = "";
  let putusBukuId = "";
  let putusKosongId = "";
  let userId = "";

  beforeEach(async () => {
    uomId = "";
    varianId = "";
    polosId = "";
    asingId = "";
    konsiId = "";
    putusBukuId = "";
    putusKosongId = "";
    userId = "";
    const user = await prisma.user.findFirst({ select: { id: true } });
    userId = user!.id;
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const varian = await prisma.item.create({
      data: {
        sku: `${sku}-V`,
        nameId: "Kaos Rak Varian",
        nameEn: "Kaos Rak Varian",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 50000,
        variants: [
          { Size: "S", sku: `${sku}-V-S` },
          { Size: "M", sku: `${sku}-V-M` },
        ],
      },
    });
    varianId = varian.id;
    await prisma.inventoryValue.createMany({
      data: [
        { itemId: varianId, variantSku: `${sku}-V-S`, qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 },
        { itemId: varianId, variantSku: `${sku}-V-M`, qtyOnHand: 8, reservedQty: 0, avgCost: 1000, totalValue: 8000 },
      ],
    });
    const polos = await prisma.item.create({
      data: { sku: `${sku}-P`, nameId: "Kaos Rak Polos", nameEn: "Kaos Rak Polos", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    polosId = polos.id;
    await prisma.inventoryValue.create({ data: { itemId: polosId, variantSku: "", qtyOnHand: 12, reservedQty: 0, avgCost: 1000, totalValue: 12000 } });
    const asing = await prisma.item.create({
      data: { sku: `${sku}-N`, nameId: "Kaos Rak Asing", nameEn: "Kaos Rak Asing", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 30000 },
    });
    asingId = asing.id;
    await prisma.inventoryValue.create({ data: { itemId: asingId, variantSku: "", qtyOnHand: 4, reservedQty: 0, avgCost: 1000, totalValue: 4000 } });

    const konsi = await prisma.store.create({
      data: { code: `K-${sku}`, name: "Toko Rak Konsi", address: "T", termsType: "KONSI", markupPercent: 25, isActive: true },
    });
    konsiId = konsi.id;
    const putusBuku = await prisma.store.create({ data: { code: `PB-${sku}`, name: "Toko Rak Putus", address: "T", termsType: "PUTUS", isActive: true } });
    putusBukuId = putusBuku.id;
    const putusKosong = await prisma.store.create({ data: { code: `PK-${sku}`, name: "Toko Tanpa Buku", address: "T", termsType: "PUTUS", isActive: true } });
    putusKosongId = putusKosong.id;

    const gerak = (storeId: string, itemId: string, variantSku: string, qty: number, kind: "TERIMA" | "JUAL") => ({
      storeId,
      itemId,
      variantSku,
      qty,
      kind,
      createdById: userId,
    });
    await prisma.storeStockMovement.createMany({
      data: [
        gerak(konsiId, varianId, `${sku}-V-S`, 6, "TERIMA"),
        gerak(konsiId, varianId, `${sku}-V-S`, -2, "JUAL"),
        gerak(konsiId, varianId, `${sku}-V-M`, 1, "TERIMA"),
        gerak(konsiId, varianId, `${sku}-V-M`, -3, "JUAL"),
        gerak(konsiId, polosId, "", 5, "TERIMA"),
        gerak(putusBukuId, polosId, "", 3, "TERIMA"),
      ],
    });
  });

  afterEach(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds([konsiId, putusBukuId, putusKosongId]) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([varianId, polosId, asingId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([varianId, polosId, asingId]) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([konsiId, putusBukuId, putusKosongId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("toko berbuku: saldo per barang dan per varian, negatif apa adanya, tanpa harga konsi", async () => {
    const payload = await listCatalogForPwa(konsiId, { stokRak: true });
    expect(payload).not.toBeNull();
    const byId = new Map(payload!.items.map((i) => [i.itemId, i]));
    const v = byId.get(varianId)!;
    expect(v.diRak).toBe(2); // (6 − 2) + (1 − 3)
    expect(v.variants.map((x) => [x.variantSku, x.diRak])).toEqual([
      [`${sku}-V-M`, -2],
      [`${sku}-V-S`, 4],
    ]);
    expect(byId.get(polosId)!.diRak).toBe(5);
    expect("diRak" in byId.get(asingId)!).toBe(false);
    // Konsinyasi: pcs boleh, harga tidak pernah ada di muatan.
    expect(v.price).toBeNull();
    expect(v.priceLabel).toBeNull();
  });

  it("toko tanpa buku tidak membawa kolom rak sama sekali", async () => {
    const payload = await listCatalogForPwa(putusKosongId, { stokRak: true });
    expect(payload).not.toBeNull();
    expect(payload!.items.some((i) => i.itemId === polosId)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("diRak");
  });

  it("tanpa permintaan stok rak (pemakai selain HP salesman) kolomnya tidak dihitung", async () => {
    const payload = await listCatalogForPwa(konsiId);
    expect(JSON.stringify(payload)).not.toContain("diRak");
  });

  it("portal toko tidak pernah membawa stok rak — konsinyasi maupun putus", async () => {
    for (const [id, termsType] of [
      [konsiId, "KONSI"],
      [putusBukuId, "PUTUS"],
    ] as const) {
      const kat = await katalogPortal({
        linkId: "uji-rak",
        toko: { id, name: "Toko Uji", termsType, salesmanId: userId, namaSalesman: null },
        aturan: ATURAN_PORTAL_BAWAAN,
      });
      expect(kat).not.toBeNull();
      expect(kat!.barang.some((b) => b.itemId === polosId)).toBe(true);
      expect(JSON.stringify(kat)).not.toContain("diRak");
    }
  });
});
