import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { hitungTitipan, stokDiToko } from "./stok-di-toko";

/**
 * Titipan dikurangi barang yang meninggalkan toko tanpa terjual dan tanpa nota
 * retur: rusak kiriman yang DIHAPUSKAN gudang, dan barang hilang DI TOKO yang
 * sudah ditetapkan (sumber OPNAME/MANUAL; bukan kiriman/mutasi — barang itu
 * tidak pernah tiba).
 */

const SEKARANG = new Date("2026-10-03T05:00:00Z");
const hariLalu = (n: number) => new Date(SEKARANG.getTime() - n * 86_400_000);

describe("hitungTitipan — keluar per ukuran", () => {
  it("dikurangkan dari ukurannya sendiri kalau ukuran itu tercatat masuk — tanpa ditandai perkiraan", () => {
    const r = hitungTitipan({
      masuk: [
        { itemId: "A", variantSku: "A-S", qty: 6, tanggal: hariLalu(100) },
        { itemId: "A", variantSku: "A-M", qty: 4, tanggal: hariLalu(100) },
      ],
      terjual: [],
      retur: [],
      keluarUkuran: [
        { itemId: "A", variantSku: "A-M", qty: 3 },
        { itemId: "A", variantSku: "A-M", qty: 0 },
      ],
      sekarang: SEKARANG,
    });
    expect(r.find((b) => b.variantSku === "A-S")).toMatchObject({ qty: 6, perkiraan: false });
    expect(r.find((b) => b.variantSku === "A-M")).toMatchObject({ qty: 1, perkiraan: false });
  });

  it("ukuran yang tidak tercatat masuk (kiriman per barang): dikurangkan dari barangnya, total tetap tepat", () => {
    const r = hitungTitipan({
      masuk: [{ itemId: "A", variantSku: "", qty: 10, tanggal: hariLalu(100) }],
      terjual: [{ itemId: "A", qty: 2, tanggal: hariLalu(5) }],
      retur: [],
      keluarUkuran: [{ itemId: "A", variantSku: "A-M", qty: 3 }],
      sekarang: SEKARANG,
    });
    expect(r).toEqual([expect.objectContaining({ itemId: "A", variantSku: "", qty: 5, soldLast30: 2 })]);
  });

  it("tanpa keluar per ukuran hasilnya sama dengan sebelumnya", () => {
    const masuk = [{ itemId: "A", variantSku: "", qty: 10, tanggal: hariLalu(100) }];
    expect(hitungTitipan({ masuk, terjual: [], retur: [{ itemId: "A", qty: 1 }], sekarang: SEKARANG })).toEqual(
      hitungTitipan({ masuk, terjual: [], retur: [{ itemId: "A", qty: 1 }], keluarUkuran: [], sekarang: SEKARANG }),
    );
  });
});

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("stokDiToko TITIPAN — rusak dihapuskan & barang hilang (basis data)", () => {
  const tag = `SDTH-${Math.random().toString(36).slice(2, 8)}`;
  let tokoId = "";
  let barangId = "";
  let orangId = "";
  let kirimId = "";
  let uomId = "";
  let terimaId = "";
  let hilangIds: string[] = [];

  beforeEach(async () => {
    tokoId = "";
    barangId = "";
    orangId = "";
    kirimId = "";
    uomId = "";
    terimaId = "";
    hilangIds = [];
    tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "KONSI", isActive: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    barangId = (
      await prisma.item.create({ data: { sku: `${tag}-I`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId } })
    ).id;
    orangId = (await prisma.user.create({ data: { email: `${tag}@uji.local`.toLowerCase(), name: `${tag} SPG`, passwordHash: "x" } })).id;
    // Titipan: 10 potong dikirim.
    kirimId = (
      await prisma.consignmentShipment.create({
        data: {
          noKirim: `${tag}/KRM`,
          storeId: tokoId,
          shippedAt: hariLalu(60),
          items: { create: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 0, amount: 0 }] },
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(hilangIds) } } });
    if (terimaId) await prisma.storeReceipt.delete({ where: { id: seededId(terimaId) } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: seededId(kirimId) } });
    await prisma.consignmentShipment.deleteMany({ where: { id: seededId(kirimId) } });
    await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.user.deleteMany({ where: { id: seededId(orangId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function rusakKiriman(status: string, qtyDamaged: number) {
    terimaId = (
      await prisma.storeReceipt.create({
        data: {
          storeId: tokoId,
          sourceType: "KONSI_SHIPMENT",
          sourceId: kirimId,
          sourceDocNo: `${tag}/KRM`,
          receivedById: orangId,
          lines: {
            create: [
              {
                itemId: barangId,
                productName: `${tag} Blus`,
                qtySent: 10,
                qtyReceived: 10,
                qtyDamaged,
                damageNote: "sobek",
                damageStatus: status,
              },
            ],
          },
        },
      })
    ).id;
  }

  async function hilang(source: string, status: string, qty: number) {
    const h = await prisma.stockLoss.create({
      data: {
        storeId: tokoId,
        source,
        totalQty: qty,
        totalAmount: 0,
        valueBasis: "HARGA_ELORAE",
        status,
        createdById: orangId,
        lines: { create: [{ itemId: barangId, productName: `${tag} Blus`, qty, unitValue: 0, amount: 0 }] },
      },
    });
    hilangIds.push(h.id);
  }

  const qtyTitipan = async () => {
    const s = await stokDiToko(tokoId, SEKARANG);
    expect(s.source).toBe("TITIPAN");
    return s.baris.reduce((n, b) => n + b.qty, 0);
  };

  it("titipan berkurang tepat sebesar rusak DIHAPUSKAN + hilang OPNAME/MANUAL yang ditetapkan/selesai", async () => {
    expect(await qtyTitipan()).toBe(10);
    await rusakKiriman("DIHAPUSKAN", 2);
    expect(await qtyTitipan()).toBe(8);
    await hilang("OPNAME", "DITETAPKAN", 1);
    await hilang("MANUAL", "SELESAI", 3);
    expect(await qtyTitipan()).toBe(4);
  });

  it("tidak dikurangi: rusak yang belum diputuskan / layak jual / dikirim balik, hilang yang belum ditetapkan atau dibatalkan, dan hilang di jalan", async () => {
    await rusakKiriman("KEMBALI_GUDANG", 2);
    await hilang("OPNAME", "TERBUKA", 1);
    await hilang("MANUAL", "DIBATALKAN", 1);
    await hilang("KIRIMAN", "DITETAPKAN", 4);
    await hilang("MUTASI", "SELESAI", 4);
    expect(await qtyTitipan()).toBe(10);
  });
});
