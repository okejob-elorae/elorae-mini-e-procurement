import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { daftarProdukSpg, infoProdukSpg } from "./produk-queries";

/*
 * Info produk di HP SPG terhadap basis data sungguhan: harga eceran, bahan &
 * cara rawat, tabel ukuran bawaan kategori, stok toko ini per varian, toko SPG
 * lain yang punya stok, promo konter barang itu — dan payload yang sampai ke
 * HP TIDAK membawa angka gudang (hanya keterangannya) maupun rupiah lain.
 * Jangan pernah dijalankan ke basis data produksi.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("infoProdukSpg / daftarProdukSpg (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const sekarang = new Date();
  const HARI = 86_400_000;
  /** Angka gudang yang khas — tidak boleh muncul di mana pun di payload HP. */
  const GUDANG_RAHASIA = 7777;
  const HPP_RAHASIA = 4321;

  let uomId = "";
  let katId = "";
  let chartId = "";
  let chartBarangId = "";
  let itemId = "";
  let polosId = "";
  let matiDiBukuId = "";
  let matiId = "";
  let lainId = "";
  let tokoId = "";
  let tokoBaruId = "";
  let tokoSpgLainId = "";
  let tokoTanpaSpgId = "";
  let tokoMatiId = "";
  let userIds: string[] = [];
  let promoIds: string[] = [];

  const skuM = `TEST-PRD-${token}-M`;
  const skuL = `TEST-PRD-${token}-L`;

  beforeAll(async () => {
    uomId = "";
    katId = "";
    chartId = "";
    chartBarangId = "";
    itemId = "";
    polosId = "";
    matiDiBukuId = "";
    matiId = "";
    lainId = "";
    tokoId = "";
    tokoBaruId = "";
    tokoSpgLainId = "";
    tokoTanpaSpgId = "";
    tokoMatiId = "";
    userIds = [];
    promoIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PRD-${token}`, nameId: "t", nameEn: "t" } })).id;
    katId = (await prisma.itemCategory.create({ data: { name: `TEST-PRD-KAT-${token}` } })).id;
    chartId = (
      await prisma.sizeChart.create({
        data: {
          name: `Kaos ${token}`,
          categoryId: katId,
          columns: ["Lebar dada", "Panjang badan"],
          rows: [
            { ukuran: "M", nilai: [50, 70] },
            { ukuran: "L", nilai: [52.5, null] },
          ],
          note: "Ukur di permukaan datar.",
        },
      })
    ).id;
    chartBarangId = (
      await prisma.sizeChart.create({ data: { name: `Khusus ${token}`, unit: "inci", columns: ["Dada"], rows: [{ ukuran: "M", nilai: [20] }] } })
    ).id;

    itemId = (
      await prisma.item.create({
        data: {
          sku: `TEST-PRD-${token}`,
          nameId: `Kaos Uji ${token}`,
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          categoryId: katId,
          sellingPrice: 123_456,
          description: "Kaos harian.",
          material: "Katun combed 30s",
          careInstructions: "Cuci dingin\nJangan diputih",
          commissionPerPcs: 9_876,
          variants: [
            { sku: skuM, size: "M", color: "Hitam", barcode: `BC-${token}` },
            { sku: skuL, size: "L", color: "Hitam" },
          ],
          inventoryValues: {
            create: [
              { variantSku: skuM, qtyOnHand: GUDANG_RAHASIA, reservedQty: 0, avgCost: HPP_RAHASIA, totalValue: GUDANG_RAHASIA * HPP_RAHASIA },
              { variantSku: skuL, qtyOnHand: 4, reservedQty: 1, avgCost: HPP_RAHASIA },
            ],
          },
          images: {
            create: [
              { url: `https://img.test/${token}/varian-m.jpg`, variantSku: skuM, sortOrder: 0 },
              { url: `https://img.test/${token}/utama.jpg`, variantSku: null, sortOrder: 1 },
            ],
          },
        },
      })
    ).id;
    polosId = (
      await prisma.item.create({
        data: {
          sku: `TEST-PRD-P-${token}`,
          nameId: `Topi Uji ${token}`,
          nameEn: "Test cap",
          type: "FINISHED_GOOD",
          uomId,
          sizeChartId: chartBarangId,
          inventoryValues: { create: [{ variantSku: null, qtyOnHand: 0, reservedQty: 0 }] },
        },
      })
    ).id;
    matiDiBukuId = (
      await prisma.item.create({ data: { sku: `TEST-PRD-MB-${token}`, nameId: `Lama di rak ${token}`, nameEn: "x", type: "FINISHED_GOOD", uomId, isActive: false } })
    ).id;
    matiId = (
      await prisma.item.create({ data: { sku: `TEST-PRD-MT-${token}`, nameId: `Lama hilang ${token}`, nameEn: "x", type: "FINISHED_GOOD", uomId, isActive: false } })
    ).id;
    lainId = (
      await prisma.item.create({ data: { sku: `TEST-PRD-L-${token}`, nameId: `Lain ${token}`, nameEn: "x", type: "FINISHED_GOOD", uomId } })
    ).id;

    // Toko konsinyasi dengan markup sah (25%): harga di toko = 123.456 × 1,25 = 154.320.
    const toko = async (k: string, aktif = true) =>
      (
        await prisma.store.create({
          data: { code: `TEST-PRD-${k}-${token}`, name: `Toko ${k} ${token}`, address: "x", termsType: "KONSI", markupPercent: 25, isActive: aktif },
        })
      ).id;
    tokoId = await toko("SAYA");
    tokoBaruId = await toko("BARU");
    tokoSpgLainId = await toko("SPGLAIN");
    tokoTanpaSpgId = await toko("TANPASPG");
    tokoMatiId = await toko("MATI", false);

    const spg = async (k: string, storeId: string) =>
      (await prisma.user.create({ data: { email: `test-prd-${k}-${token}@example.com`, name: `SPG ${k}`, assignedStoreId: storeId } })).id;
    userIds.push(await spg("saya", tokoId), await spg("baru", tokoBaruId), await spg("lain", tokoSpgLainId), await spg("mati", tokoMatiId));
    const oleh = userIds[0];

    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: tokoId, itemId, variantSku: skuM, qty: 5, kind: "TERIMA", createdById: oleh },
        { storeId: tokoId, itemId, variantSku: skuM, qty: -3, kind: "JUAL", createdById: oleh },
        { storeId: tokoId, itemId: matiDiBukuId, variantSku: "", qty: 1, kind: "OPNAME", createdById: oleh },
        { storeId: tokoSpgLainId, itemId, variantSku: skuM, qty: 4, kind: "TERIMA", createdById: oleh },
        { storeId: tokoSpgLainId, itemId, variantSku: skuL, qty: 0, kind: "OPNAME", createdById: oleh },
        { storeId: tokoTanpaSpgId, itemId, variantSku: skuM, qty: 9, kind: "TERIMA", createdById: oleh },
        { storeId: tokoMatiId, itemId, variantSku: skuM, qty: 6, kind: "TERIMA", createdById: oleh },
      ],
    });

    const promo = async (name: string, data: Record<string, unknown>, targets: { kind: string; refId: string }[]) =>
      (
        await prisma.counterPromo.create({
          data: { name, type: "PERSEN", value: 20, createdById: oleh, ...data, targets: { create: targets } },
        })
      ).id;
    promoIds.push(
      await promo(`Promo kategori ${token}`, { allItems: false, endsAt: new Date(sekarang.getTime() + 5 * HARI) }, [{ kind: "CATEGORY", refId: katId }]),
      await promo(`Promo nanti ${token}`, { allItems: false, type: "POTONGAN", value: 10_000, startsAt: new Date(sekarang.getTime() + 3 * HARI) }, [
        { kind: "ITEM", refId: itemId },
      ]),
      await promo(`Promo barang lain ${token}`, { allItems: false }, [{ kind: "ITEM", refId: lainId }]),
      await promo(`Promo toko lain ${token}`, { allItems: false, allStores: false }, [
        { kind: "ITEM", refId: itemId },
        { kind: "STORE", refId: tokoSpgLainId },
      ]),
      await promo(`Promo selesai ${token}`, { allItems: false, endsAt: new Date(sekarang.getTime() - HARI) }, [{ kind: "ITEM", refId: itemId }]),
    );
  });

  afterAll(async () => {
    await prisma.counterPromo.deleteMany({ where: { id: { in: seededIds(promoIds) } } });
    await prisma.storeStockMovement.deleteMany({
      where: { storeId: { in: seededIds([tokoId, tokoBaruId, tokoSpgLainId, tokoTanpaSpgId, tokoMatiId]) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: seededIds(userIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoId, tokoBaruId, tokoSpgLainId, tokoTanpaSpgId, tokoMatiId]) } } });
    await prisma.itemImage.deleteMany({ where: { itemId: { in: seededIds([itemId, polosId, matiDiBukuId, matiId, lainId]) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([itemId, polosId, matiDiBukuId, matiId, lainId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([itemId, polosId, matiDiBukuId, matiId, lainId]) } } });
    await prisma.sizeChart.deleteMany({ where: { id: { in: seededIds([chartId, chartBarangId]) } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(katId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("shows retail price, material, care, description and the category's size chart", async () => {
    const p = await infoProdukSpg(itemId, tokoId, sekarang);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.harga).toBe(154_320);
    expect(p.bahan).toBe("Katun combed 30s");
    expect(p.caraRawat).toBe("Cuci dingin\nJangan diputih");
    expect(p.deskripsi).toBe("Kaos harian.");
    expect(p.kategori).toBe(`TEST-PRD-KAT-${token}`);
    expect(p.tabelUkuran).toEqual({
      nama: `Kaos ${token}`,
      satuan: "cm",
      kolom: ["Lebar dada", "Panjang badan"],
      baris: [
        { ukuran: "M", nilai: [50, 70] },
        { ukuran: "L", nilai: [52.5, null] },
      ],
      catatan: "Ukur di permukaan datar.",
      sumber: "KATEGORI",
    });
    // Foto barang dulu, lalu foto varian.
    expect(p.foto.map((f) => f.url)).toEqual([`https://img.test/${token}/utama.jpg`, `https://img.test/${token}/varian-m.jpg`]);
  });

  it("per variant: this store's book balance, a warehouse label only, and other SPG stores (active, with an SPG)", async () => {
    const p = await infoProdukSpg(itemId, tokoId, sekarang);
    if (!p) throw new Error("tidak ada");
    expect(p.bukuDimulai).toBe(true);
    expect(p.bervarian).toBe(true);
    const m = p.varian.find((v) => v.variantSku === skuM);
    const l = p.varian.find((v) => v.variantSku === skuL);
    expect(m).toMatchObject({ label: "M · Hitam", barcode: `BC-${token}`, stokToko: 2, gudang: "ADA" });
    expect(m?.tokoLain).toEqual([{ nama: `Toko SPGLAIN ${token}`, qty: 4 }]);
    expect(l).toMatchObject({ stokToko: 0, gudang: "SEDIKIT", tokoLain: [] });
  });

  it("a store whose stock book has not started shows no store stock at all", async () => {
    const p = await infoProdukSpg(itemId, tokoBaruId, sekarang);
    if (!p) throw new Error("tidak ada");
    expect(p.bukuDimulai).toBe(false);
    expect(p.varian.every((v) => v.stokToko === null)).toBe(true);
    // Toko sendiri tidak pernah tercantum sebagai "toko lain" — dari toko BARU, toko SAYA (2) muncul.
    expect(p.varian.find((v) => v.variantSku === skuM)?.tokoLain.map((x) => x.nama)).toEqual([
      `Toko SPGLAIN ${token}`,
      `Toko SAYA ${token}`,
    ]);
  });

  it("counter promos for this item at this store: running and upcoming, never ended / other items / other stores", async () => {
    const p = await infoProdukSpg(itemId, tokoId, sekarang);
    if (!p) throw new Error("tidak ada");
    const milikUji = p.promo.filter((x) => x.nama.endsWith(token));
    expect(milikUji.map((x) => [x.nama, x.berlaku, x.ringkas])).toEqual([
      [`Promo kategori ${token}`, true, "Diskon 20%"],
      [`Promo nanti ${token}`, false, "Potongan Rp10.000 per potong"],
    ]);
    expect(milikUji[0].sampaiLabel).not.toBeNull();
    expect(milikUji[1].mulaiLabel).not.toBeNull();
  });

  it("an item's own size chart wins over the category; a simple item is one row", async () => {
    const p = await infoProdukSpg(polosId, tokoId, sekarang);
    if (!p) throw new Error("tidak ada");
    expect(p.tabelUkuran).toMatchObject({ nama: `Khusus ${token}`, satuan: "inci", sumber: "BARANG" });
    expect(p.bervarian).toBe(false);
    expect(p.varian).toEqual([{ variantSku: "", label: "", barcode: null, stokToko: 0, gudang: "KOSONG", tokoLain: [] }]);
    expect(p.harga).toBeNull();
  });

  it("the payload that reaches the phone carries no warehouse figures, cost or commission", async () => {
    const p = await infoProdukSpg(itemId, tokoId, sekarang);
    const teks = JSON.stringify(p);
    for (const terlarang of [String(GUDANG_RAHASIA), String(HPP_RAHASIA), "9876", "qtyOnHand", "reservedQty", "avgCost", "totalValue", "commission"]) {
      expect(teks).not.toContain(terlarang);
    }
    // Pembanding: angkanya memang ada di basis data — kalau payload membawanya, tes ini menangkapnya.
    const iv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId, variantSku: skuM } });
    expect(Number(iv.qtyOnHand)).toBe(GUDANG_RAHASIA);
  });

  it("not a finished good or unknown id → null", async () => {
    expect(await infoProdukSpg(`tidak-ada-${token}`, tokoId, sekarang)).toBeNull();
  });

  it("the list: active goods plus inactive ones still in this store's book, with photo, price and codes", async () => {
    const daftar = await daftarProdukSpg(tokoId);
    const milik = new Map(daftar.map((x) => [x.itemId, x]));
    expect(milik.get(itemId)).toEqual({
      itemId,
      nama: `Kaos Uji ${token}`,
      sku: `TEST-PRD-${token}`,
      harga: 154_320,
      foto: `https://img.test/${token}/utama.jpg`,
      varian: [
        { variantSku: skuM, barcode: `BC-${token}` },
        { variantSku: skuL, barcode: null },
      ],
    });
    expect(milik.has(matiDiBukuId)).toBe(true);
    expect(milik.has(matiId)).toBe(false);
    // Toko lain: barang nonaktif di rak toko SAYA tidak ikut.
    expect((await daftarProdukSpg(tokoBaruId)).some((x) => x.itemId === matiDiBukuId)).toBe(false);
    const teks = JSON.stringify(daftar.filter((x) => x.nama.endsWith(token)));
    expect(teks).not.toContain(String(GUDANG_RAHASIA));
  });
});
