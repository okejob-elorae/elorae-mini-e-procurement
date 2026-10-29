import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { saranMintaToko, varianTersedia } from "./saran-minta-queries";

/*
 * Saran "yang perlu diminta" di formulir SPG, terhadap basis data sungguhan.
 * Yang dijaga: tiga sumbernya (laku di toko lain se-area, sering dikirim ke
 * toko ini, barang baru), saringan stok gudang, dan payload yang sampai ke HP
 * TIDAK membawa rupiah maupun nama toko lain.
 *
 * Area uji punya kode unik, jadi "toko lain se-area" hanya berisi toko uji.
 * Jangan pernah dijalankan ke basis data produksi (terowongan :3307 / host VPS).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

describe("varianTersedia", () => {
  const variants = [{ sku: "K-M" }, { sku: "K-L" }, { sku: "K-XL" }];
  it("lists sizes the warehouse can send (on hand − reserved > 0)", () => {
    expect(
      varianTersedia(variants, [
        { variantSku: "K-M", qtyOnHand: 5, reservedQty: 1 },
        { variantSku: "K-L", qtyOnHand: 2, reservedQty: 2 },
      ]),
    ).toEqual(["K-M"]);
  });
  it("a pooled row (no variant) makes every size available — the warehouse picks the size", () => {
    expect(varianTersedia(variants, [{ variantSku: null, qtyOnHand: 4, reservedQty: 0 }])).toEqual(["K-M", "K-L", "K-XL"]);
  });
  it("a simple product is one empty variant, or nothing when out of stock", () => {
    expect(varianTersedia(null, [{ variantSku: null, qtyOnHand: 3, reservedQty: 0 }])).toEqual([""]);
    expect(varianTersedia(null, [{ variantSku: "", qtyOnHand: 1, reservedQty: 1 }])).toEqual([]);
  });
});

d("saranMintaToko — kueri (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const HARI = 86_400_000;
  const sekarang = new Date();
  const lalu = (n: number) => new Date(sekarang.getTime() - n * HARI);
  const lama = new Date("2024-01-01T00:00:00Z");

  let uomId = "";
  let areaId = "";
  let salesId = "";
  let spgId = "";
  let tokoId = "";
  let peerId = "";
  let item: Record<string, string> = {};
  let saleIds: string[] = [];
  let orderIds: string[] = [];
  let kirimId = "";

  beforeAll(async () => {
    uomId = "";
    areaId = "";
    salesId = "";
    spgId = "";
    tokoId = "";
    peerId = "";
    item = {};
    saleIds = [];
    orderIds = [];
    kirimId = "";

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-SMQ-${token}`, nameId: "t", nameEn: "t" } })).id;
    // L laku di toko lain (bervarian, hanya M yang ada di gudang) · H laku di toko lain tapi gudang habis
    // S sering dikirim & tipis · N baru, belum pernah ada · B laku di toko lain tapi masih banyak di rak
    const buat = async (k: string, stok: { variantSku: string | null; qtyOnHand: number }[], opsi: { variants?: unknown; baru?: boolean } = {}) =>
      (
        await prisma.item.create({
          data: {
            sku: `TEST-SMQ-${k}-${token}`,
            nameId: `Barang ${k}`,
            nameEn: `Item ${k}`,
            type: "FINISHED_GOOD",
            uomId,
            createdAt: opsi.baru ? new Date() : lama,
            sellingPrice: 345_678,
            ...(opsi.variants ? { variants: opsi.variants } : {}),
            inventoryValues: { create: stok },
          },
        })
      ).id;
    item.L = await buat(
      "L",
      [
        { variantSku: `TEST-SMQ-L-${token}-M`, qtyOnHand: 5 },
        { variantSku: `TEST-SMQ-L-${token}-L`, qtyOnHand: 0 },
      ],
      { variants: [{ sku: `TEST-SMQ-L-${token}-M`, size: "M" }, { sku: `TEST-SMQ-L-${token}-L`, size: "L" }] },
    );
    item.H = await buat("H", [{ variantSku: null, qtyOnHand: 0 }]);
    item.S = await buat("S", [{ variantSku: null, qtyOnHand: 10 }]);
    item.N = await buat("N", [{ variantSku: null, qtyOnHand: 3 }], { baru: true });
    item.B = await buat("B", [{ variantSku: null, qtyOnHand: 10 }]);

    salesId = (await prisma.user.create({ data: { email: `test-smq-s-${token}@example.com`, name: "Sales SMQ" } })).id;
    spgId = (await prisma.user.create({ data: { email: `test-smq-spg-${token}@example.com`, name: "SPG SMQ" } })).id;
    areaId = (await prisma.storeGroup.create({ data: { code: `TSMQ-${token}`, name: "Area SMQ" } })).id;
    tokoId = (
      await prisma.store.create({ data: { code: `TEST-SMQ-T-${token}`, name: "Toko SMQ", address: "x", termsType: "KONSI", groupId: areaId, salesmanId: salesId } })
    ).id;
    peerId = (
      await prisma.store.create({ data: { code: `TEST-SMQ-P-${token}`, name: "Toko Pembanding Rahasia", address: "x", termsType: "KONSI", groupId: areaId } })
    ).id;

    // Toko pembanding: penjualan SPG L 10, H 20, B 8 dalam 90 hari.
    const s = await prisma.spgSale.create({
      data: {
        docNo: `TEST-SMQ-${token}`,
        salesmanId: spgId,
        createdById: spgId,
        storeId: peerId,
        subtotal: 765_432,
        total: 765_432,
        cashReceived: 765_432,
        changeGiven: 0,
        createdAt: lalu(5),
        lines: {
          create: [
            { itemId: item.L, variantSku: `TEST-SMQ-L-${token}-M`, productName: "L", qty: 10, unitPrice: 76_543, lineTotal: 765_430 },
            { itemId: item.H, variantSku: "", productName: "H", qty: 20, unitPrice: 1, lineTotal: 20 },
            { itemId: item.B, variantSku: "", productName: "B", qty: 8, unitPrice: 1, lineTotal: 8 },
          ],
        },
      },
    });
    saleIds.push(s.id);

    // Toko ini: S dikirim dua kali (pesanan konsi disetujui + kiriman modul konsinyasi), sekarang sisa 1.
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-SMQ-${token}`,
        storeId: tokoId,
        salesmanId: salesId,
        status: "APPROVED",
        orderType: "KONSI",
        subtotal: 0,
        total: 0,
        approvedAt: lalu(40),
        createdAt: lalu(41),
        lines: { create: [{ itemId: item.S, productName: "S", qty: 6, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    orderIds.push(o.id);
    kirimId = (
      await prisma.consignmentShipment.create({
        data: {
          noKirim: `TEST-SMQ-KRM-${token}`,
          storeId: tokoId,
          shippedAt: lalu(10),
          items: { create: [{ itemId: item.S, itemName: "S", qty: 6, price: 0, amount: 0 }] },
        },
      })
    ).id;
    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: tokoId, itemId: item.S, variantSku: "", qty: 12, kind: "TERIMA", createdById: spgId, createdAt: lalu(9) },
        { storeId: tokoId, itemId: item.S, variantSku: "", qty: -11, kind: "JUAL", createdById: spgId, createdAt: lalu(2) },
        { storeId: tokoId, itemId: item.B, variantSku: "", qty: 9, kind: "TERIMA", createdById: spgId, createdAt: lalu(9) },
      ],
    });
  });

  afterAll(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds([tokoId]) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: seededId(kirimId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(saleIds) } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(saleIds) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoId, peerId]) } } });
    await prisma.storeGroup.deleteMany({ where: { id: seededId(areaId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId, spgId]) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(Object.values(item)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(Object.values(item)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("builds the three groups from this store's history, its area, and new products", async () => {
    const h = await saranMintaToko(tokoId, sekarang);
    expect(h).not.toBeNull();
    expect(h!.pembanding).toBe("AREA");
    expect(h!.tanpaBuku).toBe(false);

    const sering = h!.kelompok.SERING_DIKIRIM;
    expect(sering.map((x) => x.itemId)).toEqual([item.S]);
    expect(sering[0]).toMatchObject({ alasan: "SERING_DIKIRIM", kali: 2, pcs: 12, sisa: 1, varian: [""], nama: "Barang S" });

    // L laku 10 di satu toko lain dan belum ada di sini; hanya ukuran M yang ada di gudang.
    // H gudang habis; B masih 9 di rak.
    const laris = h!.kelompok.LAKU_DI_TOKO_LAIN;
    expect(laris.map((x) => x.itemId)).toEqual([item.L]);
    expect(laris[0]).toMatchObject({ pcs: 10, toko: 1, sisa: 0, varian: [`TEST-SMQ-L-${token}-M`] });

    // Barang baru di basis data dev bisa banyak; yang dijaga: N ada (kecuali daftar sudah penuh oleh barang
    // yang sama barunya), dan tidak ada barang yang pernah ada di toko ini.
    const baru = h!.kelompok.BARANG_BARU.map((x) => x.itemId);
    if (baru.length < 10) expect(baru).toContain(item.N);
    for (const k of ["S", "B", "L", "H"]) expect(baru).not.toContain(item[k]);
  });

  it("the payload reaching the phone carries no rupiah and no other store's name", async () => {
    const teks = JSON.stringify(await saranMintaToko(tokoId, sekarang));
    expect(teks).not.toMatch(/345678|765432|76543|price|harga|"nilai"|Rp/i);
    expect(teks).not.toContain("Toko Pembanding Rahasia");
    expect(teks).not.toContain(peerId);
  });

  it("a store that does not exist has no suggestions", async () => {
    expect(await saranMintaToko("tidak-ada", sekarang)).toBeNull();
  });
});
