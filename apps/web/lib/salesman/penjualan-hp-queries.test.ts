import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { SKEMA_KOMISI_BAWAAN, type SkemaKomisi } from "./komisi";
import { komisiSalesman } from "./komisi-queries";
import { berandaPenjualanHp, insentifHp, komisiUntukHp, pcsKonsiSalesman } from "./penjualan-hp-queries";
import { riwayatPenjualan } from "./riwayat-penjualan-queries";

/*
 * Payload penjualan untuk HP salesman terhadap basis data sungguhan: beranda
 * ("Bulan ini" + grafik 30 hari), riwayat penjualan, dan insentif.
 *
 * Aturan mutlak: rupiah konsinyasi tidak pernah sampai ke HP — tidak sebagai
 * kanal, tidak di dalam total, dan tidak lewat angka turunan (capaian, komisi,
 * kekurangan ke tingkat berikut) yang memungkinkan total − putus − van = konsi.
 * Nilai konsi sengaja 41.237 supaya bisa dicari di JSON; total resmi dengan
 * konsi = 49.500 + 41.237 + 10.000 = 100.737.
 *
 * Bulan acak jauh di masa lalu; pengaturan bersama (`SystemSetting`) tidak
 * pernah ditulis — skema dan target lewat `opsi`. Teardown hanya lewat id yang
 * diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const TAHUN = acak(2004, 2019);
const BL = acak(2, 10);
const pad = (n: number) => String(n).padStart(2, "0");
const BULAN = `${TAHUN}-${pad(BL)}`;
const tgl = (hari: number, jam = "10:00") => new Date(`${BULAN}-${pad(hari)}T${jam}:00+07:00`);
/** Dilihat pertengahan Desember tahun itu: BULAN ada di daftar 12 bulan. */
const NANTI = new Date(`${TAHUN}-12-15T10:00:00+07:00`);

const KONSI = "41237";
const TOTAL_RESMI = "100737";

/** Payload yang sampai ke HP tidak boleh memuat rupiah konsi atau total yang memuatnya. */
function bersih(payload: unknown) {
  const json = JSON.stringify(payload);
  expect(json).not.toContain(KONSI);
  expect(json).not.toContain(TOTAL_RESMI);
  expect(json).not.toMatch(/"konsi":/);
}

const skemaJual = (): SkemaKomisi => ({
  ...SKEMA_KOMISI_BAWAAN,
  aktif: true,
  dasar: "PENJUALAN",
  tarifPersen: 2,
  tingkat: [{ capaianPersen: 100, tarifPersen: 3 }],
});

