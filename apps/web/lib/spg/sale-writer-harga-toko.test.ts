import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bagianEloraeSen } from "@/lib/konsinyasi/promo-elorae";
import { hitungPromoKonter } from "./promo-konter";
import { promoKonterUntukToko } from "./promo-konter-queries";
import { daftarProdukSpg, infoProdukSpg } from "./produk-queries";
import { getSellableCatalogForSpg } from "./sale-queries";
import { recordSpgSale } from "./sale-writer";

/**
 * Kasir SPG mencatat HARGA DI TOKO (keputusan pemilik 2026-10-04): di toko
 * konsinyasi pembeli membayar harga jual Elorae yang dinaikkan dengan margin
 * toko (`computeStorePrice` KONSI), bukan harga putus. Basis data sungguhan.
 *
 * Promo uji HANYA untuk toko uji (`allStores: false`). Pengaturan diskon
 * manual tidak disentuh — tidak ada diskon manual di sini.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("recordSpgSale: harga di toko konsinyasi (test bed only)", () => {
  const tag = `SPGHT-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let salesmanId = "";
  let konsiId = "";
  let konsiTanpaMarginId = "";
  let putusId = "";
  let promoIds: string[] = [];

  const semuaToko = () => [konsiId, konsiTanpaMarginId, putusId].filter(Boolean).map(seededId);

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    konsiId = "";
    konsiTanpaMarginId = "";
    putusId = "";
    promoIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kemeja Uji", nameEn: "Test Shirt", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 75_000 },
      })
    ).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    konsiId = (
      await prisma.store.create({
        data: { code: `${tag}-K`, name: "Toko Konsi Uji", address: "Jl. Uji", termsType: "KONSI", marginPercent: 25, isActive: true },
      })
    ).id;
    konsiTanpaMarginId = (
      await prisma.store.create({
        data: { code: `${tag}-KN`, name: "Toko Konsi Tanpa Margin", address: "Jl. Uji", termsType: "KONSI", isActive: true },
      })
    ).id;
    putusId = (
      await prisma.store.create({
        data: { code: `${tag}-P`, name: "Toko Putus Uji", address: "Jl. Uji", termsType: "PUTUS", marginPercent: 25, isActive: true },
      })
    ).id;
  });

  afterEach(async () => {
    if (promoIds.length) {
      await prisma.counterPromoTarget.deleteMany({ where: { promoId: { in: seededIds(promoIds) } } });
      await prisma.counterPromo.deleteMany({ where: { id: { in: seededIds(promoIds) } } });
    }
    if (itemId) {
      await prisma.storeStockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.spgSaleLine.deleteMany({ where: { itemId: seededId(itemId) } });
    }
    if (semuaToko().length) await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { storeId: { in: semuaToko() } }, select: { id: true } })).map((x) => x.id) } } });
    if (semuaToko().length) await prisma.spgSale.deleteMany({ where: { storeId: { in: semuaToko() } } });
    if (itemId) await prisma.item.delete({ where: { id: seededId(itemId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (semuaToko().length) await prisma.store.deleteMany({ where: { id: { in: semuaToko() } } });
  });

  async function promoPersen(storeId: string, persen: number, bagianToko: number) {
    const p = await prisma.counterPromo.create({
      data: {
        name: `Diskon ${persen}% ${tag}`,
        type: "PERSEN",
        value: persen,
        allItems: true,
        allStores: false,
        storeSharePercent: bagianToko,
        createdById: salesmanId,
        targets: { create: [{ kind: "STORE", refId: storeId }] },
      },
    });
    promoIds.push(p.id);
    return p;
  }

  async function notaDan(spgSaleId: string) {
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: spgSaleId }, include: { lines: true } });
    return { nota, baris: nota.lines[0] };
  }

  it("toko konsi margin 25%: barang 75.000 dicatat 100.000 — harga satuan, baris, nota, dan riwayat penjualan", async () => {
    const res = await recordSpgSale({ salesmanId, storeId: konsiId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    if (!res.ok) throw new Error(`nota gagal: ${res.code}`);
    expect(res.total).toBe(100_000);

    const { nota, baris } = await notaDan(res.spgSaleId);
    expect(Number(baris.unitPrice)).toBe(100_000);
    expect(Number(baris.lineTotal)).toBe(100_000);
    expect(Number(nota.subtotal)).toBe(100_000);
    expect(Number(nota.total)).toBe(100_000);
    expect(Number(nota.cashReceived)).toBe(100_000);
    expect(Number(nota.changeGiven)).toBe(0);

    const riwayat = await prisma.salesHistory.findFirstOrThrow({ where: { itemId: seededId(itemId), orderId: res.docNo } });
    expect(Number(riwayat.unitPrice)).toBe(100_000);
    expect(Number(riwayat.lineTotal)).toBe(100_000);
  });

  it("toko konsi, 3 potong: 3 × 100.000 = 300.000; uang 300.000 tanpa kembalian (bukan 225.000)", async () => {
    const res = await recordSpgSale({ salesmanId, storeId: konsiId, lines: [{ itemId, variantSku: null, qty: 3 }], cashReceived: 300_000 });
    if (!res.ok) throw new Error(`nota gagal: ${res.code}`);
    expect(res.total).toBe(300_000);
    expect(res.changeGiven).toBe(0);
  });

  it("toko putus tetap harga jual Elorae 75.000 — margin toko diabaikan", async () => {
    const res = await recordSpgSale({ salesmanId, storeId: putusId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    if (!res.ok) throw new Error(`nota gagal: ${res.code}`);
    const { nota, baris } = await notaDan(res.spgSaleId);
    expect(Number(baris.unitPrice)).toBe(75_000);
    expect(Number(nota.total)).toBe(75_000);
  });

  it("toko konsi tanpa margin sah: harga jual apa adanya (75.000), sama dengan computeStorePrice", async () => {
    const res = await recordSpgSale({ salesmanId, storeId: konsiTanpaMarginId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    if (!res.ok) throw new Error(`nota gagal: ${res.code}`);
    const { baris } = await notaDan(res.spgSaleId);
    expect(Number(baris.unitPrice)).toBe(75_000);
  });

  it("promo 10% di toko konsi dihitung dari harga di toko: 100.000 → 90.000; bagian toko 50% = 5.000, bagian Elorae 5.000", async () => {
    await promoPersen(konsiId, 10, 50);
    const res = await recordSpgSale({ salesmanId, storeId: konsiId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    if (!res.ok) throw new Error(`nota gagal: ${res.code}`);
    expect(res.total).toBe(90_000);

    const { nota, baris } = await notaDan(res.spgSaleId);
    expect(Number(baris.unitPrice)).toBe(100_000);
    expect(Number(baris.discount)).toBe(10_000);
    expect(Number(baris.lineTotal)).toBe(90_000);
    expect(Number(baris.storeDiscount)).toBe(5_000);
    expect(Number(nota.subtotal)).toBe(100_000);
    expect(Number(nota.discountTotal)).toBe(10_000);
    expect(Number(nota.total)).toBe(90_000);
    // Potongan yang mengurangi tagihan konsinyasi ke toko (lib/konsinyasi/promo-elorae).
    expect(bagianEloraeSen({ discount: Number(baris.discount), storeDiscount: Number(baris.storeDiscount) })).toBe(500_000);
  });

  it("katalog HP memakai harga yang sama dengan penulis: konsi 100.000, putus 75.000, tanpa toko 75.000", async () => {
    const harga = async (storeId?: string) => (await getSellableCatalogForSpg(storeId)).find((r) => r.itemId === itemId)?.price;
    expect(await harga(konsiId)).toBe(100_000);
    expect(await harga(putusId)).toBe(75_000);
    expect(await harga(konsiTanpaMarginId)).toBe(75_000);
    expect(await harga()).toBe(75_000);
  });

  it("info produk di HP SPG menyebut harga yang sama dengan kasir: konsi 100.000, putus 75.000", async () => {
    const sekarang = new Date();
    expect((await infoProdukSpg(itemId, konsiId, sekarang))?.harga).toBe(100_000);
    expect((await infoProdukSpg(itemId, putusId, sekarang))?.harga).toBe(75_000);
    expect((await daftarProdukSpg(konsiId)).find((p) => p.itemId === itemId)?.harga).toBe(100_000);
    expect((await daftarProdukSpg(putusId)).find((p) => p.itemId === itemId)?.harga).toBe(75_000);
  });

  it("pratinjau HP (katalog + promo + mesin yang sama) = nota tercatat di toko konsi: 2 potong diskon 10% = 180.000", async () => {
    await promoPersen(konsiId, 10, 0);
    const baris = (await getSellableCatalogForSpg(konsiId)).find((r) => r.itemId === itemId)!;
    const promos = await promoKonterUntukToko(konsiId, new Date());
    const pratinjau = hitungPromoKonter({
      baris: [{ key: "k", itemId, categoryId: baris.categoryId, qty: 2, unitPrice: baris.price ?? 0 }],
      promos,
      storeId: konsiId,
      waktu: new Date(),
    });
    if (!pratinjau.ok) throw new Error("pratinjau gagal");
    expect(pratinjau.total).toBe(180_000);

    const res = await recordSpgSale({ salesmanId, storeId: konsiId, lines: [{ itemId, variantSku: null, qty: 2 }] });
    if (!res.ok) throw new Error(`nota gagal: ${res.code}`);
    expect(res.total).toBe(pratinjau.total);
  });
});
