import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { berandaPenjualanHp } from "./penjualan-hp-queries";
import { riwayatPenjualan } from "./riwayat-penjualan-queries";

/*
 * Halaman "Riwayat penjualan" terhadap basis data uji. Yang dipasak: total satu
 * bulan (dan tiap kanalnya) SAMA PERSIS dengan kartu "Bulan ini" di beranda
 * pada hari terakhir bulan itu — dihitung dengan fungsi beranda sendiri
 * (`berandaPenjualanHp`), persis seperti `app/pwa/page.tsx`. Keduanya untuk
 * HP: rupiah putus + van, konsinyasi hanya pcs. Ditambah: batas bulan WIB,
 * pembanding bulan lalu / tahun lalu, toko & barang teratas tanpa nilai
 * konsinyasi.
 *
 * Semua baris milik pengguna buatan tes pada bulan lampau yang acak; teardown
 * hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const TAHUN = acak(2004, 2019);
const BL = acak(2, 11);
const pad = (n: number) => String(n).padStart(2, "0");
const BULAN = `${TAHUN}-${pad(BL)}`;
const BULAN_LALU = `${TAHUN}-${pad(BL - 1)}`;
const TAHUN_LALU = `${TAHUN - 1}-${pad(BL)}`;
const tgl = (hari: number, jam = "10:00", bulan = BULAN) => new Date(`${bulan}-${pad(hari)}T${jam}:00+07:00`);
const hariTerakhir = (bulan: string) => {
  const [th, bl] = bulan.split("-").map(Number);
  return new Date(Date.UTC(th, bl, 0)).getUTCDate();
};
/** Dilihat pertengahan Desember tahun itu: BULAN ada di grafik 12 bulan. */
const NANTI = new Date(`${TAHUN}-12-15T10:00:00+07:00`);

/** "Bulan ini" persis seperti `app/pwa/page.tsx` mengambilnya. */
async function omzetBeranda(salesmanId: string, hariIni: Date) {
  return (await berandaPenjualanHp(salesmanId, hariIni)).bulanIni;
}

const sen = (n: number) => Math.round(n * 100);

