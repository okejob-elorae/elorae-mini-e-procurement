import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  akhirBulanWib,
  bagiSebanding,
  gabungBukuToko,
  hitungTitipan,
  labelVarian,
  nilaiStokToko,
  stokDiToko,
} from "./stok-di-toko";

const SEKARANG = new Date("2026-09-30T05:00:00Z");
const hariLalu = (n: number) => new Date(SEKARANG.getTime() - n * 86_400_000);

describe("bagiSebanding", () => {
  it("jumlah hasil selalu sama dengan total", () => {
    const r = bagiSebanding(7, [3, 3, 3]);
    expect(r.reduce((s, x) => s + x, 0)).toBe(7);
    expect(r).toEqual([3, 2, 2]);
  });
  it("sebanding bobot", () => {
    expect(bagiSebanding(10, [8, 2])).toEqual([8, 2]);
  });
  it("tanpa bobot positif, semua jatuh ke baris pertama", () => {
    expect(bagiSebanding(4, [0, 0])).toEqual([4, 0]);
  });
  it("nol tetap nol", () => {
    expect(bagiSebanding(0, [5, 5])).toEqual([0, 0]);
  });
});

describe("akhirBulanWib", () => {
  it("saat terakhir bulan menurut Jakarta", () => {
    expect(akhirBulanWib(2026, 8).toISOString()).toBe("2026-08-31T16:59:59.999Z");
    expect(akhirBulanWib(2026, 12).toISOString()).toBe("2026-12-31T16:59:59.999Z");
  });
});

describe("gabungBukuToko", () => {
  it("terjual = kebalikan gerakan JUAL; saldo minus dipertahankan", () => {
    const [b] = gabungBukuToko({
      saldo: [{ itemId: "A", variantSku: "A-M", qty: -2, pertama: hariLalu(90) }],
      jualTerakhir: [{ itemId: "A", variantSku: "A-M", terakhir: hariLalu(3) }],
      jual30: [{ itemId: "A", variantSku: "A-M", qty: -5 }],
      jual60: [{ itemId: "A", variantSku: "A-M", qty: -9 }],
    });
    expect(b).toMatchObject({ qty: -2, soldLast30: 5, soldLast60: 9, lastSaleAt: hariLalu(3), firstInAt: hariLalu(90), perkiraan: false });
  });
});

describe("hitungTitipan", () => {
  it("dikirim − terjual − diretur untuk barang tanpa varian", () => {
    const [b] = hitungTitipan({
      masuk: [
        { itemId: "A", variantSku: "", qty: 10, tanggal: hariLalu(100) },
        { itemId: "A", variantSku: "", qty: 5, tanggal: hariLalu(20) },
      ],
      terjual: [{ itemId: "A", qty: 6, tanggal: hariLalu(10) }],
      retur: [{ itemId: "A", qty: 1 }],
      sekarang: SEKARANG,
    });
    expect(b).toMatchObject({ qty: 8, soldLast30: 6, soldLast60: 6, lastSaleAt: hariLalu(10), firstInAt: hariLalu(100), perkiraan: false });
  });

  it("terjual per barang dibagi ke ukuran sebanding kiriman, ditandai perkiraan", () => {
    const r = hitungTitipan({
      masuk: [
        { itemId: "A", variantSku: "A-S", qty: 6, tanggal: hariLalu(100) },
        { itemId: "A", variantSku: "A-M", qty: 2, tanggal: hariLalu(100) },
      ],
      terjual: [{ itemId: "A", qty: 4, tanggal: hariLalu(45) }],
      retur: [],
      sekarang: SEKARANG,
    });
    const s = r.find((b) => b.variantSku === "A-S")!;
    const m = r.find((b) => b.variantSku === "A-M")!;
    expect(s.qty + m.qty).toBe(4);
    expect(s).toMatchObject({ qty: 3, soldLast30: 0, soldLast60: 3, perkiraan: true });
    expect(m).toMatchObject({ qty: 1, soldLast60: 1, perkiraan: true });
  });

  it("barang terjual tanpa pernah dikirim muncul sebagai sisa negatif", () => {
    const r = hitungTitipan({ masuk: [], terjual: [{ itemId: "B", qty: 3, tanggal: hariLalu(5) }], retur: [], sekarang: SEKARANG });
    expect(r).toEqual([expect.objectContaining({ itemId: "B", variantSku: "", qty: -3 })]);
  });
});

describe("labelVarian", () => {
  const variants = [{ sku: "A-HTM-M", color: "Hitam", size: "M" }, { sku: "A-X" }];
  it("warna · ukuran, jatuh ke SKU kalau tidak ada rinciannya", () => {
    expect(labelVarian(variants, "A-HTM-M")).toBe("Hitam · M");
    expect(labelVarian(variants, "A-X")).toBe("A-X");
    expect(labelVarian(variants, "")).toBeNull();
  });
});

