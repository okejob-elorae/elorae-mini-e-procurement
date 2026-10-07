import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { angkaKolaborasi, jumlahAngkaKolaborasi } from "./angka-queries";

/*
 * Terhadap basis data sungguhan: yang bisa salah di sini adalah APA YANG
 * DIBACA (angka terbaru vs angka lama, pengiriman yang belum berangkat,
 * batas periode), bukan aritmetikanya — itu sudah diuji di angka-konten.
 */

const tag = `ANGKAUJI-${Math.random().toString(36).slice(2, 7)}`;
let kolId = "";
let kolabIds: string[] = [];
let itemId = "";

async function kolaborasi(akhiran: string, fee: number, dealAt: Date) {
  const k = await prisma.kolBrief.create({
    data: { docNo: `${tag}-${akhiran}`, kolId, fee, boostCost: 50_000, dealAt, tahap: "TAYANG" },
    select: { id: true },
  });
  kolabIds.push(k.id);
  return k.id;
}

beforeEach(async () => {
  kolId = "";
  kolabIds = [];
  itemId = (await prisma.item.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} kol` }, select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  if (kolId) await prisma.kol.delete({ where: { id: seededId(kolId) } });
});

describe("angkaKolaborasi", () => {
  it("memakai angka TERBARU tiap konten, menjumlah penjualan, dan hanya sampel yang sudah berangkat", async () => {
    const id = await kolaborasi("a", 1_000_000, new Date("2026-09-01T03:00:00Z"));
    const konten = await prisma.kolContent.create({
      data: { collabId: id, platform: "TIKTOK", format: "VIDEO", link: "https://contoh.test/v/1", liveAt: new Date("2026-09-05T03:00:00Z") },
      select: { id: true },
    });
    await prisma.kolContentMetric.createMany({
      data: [
        { contentId: konten.id, recordedAt: new Date("2026-09-06T03:00:00Z"), views: 1_000, likes: 100 },
        { contentId: konten.id, recordedAt: new Date("2026-09-12T03:00:00Z"), views: 10_000, likes: 800, comments: 50, shares: 20, saves: 30 },
      ],
    });
    // Konten tanpa link (masih rencana) tidak dihitung.
    await prisma.kolContent.create({ data: { collabId: id, platform: "TIKTOK", format: "VIDEO", plannedAt: new Date() } });
    await prisma.kolSale.createMany({
      data: [
        { collabId: id, date: new Date("2026-09-10T03:00:00Z"), orders: 10, gmv: 2_000_000, commission: 100_000 },
        { collabId: id, date: new Date("2026-09-20T03:00:00Z"), orders: 5, gmv: 1_000_000, commission: 50_000 },
      ],
    });
    await prisma.kolShipment.create({
      data: {
        collabId: id,
        sentAt: new Date("2026-09-02T03:00:00Z"),
        stockIssuedAt: new Date("2026-09-02T03:00:00Z"),
        trackingNo: "R1",
        shippingCost: 20_000,
        lines: { create: [{ itemId, itemName: "Contoh", qty: 2, unitCost: 75_000 }] },
      },
    });
    // Belum berangkat: tidak menambah biaya.
    await prisma.kolShipment.create({
      data: { collabId: id, shippingCost: 99_000, lines: { create: [{ itemId, itemName: "Contoh", qty: 5, unitCost: 75_000 }] } },
    });

    const a = (await angkaKolaborasi([id])).get(id)!;
    expect(a.angka).toEqual({ views: 10_000, likes: 800, comments: 50, shares: 20, saves: 30 });
    expect(a.jumlahKonten).toBe(1);
    expect(a.interaksi).toBe(900);
    expect(a.orders).toBe(15);
    expect(a.gmv).toBe(3_000_000);
    expect(a.biaya).toEqual({ fee: 1_000_000, boost: 50_000, ongkir: 20_000, sampel: 150_000, komisi: 150_000, total: 1_370_000 });
    expect(a.roas).toBe(2.19); // roas() membulatkan 2 desimal
  });

  it("periode menyaring penjualan menurut tanggal dan fee menurut tanggal deal (hari WIB)", async () => {
    const lama = await kolaborasi("lama", 500_000, new Date("2026-08-15T03:00:00Z"));
    const baru = await kolaborasi("baru", 700_000, new Date("2026-09-30T18:00:00Z")); // 1 Okt WIB
    await prisma.kolSale.createMany({
      data: [
        { collabId: lama, date: new Date("2026-08-20T03:00:00Z"), orders: 3, gmv: 300_000 },
        { collabId: lama, date: new Date("2026-10-02T03:00:00Z"), orders: 1, gmv: 100_000 },
      ],
    });

    const peta = await angkaKolaborasi([lama, baru], { periode: { dari: "2026-10-01", sampai: "2026-10-31" } });
    expect(peta.get(lama)!.gmv).toBe(100_000);
    expect(peta.get(lama)!.biaya.fee).toBe(0);
    expect(peta.get(baru)!.biaya.fee).toBe(700_000);

    const total = jumlahAngkaKolaborasi(peta.values());
    expect(total.gmv).toBe(100_000);
    expect(total.biaya.total).toBe(750_000);
    expect(total.roas).toBe(0.13);
  });

  it("fee dihitung dari bruto termin hidup: gross-up ikut PPh-nya, termin batal tidak dihitung", async () => {
    // Gross-up: KOL menerima 9.750.000 bersih, Elorae menanggung bruto 9.999.999.
    const grossUp = await kolaborasi("gu", 9_750_000, new Date("2026-09-01T03:00:00Z"));
    await prisma.kolPaymentTerm.createMany({
      data: [
        { collabId: grossUp, urutan: 1, label: "DP", neto: 4_875_000, bruto: 5_000_000, pph: 125_000, grossUp: true, status: "DIBAYAR" },
        { collabId: grossUp, urutan: 2, label: "Pelunasan", neto: 4_875_000, bruto: 4_999_999, pph: 124_999, grossUp: true },
        { collabId: grossUp, urutan: 3, label: "Lama", neto: 1_000_000, bruto: 1_025_641, pph: 25_641, grossUp: true, status: "BATAL" },
      ],
    });
    // Dipotong: fee sudah bruto, termin sama dengan fee.
    const dipotong = await kolaborasi("dp", 2_000_000, new Date("2026-09-01T03:00:00Z"));
    await prisma.kolPaymentTerm.create({ data: { collabId: dipotong, label: "Pelunasan", neto: 1_950_000, bruto: 2_000_000, pph: 50_000 } });
    // Tanpa termin sama sekali: fee apa adanya.
    const tanpa = await kolaborasi("tt", 300_000, new Date("2026-09-01T03:00:00Z"));

    const peta = await angkaKolaborasi([grossUp, dipotong, tanpa]);
    expect(peta.get(grossUp)!.biaya.fee).toBe(9_999_999);
    expect(peta.get(dipotong)!.biaya.fee).toBe(2_000_000);
    expect(peta.get(tanpa)!.biaya.fee).toBe(300_000);
  });

  it("id kosong atau tak dikenal tidak membuat galat", async () => {
    expect((await angkaKolaborasi([])).size).toBe(0);
    expect((await angkaKolaborasi(["tidak-ada"])).size).toBe(0);
    expect(jumlahAngkaKolaborasi([]).roas).toBeNull();
  });
});