d("riwayat penjualan salesman (test bed only)", () => {
  let uomId = "";
  let salesId = "";
  let lainId = "";
  let tokoA = "";
  let tokoB = "";
  let i1 = "";
  let i2 = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let vanIds: string[] = [];
  let gerakIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    salesId = "";
    lainId = "";
    tokoA = "";
    tokoB = "";
    i1 = "";
    i2 = "";
    orderIds = [];
    deliveryIds = [];
    vanIds = [];
    gerakIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-RP-${token}`, nameId: "t", nameEn: "t" } })).id;
    const barang = async (k: string) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-RP-${k}-${token}`, nameId: `Barang RP ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId },
        })
      ).id;
    i1 = await barang("1");
    i2 = await barang("2");

    salesId = (await prisma.user.create({ data: { email: `rp-${token}@test.local`, name: `Sales RP ${token}` } })).id;
    lainId = (await prisma.user.create({ data: { email: `rp-lain-${token}@test.local`, name: `Lain RP ${token}` } })).id;
    tokoA = (await prisma.store.create({ data: { code: `TEST-RP-A-${token}`, name: `Toko A ${token}`, address: "x", termsType: "PUTUS" } })).id;
    // Toko konsinyasi yang dipegang sales ini; margin kosong → harga di toko = harga Elorae.
    tokoB = (
      await prisma.store.create({
        data: { code: `TEST-RP-B-${token}`, name: `Toko B ${token}`, address: "x", termsType: "KONSI", salesmanId: salesId },
      })
    ).id;

    let n = 0;
    const pesanan = async (x: object, lines: object[]) => {
      n += 1;
      const o = await prisma.fieldSalesOrder.create({
        data: { orderNo: `TEST-RP-${token}-${n}`, storeId: tokoA, salesmanId: salesId, subtotal: 0, total: 0, ...x, lines: { create: lines as never } },
        include: { lines: { orderBy: { productName: "asc" } } },
      });
      orderIds.push(o.id);
      return o;
    };
    const kiriman = async (orderId: string, deliveredAt: Date, total: number, lines: object[]) => {
      n += 1;
      const dl = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-RP-DLV-${token}-${n}`,
          orderId,
          deliveredAt,
          deliveredById: salesId,
          invoiceDate: deliveredAt,
          dueDate: deliveredAt,
          subtotal: total,
          total,
          lines: { create: lines as never },
        },
      });
      deliveryIds.push(dl.id);
    };
    const van = async (salesmanId: string, storeId: string | null, createdAt: Date, total: number, lines: object[]) => {
      n += 1;
      const v = await prisma.vanSale.create({
        data: {
          docNo: `TEST-RP-VAN-${token}-${n}`,
          salesmanId,
          storeId,
          subtotal: total,
          total,
          amountPaid: total,
          changeAmount: 0,
          createdAt,
          lines: { create: lines as never },
        },
      });
      vanIds.push(v.id);
    };

    // Putus ke toko A: 5 pcs barang 1 + 1 bonus, dikirim tanggal 5 (49.500 sesudah diskon).
    const putus = await pesanan(
      { status: "APPROVED", orderType: "PUTUS", approvedAt: tgl(3), subtotal: 50_000, orderDiscountAmount: 500, total: 49_500 },
      [
        { itemId: i1, productName: "A", qty: 5, unitPrice: 10_000, lineTotal: 50_000 },
        { itemId: i1, productName: "B bonus", qty: 1, unitPrice: 0, lineTotal: 0, isBonus: true },
      ],
    );
    const [lA, lBonus] = putus.lines;
    await kiriman(putus.id, tgl(5), 49_500, [
      { orderLineId: lA.id, itemId: i1, productName: "A", qty: 5, unitPrice: 10_000, lineTotal: 50_000 },
      { orderLineId: lBonus.id, itemId: i1, productName: "B bonus", qty: 1, unitPrice: 0, lineTotal: 0 },
    ]);
    // Kiriman bulan lalu 23.30 WIB hari terakhir: milik bulan lalu.
    await kiriman(putus.id, new Date(tgl(1, "00:00").getTime() - 30 * 60_000), 20_000, [
      { orderLineId: lA.id, itemId: i1, productName: "A", qty: 2, unitPrice: 10_000, lineTotal: 20_000 },
    ]);

    // Transfer konsi ke toko B disetujui tanggal 9 (6 pcs barang 2) — bukan penjualan.
    await pesanan({ storeId: tokoB, status: "APPROVED", orderType: "KONSI", approvedAt: tgl(9), subtotal: 60_000, total: 60_000 }, [
      { itemId: i2, productName: "C", qty: 6, unitPrice: 10_000, lineTotal: 60_000 },
    ]);
    // Laku di toko B tanggal 10: 4 pcs, nilai 40.000 (tidak boleh tampil per toko/barang).
    gerakIds.push(
      (
        await prisma.storeStockMovement.create({
          data: { storeId: tokoB, itemId: i2, variantSku: "", qty: -4, kind: "JUAL", createdById: salesId, createdAt: tgl(10) },
        })
      ).id,
    );
    // Konsi menunggu: tidak dihitung.
    await pesanan({ storeId: tokoB, status: "PENDING_APPROVAL", orderType: "KONSI", subtotal: 90_000, total: 90_000 }, [
      { itemId: i2, productName: "C", qty: 9, unitPrice: 10_000, lineTotal: 90_000 },
    ]);

    // Van: ke toko A 00.30 WIB tanggal 1 (masih bulan lalu menurut UTC), dan ke pembeli tanpa toko.
    await van(salesId, tokoA, tgl(1, "00:30"), 10_000, [
      { itemId: i2, productName: "C", qty: 1, unitPrice: 10_000, unitCost: 0, lineTotal: 10_000 },
    ]);
    await van(salesId, null, tgl(12), 7_000.5, [
      { itemId: i2, productName: "C", qty: 1, unitPrice: 7_000.5, unitCost: 0, lineTotal: 7_000.5 },
    ]);
    // Bulan yang sama tahun lalu.
    await van(salesId, tokoA, tgl(15, "10:00", TAHUN_LALU), 30_000, [
      { itemId: i1, productName: "A", qty: 3, unitPrice: 10_000, unitCost: 0, lineTotal: 30_000 },
    ]);
    // Sales lain: tidak pernah ikut.
    await van(lainId, tokoA, tgl(12), 70_000, [
      { itemId: i1, productName: "A", qty: 7, unitPrice: 10_000, unitCost: 0, lineTotal: 70_000 },
    ]);
  });

  afterAll(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { id: { in: seededIds(gerakIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(vanIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId, lainId].filter(Boolean)) } } });
  });

  it("total bulan = kartu 'Bulan ini' di beranda pada hari terakhir bulan itu, per kanal pun sama", async () => {
    const akhirBulan = tgl(hariTerakhir(BULAN), "20:00");
    const beranda = await omzetBeranda(salesId, akhirBulan);
    const r = await riwayatPenjualan(salesId, BULAN, NANTI);

    expect(beranda.putus).toBeGreaterThan(0);
    expect(beranda.pcsKonsi).toBeGreaterThan(0);
    expect(beranda.van).toBeGreaterThan(0);
    expect(r.bulan).toBe(BULAN);
    expect(sen(r.ringkas.jumlah.total)).toBe(sen(beranda.total));
    expect(sen(r.ringkas.jumlah.putus)).toBe(sen(beranda.putus));
    expect(sen(r.ringkas.jumlah.van)).toBe(sen(beranda.van));
    expect(r.ringkas.jumlah.pcsKonsi).toBe(beranda.pcsKonsi);
    // Dihitung tangan: 49.500 + 10.000 + 7.000,50 — konsi 40.000 tidak pernah dalam rupiah, hanya 4 pcs.
    expect(sen(r.ringkas.jumlah.total)).toBe(sen(66_500.5));
    expect(r.ringkas.jumlah.pcsKonsi).toBe(4);
    // Grafik 12 bulan memuat angka yang sama.
    expect(sen(r.seri.find((s) => s.bulan === BULAN)!.total)).toBe(sen(66_500.5));
    expect(r.seri.find((s) => s.bulan === BULAN)!.pcsKonsi).toBe(4);
    // Total resmi dengan konsi (106.500,5) tidak boleh ikut: total − putus − van = konsi.
    expect(JSON.stringify(r)).not.toContain("106500");
    expect(JSON.stringify(r)).not.toContain("40000");
  });

  it("bulan berjalan = kartu beranda hari itu juga", async () => {
    const hariIni = tgl(11, "18:00");
    const beranda = await omzetBeranda(salesId, hariIni);
    const r = await riwayatPenjualan(salesId, undefined, hariIni);
    expect(r.bulan).toBe(BULAN);
    expect(r.ringkas.sampaiTanggal).toBe(11);
    expect(sen(r.ringkas.jumlah.total)).toBe(sen(beranda.total));
    // Putus 49.500 + van 10.000; van ke pembeli langsung tanggal 12 belum terjadi.
    expect(sen(r.ringkas.jumlah.total)).toBe(sen(59_500));
  });

  it("pembanding: bulan lalu dan bulan yang sama tahun lalu", async () => {
    const r = await riwayatPenjualan(salesId, BULAN, NANTI);
    expect(r.ringkas.sampaiTanggal).toBeNull();
    expect(r.ringkas.sebulanLalu).toMatchObject({ bulan: BULAN_LALU, total: 20_000 });
    expect(r.ringkas.setahunLalu).toMatchObject({ bulan: TAHUN_LALU, total: 30_000 });
    expect(r.ringkas.setahunLalu.persen).toBe(Math.round(((66_500.5 - 30_000) / 30_000) * 100));
  });

  it("toko teratas menurut pcs; konsi tanpa rupiah; pembeli tanpa toko dilewati", async () => {
    const r = await riwayatPenjualan(salesId, BULAN, NANTI);
    expect(r.toko).toEqual([
      { storeId: tokoA, nama: `Toko A ${token}`, pcs: 6, pcsKonsi: 0, nilaiTanpaKonsi: 59_500 },
      { storeId: tokoB, nama: `Toko B ${token}`, pcs: 4, pcsKonsi: 4, nilaiTanpaKonsi: 0 },
    ]);
  });

  it("barang teratas: bonus tidak dihitung; rupiah tanpa konsinyasi", async () => {
    const r = await riwayatPenjualan(salesId, BULAN, NANTI);
    const b1 = r.barang.find((b) => b.itemId === i1)!;
    const b2 = r.barang.find((b) => b.itemId === i2)!;
    expect(b1).toMatchObject({ pcs: 5, pcsKonsi: 0, nilaiTanpaKonsi: 49_500, sku: `TEST-RP-1-${token}` });
    // Barang 2: 4 konsi + 1 van ke toko + 1 van langsung = 6 pcs; rupiah hanya van.
    expect(b2).toMatchObject({ pcs: 6, pcsKonsi: 4, nilaiTanpaKonsi: 17_000.5 });
    expect(r.barang[0].itemId).toBe(i2);
    // Nilai konsinyasi tidak pernah keluar dari bagian toko dan barang.
    expect(JSON.stringify({ t: r.toko, b: r.barang })).not.toContain("40000");
  });

  it("bulan di luar daftar 12 bulan jatuh ke bulan ini", async () => {
    const r = await riwayatPenjualan(salesId, TAHUN_LALU, NANTI);
    expect(r.bulan).toBe(`${TAHUN}-12`);
    expect(r.daftarBulan).toHaveLength(12);
  });
});