d("payload penjualan HP salesman tanpa rupiah konsinyasi (test bed only)", () => {
  let uomId = "";
  let salesId = "";
  let tokoA = "";
  let tokoB = "";
  let i1 = "";
  let i2 = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let vanIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    salesId = "";
    tokoA = "";
    tokoB = "";
    i1 = "";
    i2 = "";
    orderIds = [];
    deliveryIds = [];
    vanIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PHP-${token}`, nameId: "t", nameEn: "t" } })).id;
    const barang = async (k: string) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-PHP-${k}-${token}`, nameId: `Barang PHP ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId },
        })
      ).id;
    i1 = await barang("1");
    i2 = await barang("2");

    salesId = (await prisma.user.create({ data: { email: `php-${token}@test.local`, name: `Sales PHP ${token}` } })).id;
    tokoA = (await prisma.store.create({ data: { code: `TEST-PHP-A-${token}`, name: `Toko A ${token}`, address: "x", termsType: "PUTUS" } })).id;
    tokoB = (await prisma.store.create({ data: { code: `TEST-PHP-B-${token}`, name: `Toko B ${token}`, address: "x", termsType: "KONSI" } })).id;

    let n = 0;
    const pesanan = async (x: object, lines: object[]) => {
      n += 1;
      const o = await prisma.fieldSalesOrder.create({
        data: { orderNo: `TEST-PHP-${token}-${n}`, storeId: tokoA, salesmanId: salesId, subtotal: 0, total: 0, ...x, lines: { create: lines as never } },
        include: { lines: true },
      });
      orderIds.push(o.id);
      return o;
    };

    // Putus: 5 pcs, dikirim tanggal 5, 49.500.
    const putus = await pesanan({ status: "APPROVED", orderType: "PUTUS", approvedAt: tgl(3), subtotal: 49_500, total: 49_500 }, [
      { itemId: i1, productName: "A", qty: 5, unitPrice: 9_900, lineTotal: 49_500 },
    ]);
    n += 1;
    const dl = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-PHP-DLV-${token}-${n}`,
        orderId: putus.id,
        deliveredAt: tgl(5),
        deliveredById: salesId,
        invoiceDate: tgl(5),
        dueDate: tgl(5),
        subtotal: 49_500,
        total: 49_500,
        lines: { create: [{ orderLineId: putus.lines[0].id, itemId: i1, productName: "A", qty: 5, unitPrice: 9_900, lineTotal: 49_500 }] },
      },
    });
    deliveryIds.push(dl.id);

    // Konsi disetujui tanggal 10: 4 pcs bernilai 41.237 + 1 bonus (tidak dihitung pcs-nya).
    await pesanan({ storeId: tokoB, status: "APPROVED", orderType: "KONSI", approvedAt: tgl(10), subtotal: 41_237, total: 41_237 }, [
      { itemId: i2, productName: "C", qty: 4, unitPrice: 10_309.25, lineTotal: 41_237 },
      { itemId: i2, productName: "C bonus", qty: 1, unitPrice: 0, lineTotal: 0, isBonus: true },
    ]);
    // Konsi menunggu: tidak dihitung sama sekali.
    await pesanan({ storeId: tokoB, status: "PENDING_APPROVAL", orderType: "KONSI", subtotal: 90_000, total: 90_000 }, [
      { itemId: i2, productName: "C", qty: 9, unitPrice: 10_000, lineTotal: 90_000 },
    ]);

    // Van ke pembeli langsung tanggal 12: 10.000.
    n += 1;
    const v = await prisma.vanSale.create({
      data: {
        docNo: `TEST-PHP-VAN-${token}-${n}`,
        salesmanId: salesId,
        storeId: null,
        subtotal: 10_000,
        total: 10_000,
        amountPaid: 10_000,
        changeAmount: 0,
        createdAt: tgl(12),
        lines: { create: [{ itemId: i1, productName: "A", qty: 1, unitPrice: 10_000, unitCost: 0, lineTotal: 10_000 }] },
      },
    });
    vanIds.push(v.id);
  });

  afterAll(async () => {
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(vanIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId].filter(Boolean)) } } });
  });

  it("pcs konsinyasi: hanya pesanan disetujui, baris bonus tidak dihitung", async () => {
    const pcs = await pcsKonsiSalesman(salesId, tgl(1, "00:00"));
    expect(pcs).toEqual([{ tanggal: tgl(10), pcs: 4 }]);
    // Batas atas eksklusif: disetujui tepat pukul 10.00 tanggal 10.
    expect(await pcsKonsiSalesman(salesId, tgl(1, "00:00"), tgl(10))).toEqual([]);
    expect(await pcsKonsiSalesman(salesId, tgl(1, "00:00"), tgl(11, "00:00"))).toEqual([{ tanggal: tgl(10), pcs: 4 }]);
  });

  it("beranda: 'Bulan ini' = putus + van dalam rupiah, konsinyasi 4 pcs", async () => {
    const r = await berandaPenjualanHp(salesId, tgl(20, "18:00"));
    expect(r.bulanIni).toEqual({ putus: 49_500, van: 10_000, total: 59_500, pcsKonsi: 4 });
    // Grafik 30 hari: putus + van saja.
    expect(r.tren).toHaveLength(60);
    expect(r.tren.reduce((n, x) => n + x.nilai, 0)).toBe(59_500);
    bersih(r);
  });

  it("riwayat penjualan: total, kanal, grafik, pembanding, dan target tanpa rupiah konsi", async () => {
    const r = await riwayatPenjualan(salesId, BULAN, NANTI);
    expect(r.ringkas.jumlah).toEqual({ putus: 49_500, van: 10_000, total: 59_500, pcsKonsi: 4 });
    expect(r.seri.find((s) => s.bulan === BULAN)).toEqual({ bulan: BULAN, putus: 49_500, van: 10_000, total: 59_500, pcsKonsi: 4 });
    // Toko konsi tetap muncul, tapi hanya pcs.
    expect(r.toko.find((t) => t.storeId === tokoB)).toMatchObject({ pcs: 4, pcsKonsi: 4, nilaiTanpaKonsi: 0 });
    bersih(r);
  });

  it("komisi untuk HP dihitung atas putus + van; perhitungan resmi kantor tidak berubah", async () => {
    const skema = skemaJual();
    // Resmi (kantor): omzet 100.737 ≥ target 100.000 → tarif 3%, komisi 3.022.
    const resmi = await komisiSalesman(salesId, BULAN, { skema, target: 100_000 });
    expect(resmi.omzet.total).toBe(100_737);
    expect(resmi.hasil).toMatchObject({ tarifDipakai: 3, komisi: 3_022 });

    // HP: omzet 59.500 → 59,5% → tarif 2%, komisi 1.190, kurang 40.500 ke tarif 3%.
    const hp = await komisiUntukHp(salesId, BULAN, { skema, target: 100_000 });
    expect(hp.omzet).toEqual({ putus: 49_500, konsi: 0, van: 10_000, total: 59_500 });
    expect(hp.hasil).toMatchObject({
      dasarNilai: 59_500,
      capaianPersen: 59.5,
      tarifDipakai: 2,
      komisi: 1_190,
      tingkatBerikut: { capaianPersen: 100, tarifPersen: 3, kurangNilai: 40_500 },
    });
  });

  it("insentif: payload HP tanpa rupiah konsi, komisi resmi, atau omzet resmi", async () => {
    const skema = skemaJual();
    const r = await insentifHp(salesId, BULAN, { skema, target: 100_000, hariIni: NANTI });
    expect(r.omzet).toEqual({ putus: 49_500, van: 10_000, total: 59_500, pcsKonsi: 4 });
    expect(r).toMatchObject({ dasar: "PENJUALAN", dasarNilai: 59_500, komisi: 1_190, capaianPersen: 59.5, target: 100_000 });
    bersih(r);
    // Komisi resmi (3.022) ÷ 3% = omzet resmi — tidak boleh ikut.
    expect(JSON.stringify(r)).not.toContain("3022");
  });
});
