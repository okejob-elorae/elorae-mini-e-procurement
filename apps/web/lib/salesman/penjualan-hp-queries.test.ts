import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { SKEMA_KOMISI_BAWAAN, type SkemaKomisi } from "./komisi";
import { komisiSalesman } from "./komisi-queries";
import { berandaPenjualanHp, insentifHp, pcsKonsiSalesman } from "./penjualan-hp-queries";
import { riwayatPenjualan } from "./riwayat-penjualan-queries";

/*
 * Payload penjualan untuk HP salesman terhadap basis data sungguhan: beranda
 * ("Bulan ini" + grafik), riwayat penjualan, dan insentif.
 *
 * Jawaban pemilik 2026-11-02 (P56 "tampilkan semuanya saja"): angka di HP
 * salesman = angka kantor, rupiah konsinyasi ikut. Omzet konsi = barang LAKU di
 * toko konsinyasi yang ia pegang, pada harga Elorae (`penjualan-konsi.ts`):
 * 4 pcs bersih × 10.309,25 (harga di toko 12.886,56 dibagi markup 25%) = 41.237.
 * Transfer konsi yang disetujui (6 pcs) bukan omzet. Total resmi dengan konsi =
 * 49.500 + 41.237 + 10.000 = 100.737.
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

const KONSI = 41_237;
const TOTAL_RESMI = 100_737;

const skemaJual = (): SkemaKomisi => ({
  ...SKEMA_KOMISI_BAWAAN,
  aktif: true,
  dasar: "PENJUALAN",
  tarifPersen: 2,
  tingkat: [{ capaianPersen: 100, tarifPersen: 3 }],
});

d("payload penjualan HP salesman = angka kantor, konsinyasi ikut (test bed only)", () => {
  let uomId = "";
  let salesId = "";
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
    tokoA = "";
    tokoB = "";
    i1 = "";
    i2 = "";
    orderIds = [];
    deliveryIds = [];
    vanIds = [];
    gerakIds = [];

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
    tokoB = (
      await prisma.store.create({
        data: { code: `TEST-PHP-B-${token}`, name: `Toko B ${token}`, address: "x", termsType: "KONSI", salesmanId: salesId, markupPercent: 25 },
      })
    ).id;

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

    // Transfer konsi disetujui tanggal 9: 6 pcs @ 12.886,56 di toko + 1 bonus — BUKAN omzet.
    await pesanan({ storeId: tokoB, status: "APPROVED", orderType: "KONSI", approvedAt: tgl(9), subtotal: 77_319.36, total: 77_319.36 }, [
      { itemId: i2, productName: "C", qty: 6, unitPrice: 12_886.56, lineTotal: 77_319.36 },
      { itemId: i2, productName: "C bonus", qty: 1, unitPrice: 0, lineTotal: 0, isBonus: true },
    ]);
    // Laku di toko B (buku stok SPG): 4 tanggal 10, 1 tanggal 14, kembali 1 tanggal 15 → bersih 4.
    for (const [qty, kind, hari] of [
      [7, "TERIMA", 9],
      [-4, "JUAL", 10],
      [-1, "JUAL", 14],
      [1, "RETUR_PEMBELI", 15],
    ] as const) {
      const g = await prisma.storeStockMovement.create({
        data: { storeId: tokoB, itemId: i2, variantSku: "", qty, kind, createdById: salesId, createdAt: tgl(hari) },
      });
      gerakIds.push(g.id);
    }
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
    await prisma.storeStockMovement.deleteMany({ where: { id: { in: seededIds(gerakIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(vanIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId].filter(Boolean)) } } });
  });

  it("pcs konsinyasi: barang laku di toko (retur pembeli mengurangi), bukan transfer yang disetujui", async () => {
    const pcs = await pcsKonsiSalesman(salesId, tgl(1, "00:00"));
    expect(pcs).toEqual([
      { tanggal: tgl(10), pcs: 4 },
      { tanggal: tgl(14), pcs: 1 },
      { tanggal: tgl(15), pcs: -1 },
    ]);
    // Batas atas eksklusif: laku tepat pukul 10.00 tanggal 10.
    expect(await pcsKonsiSalesman(salesId, tgl(1, "00:00"), tgl(10))).toEqual([]);
    expect(await pcsKonsiSalesman(salesId, tgl(1, "00:00"), tgl(11, "00:00"))).toEqual([{ tanggal: tgl(10), pcs: 4 }]);
  });

  it("beranda: 'Bulan ini' = putus + konsi + van dalam rupiah, konsinyasi 4 pcs (P56)", async () => {
    const r = await berandaPenjualanHp(salesId, tgl(20, "18:00"));
    expect(r.bulanIni).toEqual({ putus: 49_500, konsi: KONSI, van: 10_000, total: TOTAL_RESMI, pcsKonsi: 4 });
    expect(r.tren).toHaveLength(60);
    expect(r.tren.reduce((n, x) => n + x.nilai, 0)).toBe(TOTAL_RESMI);
  });

  it("riwayat penjualan: total, kanal, grafik, dan toko teratas memuat rupiah konsi", async () => {
    const r = await riwayatPenjualan(salesId, BULAN, NANTI);
    expect(r.ringkas.jumlah).toEqual({ putus: 49_500, konsi: KONSI, van: 10_000, total: TOTAL_RESMI, pcsKonsi: 4 });
    expect(r.seri.find((s) => s.bulan === BULAN)).toEqual({
      bulan: BULAN,
      putus: 49_500,
      konsi: KONSI,
      van: 10_000,
      total: TOTAL_RESMI,
      pcsKonsi: 4,
    });
    expect(r.toko.find((t) => t.storeId === tokoB)).toMatchObject({ pcs: 4, pcsKonsi: 4, nilai: KONSI });
  });

  it("insentif HP = perhitungan resmi kantor (P56)", async () => {
    const skema = skemaJual();
    // Resmi (kantor): omzet 100.737 ≥ target 100.000 → tarif 3%, komisi 3.022.
    const resmi = await komisiSalesman(salesId, BULAN, { skema, target: 100_000 });
    expect(resmi.omzet.total).toBe(TOTAL_RESMI);
    expect(resmi.hasil).toMatchObject({ tarifDipakai: 3, komisi: 3_022 });

    const r = await insentifHp(salesId, BULAN, { skema, target: 100_000, hariIni: NANTI });
    expect(r.omzet).toEqual({ putus: 49_500, konsi: KONSI, van: 10_000, total: TOTAL_RESMI, pcsKonsi: 4 });
    expect(r).toMatchObject({
      dasar: "PENJUALAN",
      dasarNilai: resmi.hasil.dasarNilai,
      komisi: resmi.hasil.komisi,
      capaianPersen: resmi.hasil.capaianPersen,
      target: 100_000,
    });
    // Rupiah konsi ada di payload yang dikirim ke HP.
    expect(JSON.stringify(r)).toContain(String(KONSI));
  });
});
