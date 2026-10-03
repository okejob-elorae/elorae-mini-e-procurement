import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { kunciLabel } from "./label";
import { barangUntukLabel, cariBarangLabel, isiLabelDariDokumen } from "./label-queries";

/*
 * Kueri layar label barcode terhadap basis data sungguhan: varian yang
 * tersimpan sebagai TEKS JSON berkunci huruf besar, stok gudang per varian +
 * baris gabungan tanpa ukuran, pencarian, dan isian dari tiga jenis dokumen
 * kiriman. Hanya membaca — tapi fixture-nya menulis, jadi jangan pernah ke
 * basis data produksi.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("label barcode — kueri (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const skuKaos = `TEST-LBL-${token}`;
  let uomId = "";
  let kaosId = "";
  let topiId = "";
  let matiId = "";
  let kainId = "";
  let tokoAId = "";
  let tokoBId = "";
  let userId = "";
  let orderId = "";
  let deliveryId = "";
  let transferId = "";
  let shipmentId = "";

  beforeAll(async () => {
    uomId = "";
    kaosId = "";
    topiId = "";
    matiId = "";
    kainId = "";
    tokoAId = "";
    tokoBId = "";
    userId = "";
    orderId = "";
    deliveryId = "";
    transferId = "";
    shipmentId = "";

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-LBL-${token}`, nameId: "t", nameEn: "t" } })).id;
    // Varian sebagai TEKS JSON dengan kunci huruf besar — bentuk data lama yang nyata.
    kaosId = (
      await prisma.item.create({
        data: {
          sku: skuKaos,
          nameId: `Kaos Label ${token}`,
          nameEn: "Label tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: 129000,
          variants: JSON.stringify([
            { Size: "M", Color: "Hitam", SKU: `${skuKaos}-HTM-M`, Barcode: `TS${token}M` },
            { Size: "XL", Color: "Hitam", sku: `${skuKaos}-HTM-XL` },
          ]),
        },
      })
    ).id;
    topiId = (
      await prisma.item.create({
        data: { sku: `TEST-LBL-TOPI-${token}`, nameId: `Topi Label ${token}`, nameEn: "Label cap", type: "FINISHED_GOOD", uomId },
      })
    ).id;
    matiId = (
      await prisma.item.create({
        data: { sku: `TEST-LBL-MATI-${token}`, nameId: `Mati Label ${token}`, nameEn: "x", type: "FINISHED_GOOD", uomId, isActive: false },
      })
    ).id;
    kainId = (
      await prisma.item.create({
        data: { sku: `TEST-LBL-KAIN-${token}`, nameId: `Kain Label ${token}`, nameEn: "x", type: "FABRIC", uomId },
      })
    ).id;

    await prisma.inventoryValue.createMany({
      data: [
        { itemId: kaosId, variantSku: `${skuKaos}-htm-m`, qtyOnHand: 12, reservedQty: 3 },
        { itemId: kaosId, variantSku: `${skuKaos}-HTM-XL`, qtyOnHand: 4.5 },
        { itemId: kaosId, variantSku: null, qtyOnHand: 7 },
        { itemId: topiId, variantSku: "", qtyOnHand: 9 },
      ],
    });

    tokoAId = (
      await prisma.store.create({ data: { code: `TEST-LBL-A-${token}`, name: `Toko A ${token}`, address: "x", termsType: "PUTUS" } })
    ).id;
    tokoBId = (
      await prisma.store.create({ data: { code: `TEST-LBL-B-${token}`, name: `Toko B ${token}`, address: "x", termsType: "KONSI" } })
    ).id;
    userId = (await prisma.user.create({ data: { email: `test-lbl-${token}@example.com`, name: "Uji label" } })).id;

    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-LBL-${token}`,
        storeId: tokoAId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 0,
        total: 0,
        lines: {
          create: [
            { itemId: kaosId, variantSku: `${skuKaos}-HTM-M`, productName: "Kaos", qty: 5, unitPrice: 0, lineTotal: 0 },
            { itemId: topiId, variantSku: "", productName: "Topi", qty: 2, unitPrice: 0, lineTotal: 0 },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    const garis = (itemId: string) => order.lines.find((l) => l.itemId === itemId)!.id;
    deliveryId = (
      await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `DLV/TEST-LBL-${token}`,
          orderId,
          deliveredAt: new Date(),
          deliveredById: userId,
          invoiceDate: new Date(),
          dueDate: new Date(),
          subtotal: 0,
          total: 0,
          lines: {
            create: [
              { orderLineId: garis(kaosId), itemId: kaosId, variantSku: `${skuKaos}-HTM-M`, productName: "Kaos", qty: 3 },
              { orderLineId: garis(topiId), itemId: topiId, variantSku: "", productName: "Topi", qty: 2 },
            ],
          },
        },
      })
    ).id;

    transferId = (
      await prisma.storeTransfer.create({
        data: {
          docNo: `MTS/TEST-LBL-${token}`,
          fromStoreId: tokoAId,
          toStoreId: tokoBId,
          reason: "uji",
          createdById: userId,
          idempotencyKey: `test-lbl-${token}`,
          lines: {
            create: [
              { itemId: kaosId, variantSku: `${skuKaos}-HTM-XL`, productName: "Kaos", qty: 4 },
              { itemId: kaosId, variantSku: `${skuKaos}-HTM-L`, productName: "Kaos", qty: 1 },
            ],
          },
        },
      })
    ).id;

    shipmentId = (
      await prisma.consignmentShipment.create({
        data: {
          noKirim: `KNS-TEST-LBL-${token}`,
          storeId: tokoBId,
          shippedAt: new Date(),
          items: {
            create: [
              { itemId: kaosId, itemName: "Kaos titip", qty: 6, price: 0, amount: 0 },
              { itemId: topiId, itemName: "Topi titip", qty: 3, price: 0, amount: 0 },
              { itemId: null, itemName: "Gelang diketik", qty: 2, price: 0, amount: 0 },
            ],
          },
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: seededId(shipmentId) } });
    await prisma.consignmentShipment.deleteMany({ where: { id: seededId(shipmentId) } });
    await prisma.storeTransferLine.deleteMany({ where: { transferId: seededId(transferId) } });
    await prisma.storeTransfer.deleteMany({ where: { id: seededId(transferId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: seededId(deliveryId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    for (const id of [kaosId, topiId, matiId, kainId]) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(id) } });
      await prisma.item.deleteMany({ where: { id: seededId(id) } });
    }
    await prisma.store.deleteMany({ where: { id: seededId(tokoAId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoBId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("barangUntukLabel membaca varian teks JSON, stok gudang per varian, dan baris tanpa ukuran", async () => {
    const hasil = await barangUntukLabel([topiId, "tidak-ada", kaosId, topiId]);
    expect(hasil.map((b) => b.itemId)).toEqual([topiId, kaosId]);

    const [topi, kaos] = hasil;
    expect(topi).toMatchObject({ sku: `TEST-LBL-TOPI-${token}`, harga: null, aktif: true, bervarian: false, stokTanpaUkuran: 0 });
    expect(topi.varian).toEqual([{ variantSku: "", ukuran: null, warna: null, barcode: null, stokGudang: 9 }]);

    expect(kaos).toMatchObject({ nama: `Kaos Label ${token}`, sku: skuKaos, harga: 129000, bervarian: true, stokTanpaUkuran: 7 });
    expect(kaos.varian).toEqual([
      // Stok fisik (qtyOnHand), bukan tersedia; variantSku dicocokkan tanpa beda huruf besar.
      { variantSku: `${skuKaos}-HTM-M`, ukuran: "M", warna: "Hitam", barcode: `TS${token}M`, stokGudang: 12 },
      { variantSku: `${skuKaos}-HTM-XL`, ukuran: "XL", warna: "Hitam", barcode: null, stokGudang: 4.5 },
    ]);
  });

  it("cariBarangLabel: nama/SKU tanpa beda huruf besar, SKU varian lewat induknya; hanya barang jadi aktif", async () => {
    const lewatNama = await cariBarangLabel(`label ${token}`);
    expect(lewatNama.map((h) => h.itemId).sort()).toEqual([kaosId, topiId].sort());
    expect(lewatNama.find((h) => h.itemId === kaosId)).toEqual({ itemId: kaosId, nama: `Kaos Label ${token}`, sku: skuKaos, jumlahVarian: 2, harga: 129000 });

    expect((await cariBarangLabel(skuKaos.toLowerCase())).map((h) => h.itemId)).toEqual([kaosId]);
    expect((await cariBarangLabel(`${skuKaos}-HTM-XL`)).map((h) => h.itemId)).toEqual([kaosId]);
    expect(await cariBarangLabel("x")).toEqual([]);
    expect(await cariBarangLabel(`mati label ${token}`)).toEqual([]);
    expect(await cariBarangLabel(`kain label ${token}`)).toEqual([]);
  });

  it("dari pengiriman putus: jumlah label = jumlah terkirim per varian", async () => {
    const h = await isiLabelDariDokumen({ jenis: "pengiriman", id: deliveryId });
    expect(h).not.toBeNull();
    expect(h!.nomor).toBe(`DLV/TEST-LBL-${token}`);
    expect(h!.toko).toBe(`Toko A ${token}`);
    expect(h!.totalDokumen).toBe(5);
    expect(h!.barang.map((b) => b.itemId).sort()).toEqual([kaosId, topiId].sort());
    expect(h!.jumlah).toEqual({ [kunciLabel(kaosId, `${skuKaos}-HTM-M`)]: 3, [kunciLabel(topiId, "")]: 2 });
    expect(h!.tanpaUkuran).toEqual([]);
    expect(h!.dilewati).toEqual([]);
  });

  it("dari mutasi: varian yang tidak ada di master dilewati dengan alasannya", async () => {
    const h = await isiLabelDariDokumen({ jenis: "mutasi", id: transferId });
    expect(h!.nomor).toBe(`MTS/TEST-LBL-${token}`);
    expect(h!.toko).toBe(`Toko B ${token}`);
    expect(h!.jumlah).toEqual({ [kunciLabel(kaosId, `${skuKaos}-HTM-XL`)]: 4 });
    expect(h!.dilewati).toEqual([{ nama: `Kaos Label ${token}`, variantSku: `${skuKaos}-HTM-L`, qty: 1, alasan: "VARIAN_TIDAK_ADA" }]);
  });

  it("dari kiriman konsinyasi (tanpa ukuran): barang bervarian minta diisi per ukuran, nama diketik dilewati", async () => {
    const h = await isiLabelDariDokumen({ jenis: "konsi", id: shipmentId });
    expect(h!.nomor).toBe(`KNS-TEST-LBL-${token}`);
    expect(h!.totalDokumen).toBe(11);
    expect(h!.jumlah).toEqual({ [kunciLabel(topiId, "")]: 3 });
    expect(h!.tanpaUkuran).toEqual([{ itemId: kaosId, nama: `Kaos Label ${token}`, qty: 6 }]);
    expect(h!.dilewati).toEqual([{ nama: "Gelang diketik", variantSku: null, qty: 2, alasan: "TANPA_BARANG" }]);
  });

  it("dokumen yang tidak ada → null", async () => {
    for (const jenis of ["pengiriman", "mutasi", "konsi"] as const) {
      expect(await isiLabelDariDokumen({ jenis, id: `tidak-ada-${token}` })).toBeNull();
    }
  });
});