/**
 * Terhadap basis data sungguhan: pilihan sumber dan penilaian lengkap.
 * Teardown lewat `seededId()` — id kosong tidak boleh melebar jadi hapus semua.
 */
describe("stokDiToko / nilaiStokToko (basis data)", () => {
  const tag = `SDT-${Math.random().toString(36).slice(2, 8)}`;
  let tokoId = "";
  let barangId = "";
  let orangId = "";
  let siklusId = "";
  let kirimId = "";
  let uomId = "";

  beforeEach(async () => {
    tokoId = "";
    barangId = "";
    orangId = "";
    siklusId = "";
    kirimId = "";
    uomId = "";
    const toko = await prisma.store.create({
      data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "KONSI", isActive: true },
    });
    tokoId = toko.id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = await prisma.item.create({
      data: { sku: `${tag}-I`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId },
    });
    barangId = barang.id;
    const orang = await prisma.user.create({ data: { email: `${tag}@uji.local`, name: `${tag} SPG`, passwordHash: "x" } });
    orangId = orang.id;
  });

  afterEach(async () => {
    await prisma.storeStockTarget.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
    await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: seededId(kirimId) } });
    await prisma.consignmentShipment.deleteMany({ where: { id: seededId(kirimId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(barangId) } });
    await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.user.deleteMany({ where: { id: seededId(orangId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function titipan() {
    const kirim = await prisma.consignmentShipment.create({
      data: {
        noKirim: `${tag}/KRM`,
        storeId: tokoId,
        shippedAt: hariLalu(120),
        items: { create: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 0, amount: 0 }] },
      },
    });
    kirimId = kirim.id;
    const siklus = await prisma.consignmentCycle.create({
      data: { noKonsi: `${tag}/K`, storeId: tokoId, periodYear: 2026, periodMonth: 8, lockedAt: new Date() },
    });
    siklusId = siklus.id;
    await prisma.consignmentSold.create({
      data: { cycleId: siklusId, itemId: barangId, itemName: `${tag} Blus`, qty: 4, price: 0, amount: 0 },
    });
  }

  it("tanpa gerakan buku: dihitung dari titipan (kirim − terjual resmi)", async () => {
    await titipan();
    const s = await stokDiToko(tokoId, SEKARANG);
    expect(s.source).toBe("TITIPAN");
    expect(s.baris).toEqual([expect.objectContaining({ itemId: barangId, qty: 6, source: "TITIPAN", nama: `${tag} Blus` })]);
    // Siklus Agustus dianggap terjual di akhir Agustus — dalam 30 hari terakhir.
    expect(s.baris[0].soldLast30).toBe(4);
  });

  it("begitu toko punya buku stok, buku yang dipakai — titipan tidak ikut dihitung", async () => {
    await titipan();
    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: tokoId, itemId: barangId, variantSku: "", qty: 3, kind: "OPNAME", createdById: orangId, createdAt: hariLalu(40) },
        { storeId: tokoId, itemId: barangId, variantSku: "", qty: -1, kind: "JUAL", createdById: orangId, createdAt: hariLalu(2) },
      ],
    });
    const s = await stokDiToko(tokoId, SEKARANG);
    expect(s.source).toBe("BUKU_TOKO");
    expect(s.baris).toEqual([expect.objectContaining({ qty: 2, soldLast30: 1, source: "BUKU_TOKO" })]);
  });

  it("penilaian: target MIN tersentuh → saran sampai MAKS, dibatasi gudang", async () => {
    await prisma.storeStockMovement.create({
      data: { storeId: tokoId, itemId: barangId, variantSku: "", qty: 1, kind: "OPNAME", createdById: orangId, createdAt: hariLalu(10) },
    });
    await prisma.storeStockTarget.create({ data: { storeId: tokoId, itemId: barangId, variantSku: "", minQty: 2, maxQty: 8 } });
    await prisma.inventoryValue.create({ data: { itemId: barangId, variantSku: null, qtyOnHand: 5, reservedQty: 1 } });

    const n = (await nilaiStokToko([tokoId], SEKARANG)).get(tokoId)!;
    expect(n.baris[0]).toMatchObject({ qty: 1, saranQty: 4, kurangGudang: true, target: { minQty: 2, maxQty: 8 } });
    expect(n.ringkas).toMatchObject({ barisIsiUlang: 1, pcsIsiUlang: 4, adaTarget: true });
  });

  it("barang yang hanya punya target tetap dinilai dan diberi nama", async () => {
    await prisma.storeStockTarget.create({ data: { storeId: tokoId, itemId: barangId, variantSku: "", minQty: 0, maxQty: 3 } });
    await prisma.inventoryValue.create({ data: { itemId: barangId, variantSku: "", qtyOnHand: 10, reservedQty: 0 } });
    const n = (await nilaiStokToko([tokoId], SEKARANG)).get(tokoId)!;
    expect(n.baris).toEqual([expect.objectContaining({ nama: `${tag} Blus`, qty: 0, saranQty: 3 })]);
  });
});
