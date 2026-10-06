import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { prisma, seededId } from "@elorae/db";
import { calculateMovingAverage, hitungRataRataMasuk } from "./costing";
import { runSerializable } from "@/lib/db/tx-retry";

/*
 * Rata-rata bergerak saat barang masuk (GRN, penerimaan barang jadi).
 *
 * Dulu stok yang sempat minus ikut ditimbang: stok −5 @ 8.000 lalu masuk
 * 10 @ 9.000 menghasilkan (−40.000 + 90.000) ÷ 5 = 10.000 — lebih mahal dari
 * harga beli mana pun. Barang minus sudah keluar dengan harga lama; yang tersisa
 * di gudang adalah barang yang baru masuk, jadi rata-ratanya = harga masuk.
 */
describe("hitungRataRataMasuk (murni)", () => {
  it("stok −5 rata-rata 8.000, masuk 10 @ 9.000 → rata-rata 9.000, nilai 45.000", () => {
    const r = hitungRataRataMasuk({ qtyLama: -5, avgLama: 8_000, qtyMasuk: 10, hargaMasuk: 9_000 });
    expect(r.qtyBaru.toNumber()).toBe(5);
    expect(r.avgBaru.toNumber()).toBe(9_000);
    expect(r.nilaiBaru.toNumber()).toBe(45_000);
  });

  it("stok nol: rata-rata = harga masuk", () => {
    const r = hitungRataRataMasuk({ qtyLama: 0, avgLama: 0, qtyMasuk: 4, hargaMasuk: 2_500 });
    expect(r.avgBaru.toNumber()).toBe(2_500);
    expect(r.nilaiBaru.toNumber()).toBe(10_000);
  });

  it("stok tetap minus sesudah masuk: rata-rata = harga masuk, nilai ikut minus", () => {
    const r = hitungRataRataMasuk({ qtyLama: -20, avgLama: 8_000, qtyMasuk: 10, hargaMasuk: 9_000 });
    expect(r.qtyBaru.toNumber()).toBe(-10);
    expect(r.avgBaru.toNumber()).toBe(9_000);
    expect(r.nilaiBaru.toNumber()).toBe(-90_000);
  });

  it("stok positif tetap rata-rata tertimbang: 10 @ 8.000 + 10 @ 9.000 → 8.500", () => {
    const r = hitungRataRataMasuk({ qtyLama: 10, avgLama: 8_000, qtyMasuk: 10, hargaMasuk: 9_000 });
    expect(r.avgBaru.toNumber()).toBe(8_500);
    expect(r.nilaiBaru.toNumber()).toBe(170_000);
  });
});

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("calculateMovingAverage (basis data uji)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let uomId = "";
  let itemId = "";

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    uomId = (
      await prisma.uOM.create({ data: { code: `RB${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })
    ).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `RB-UJI-${token}`, nameId: "Barang uji rata-rata", nameEn: "Test", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function baris() {
    return prisma.inventoryValue.findMany({
      where: { itemId: seededId(itemId) },
      select: { variantSku: true, qtyOnHand: true, avgCost: true, totalValue: true },
    });
  }

  it("stok −5 @ 8.000, terima 10 @ 9.000 → stok 5, rata-rata 9.000, nilai 45.000", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: -5, avgCost: 8_000, totalValue: -40_000 },
    });
    const r = await calculateMovingAverage(itemId, new Decimal(10), new Decimal(9_000));
    expect(r.newAvgCost.toNumber()).toBe(9_000);
    const [b] = await baris();
    expect(Number(b.qtyOnHand)).toBe(5);
    expect(Number(b.avgCost)).toBe(9_000);
    expect(Number(b.totalValue)).toBe(45_000);
  });

  it("baris tanpa varian bertanda null dipakai, bukan dibuatkan kembaran \"\"", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 10, avgCost: 1_000, totalValue: 10_000 },
    });
    await calculateMovingAverage(itemId, new Decimal(10), new Decimal(2_000), undefined, null);
    const semua = await baris();
    expect(semua).toHaveLength(1);
    expect(semua[0].variantSku).toBeNull();
    expect(Number(semua[0].qtyOnHand)).toBe(20);
    expect(Number(semua[0].avgCost)).toBe(1_500);
  });

  it("varian nyata tetap di barisnya sendiri", async () => {
    await calculateMovingAverage(itemId, new Decimal(3), new Decimal(5_000), undefined, "RB-M");
    await calculateMovingAverage(itemId, new Decimal(2), new Decimal(7_500), undefined, "RB-M");
    const semua = await baris();
    expect(semua).toHaveLength(1);
    expect(semua[0].variantSku).toBe("RB-M");
    expect(Number(semua[0].qtyOnHand)).toBe(5);
    expect(Number(semua[0].avgCost)).toBe(6_000);
  });

  it("dua penerimaan serentak tidak saling menimpa stok: 10 @ 1.000 + 10 @ 3.000 → 20 @ 2.000", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 0, avgCost: 0, totalValue: 0 },
    });
    let lepasA: () => void = () => {};
    const tahanA = new Promise<void>((r) => (lepasA = r));
    // A menulis lalu menahan transaksinya; B membaca stok lama selagi A belum commit.
    const a = prisma.$transaction(async (tx) => {
      await calculateMovingAverage(itemId, new Decimal(10), new Decimal(1_000), tx);
      await tahanA;
    });
    await new Promise((r) => setTimeout(r, 150));
    const b = prisma.$transaction(async (tx) => {
      await calculateMovingAverage(itemId, new Decimal(10), new Decimal(3_000), tx);
    });
    await new Promise((r) => setTimeout(r, 300));
    lepasA();
    await Promise.all([a, b]);
    const [r] = await baris();
    expect(Number(r.qtyOnHand)).toBe(20);
    // Harga berbeda supaya rata-rata yang tertimpa ketahuan (1.000 atau 3.000, bukan 2.000).
    expect(Number(r.avgCost)).toBe(2_000);
    expect(Number(r.totalValue)).toBe(40_000);
  });

  it("barang baru diterima dua transaksi serializable serentak: yang kalah diulang, bukan gagal (10 @ 1.000 + 10 @ 3.000)", async () => {
    let lepasA: () => void = () => {};
    const tahanA = new Promise<void>((r) => (lepasA = r));
    // A membuat baris pertama lalu menahan transaksinya; B tidak melihatnya dan ikut membuat.
    const a = runSerializable(async (tx) => {
      await calculateMovingAverage(itemId, new Decimal(10), new Decimal(1_000), tx, null);
      await tahanA;
    });
    await new Promise((r) => setTimeout(r, 150));
    const b = runSerializable(async (tx) => {
      await calculateMovingAverage(itemId, new Decimal(10), new Decimal(3_000), tx, null);
    });
    await new Promise((r) => setTimeout(r, 300));
    lepasA();
    const hasil = await Promise.allSettled([a, b]);
    expect(hasil.map((h) => (h.status === "rejected" ? String(h.reason) : h.status))).toEqual(["fulfilled", "fulfilled"]);
    const semua = await baris();
    expect(semua).toHaveLength(1);
    expect(Number(semua[0].qtyOnHand)).toBe(20);
    expect(Number(semua[0].avgCost)).toBe(2_000);
  });

  /*
   * `createGRN` memproses baris dengan `Promise.all` di SATU transaksi, jadi dua
   * baris barang yang sama saling selang di setiap `await`. Dulu: barang baru →
   * keduanya tidak menemukan baris lalu sama-sama membuat (P2002, GRN gagal);
   * barang lama → baris kedua membaca rata-rata sebelum baris pertama menulisnya.
   */
  it("dua baris barang yang sama dalam satu transaksi (barang baru): 10 @ 1.000 + 5 @ 4.000 → 15 @ 2.000", async () => {
    await prisma.$transaction(async (tx) => {
      await Promise.all([
        calculateMovingAverage(itemId, new Decimal(10), new Decimal(1_000), tx, null),
        calculateMovingAverage(itemId, new Decimal(5), new Decimal(4_000), tx, null),
      ]);
    });
    const semua = await baris();
    expect(semua).toHaveLength(1);
    expect(Number(semua[0].qtyOnHand)).toBe(15);
    expect(Number(semua[0].avgCost)).toBe(2_000);
    expect(Number(semua[0].totalValue)).toBe(30_000);
  });

  it("dua baris barang yang sama dalam satu transaksi (stok sudah ada): 10 @ 1.000 + 10 @ 4.000 + 10 @ 7.000 → 30 @ 4.000", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, avgCost: 1_000, totalValue: 10_000 },
    });
    await prisma.$transaction(async (tx) => {
      const [a, b] = await Promise.all([
        calculateMovingAverage(itemId, new Decimal(10), new Decimal(4_000), tx, null),
        calculateMovingAverage(itemId, new Decimal(10), new Decimal(7_000), tx, null),
      ]);
      // Kartu stok per baris: saldo setelah baris pertama lalu kedua, berurutan.
      expect([a.newQty.toNumber(), b.newQty.toNumber()]).toEqual([20, 30]);
      expect([a.newTotalValue.toNumber(), b.newTotalValue.toNumber()]).toEqual([50_000, 120_000]);
    });
    const [r] = await baris();
    expect(Number(r.qtyOnHand)).toBe(30);
    expect(Number(r.avgCost)).toBe(4_000);
    expect(Number(r.totalValue)).toBe(120_000);
  });
});
