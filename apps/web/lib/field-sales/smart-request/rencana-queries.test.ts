import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { dasarLakuToko, muatBahanRencana } from "./rencana-queries";

/*
 * Basis data sungguhan, dibatasi ke data seed tes ini. Pemuatnya hanya membaca;
 * pembanding "toko sejenis" diambil dari area tes sendiri (StoreGroup baru)
 * supaya penjualan toko sungguhan tidak ikut terhitung.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("muatBahanRencana (test bed only)", () => {
  const tag = `TEST-RK-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let categoryId = "";
  let groupId = "";
  let putusId = "";
  let konsiId = "";
  let peerId = "";
  let salesmanId = "";
  let itemA = "";
  let itemB = "";
  let itemC = "";
  let itemD = "";
  let orderIds: string[] = [];
  let vanSaleId = "";

  beforeEach(async () => {
    uomId = categoryId = groupId = putusId = konsiId = peerId = salesmanId = "";
    itemA = itemB = itemC = itemD = vanSaleId = "";
    orderIds = [];

    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" }, select: { id: true } });
    salesmanId = user!.id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    categoryId = (await prisma.itemCategory.create({ data: { code: `C-${tag}`, name: "Kategori uji", isActive: true } })).id;
    groupId = (await prisma.storeGroup.create({ data: { code: `G-${tag}`, name: "Area uji" } })).id;

    const barang = (huruf: string, extra: Record<string, unknown> = {}) =>
      prisma.item.create({
        data: {
          sku: `${tag}-${huruf}`,
          nameId: `Kaos ${huruf}`,
          nameEn: huruf,
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          categoryId,
          sellingPrice: 40000,
          ...extra,
        },
      });
    // Varian sebagai TEKS JSON dengan kunci huruf besar — bentuk data lama yang masih ada.
    itemA = (await barang("A", { variants: JSON.stringify([{ SKU: `${tag}-A-S`, Size: "S" }, { SKU: `${tag}-A-M`, Size: "M" }]) })).id;
    itemB = (await barang("B", { sellingPrice: null })).id;
    itemC = (await barang("C")).id;
    itemD = (await barang("D")).id;
    await prisma.inventoryValue.createMany({
      data: [
        { itemId: itemA, variantSku: `${tag}-A-S`, qtyOnHand: 10, reservedQty: 2 },
        { itemId: itemA, variantSku: `${tag}-A-M`, qtyOnHand: 5, reservedQty: 0 },
        { itemId: itemB, variantSku: null, qtyOnHand: 9, reservedQty: 0 },
        { itemId: itemB, variantSku: "", qtyOnHand: 4, reservedQty: 0 },
        { itemId: itemC, variantSku: null, qtyOnHand: 3, reservedQty: 0 },
      ],
    });

    const toko = (kode: string, termsType: "PUTUS" | "KONSI") =>
      prisma.store.create({ data: { code: `${kode}-${tag}`, name: kode, address: "-", termsType, isActive: true, groupId } });
    putusId = (await toko("P", "PUTUS")).id;
    konsiId = (await toko("K", "KONSI")).id;
    peerId = (await toko("L", "KONSI")).id;

    const pesanan = async (storeId: string, itemId: string, status: "APPROVED" | "REJECTED", orderType: "PUTUS" | "KONSI", qty: number) => {
      const o = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `${tag}/${Math.random().toString(36).slice(2, 8)}`,
          storeId,
          salesmanId,
          status,
          orderType,
          subtotal: 0,
          total: 0,
          approvedAt: status === "APPROVED" ? new Date() : null,
          lines: { create: [{ itemId, variantSku: "", productName: "uji", qty, unitPrice: 0, lineTotal: 0 }] },
        },
      });
      orderIds.push(o.id);
    };
    await pesanan(putusId, itemA, "APPROVED", "PUTUS", 10);
    await pesanan(putusId, itemC, "REJECTED", "PUTUS", 7);
    // Toko sejenis se-area menerima 8 pcs B (konsinyasi disetujui) — "laku di toko lain".
    await pesanan(peerId, itemB, "APPROVED", "KONSI", 8);

    vanSaleId = (
      await prisma.vanSale.create({
        data: {
          docNo: `VS-${tag}`,
          salesmanId,
          storeId: putusId,
          subtotal: 0,
          total: 0,
          amountPaid: 0,
          changeAmount: 0,
          lines: { create: [{ itemId: itemD, productName: "D", qty: 1, unitPrice: 0, unitCost: 0, lineTotal: 0 }] },
        },
      })
    ).id;

    // Toko konsinyasi berbuku: A diterima 10, laku 6 → sisa 4.
    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: konsiId, itemId: itemA, variantSku: `${tag}-A-M`, qty: 10, kind: "TERIMA", createdById: salesmanId },
        { storeId: konsiId, itemId: itemA, variantSku: `${tag}-A-M`, qty: -6, kind: "JUAL", createdById: salesmanId },
      ],
    });
  });

  afterEach(async () => {
    const tokoIds = [putusId, konsiId, peerId].filter(Boolean);
    const barangIds = [itemA, itemB, itemC, itemD].filter(Boolean);
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds(tokoIds) } } });
    if (vanSaleId) await prisma.vanSale.delete({ where: { id: seededId(vanSaleId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
    if (groupId) await prisma.storeGroup.delete({ where: { id: seededId(groupId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(barangIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(barangIds) } } });
    if (categoryId) await prisma.itemCategory.delete({ where: { id: seededId(categoryId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("putus store without a stock book: sent = any non-rejected order or van sale; history is the refill basis", async () => {
    expect(await dasarLakuToko(putusId, "PUTUS")).toBe("RIWAYAT_PESANAN");
    const { bahan, info, dasarLaku } = await muatBahanRencana({
      storeId: putusId,
      termsType: "PUTUS",
      marginPercent: null,
      kategoriIds: [categoryId],
      sumber: ["BELUM_DIKIRIM", "LAKU_DI_SINI", "LAKU_DI_TOKO_LAIN"],
      hariIni: new Date(),
    });
    expect(dasarLaku).toBe("RIWAYAT_PESANAN");
    expect(bahan.stokTokoDiketahui).toBe(false);
    expect(bahan.kandidat.map((k) => k.itemId).sort()).toEqual([itemA, itemB, itemC, itemD].sort());

    // A dipesan (disetujui), D dijual van; C hanya di pesanan DITOLAK → belum pernah.
    expect(bahan.pernahDikirim.has(itemA)).toBe(true);
    expect(bahan.pernahDikirim.has(itemD)).toBe(true);
    expect(bahan.pernahDikirim.has(itemB)).toBe(false);
    expect(bahan.pernahDikirim.has(itemC)).toBe(false);
    expect(bahan.dipesanToko.get(itemA)).toBe(10);

    const a = bahan.kandidat.find((k) => k.itemId === itemA)!;
    expect(a.variants).toEqual([
      { variantSku: `${tag}-A-S`, size: "S" },
      { variantSku: `${tag}-A-M`, size: "M" },
    ]);
    expect(a.available).toEqual({ [`${tag}-A-S`]: 8, [`${tag}-A-M`]: 5 });
    expect(a.harga).toBe(40000);
    // Baris null dan "" untuk barang yang sama dinilai dengan yang TERKECIL.
    const b = bahan.kandidat.find((k) => k.itemId === itemB)!;
    expect(b.available).toEqual({ "": 4 });
    expect(b.harga).toBeNull();

    // Toko sejenis se-area: hanya pcs dan jumlah toko.
    expect(bahan.jualTokoLain.get(itemB)).toEqual({ pcs: 8, toko: 1 });
    // Barang tanpa stok tidak punya umur (tidak ditawarkan sebagai barang baru).
    expect(bahan.umurHari.get(itemB)).toBe(0);
    expect(bahan.umurHari.has(itemD)).toBe(false);
    expect(info.get(itemA)?.nama).toBe("Kaos A");
  });

  it("consignment store with a stock book: stock and sales come from the book, and no price is ever computed", async () => {
    const { bahan, info, dasarLaku } = await muatBahanRencana({
      storeId: konsiId,
      termsType: "KONSI",
      marginPercent: 30,
      kategoriIds: [categoryId],
      sumber: ["LAKU_DI_SINI"],
      hariIni: new Date(),
    });
    expect(dasarLaku).toBe("BUKU_TOKO");
    expect(bahan.stokTokoDiketahui).toBe(true);
    expect(bahan.stokToko.get(itemA)).toEqual({ sisa: 4, dalamProses: 0, laku: 6 });
    // Ada di buku toko = pernah dikirim.
    expect(bahan.pernahDikirim.has(itemA)).toBe(true);
    expect(bahan.kandidat.every((k) => k.harga === null)).toBe(true);
    expect([...info.values()].every((i) => i.harga === null)).toBe(true);
    // Sumber "laku di toko lain" tidak dicentang: pembandingnya tidak dimuat.
    expect(bahan.jualTokoLain.size).toBe(0);
  });

  it("a consignment store without a book reads the consignment stock", async () => {
    expect(await dasarLakuToko(peerId, "KONSI")).toBe("TITIPAN");
    const { bahan } = await muatBahanRencana({
      storeId: peerId,
      termsType: "KONSI",
      marginPercent: null,
      kategoriIds: [categoryId],
      sumber: ["BELUM_DIKIRIM"],
      hariIni: new Date(),
    });
    expect(bahan.stokTokoDiketahui).toBe(true);
    expect(bahan.stokToko.get(itemB)?.sisa).toBe(8);
    expect(bahan.pernahDikirim.has(itemB)).toBe(true);
  });
});
