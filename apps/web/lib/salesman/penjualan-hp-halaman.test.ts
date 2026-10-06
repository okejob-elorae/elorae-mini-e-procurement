import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kemajuanTarget } from "./dasbor";
import { peringkatHp } from "./peringkat-hp-queries";
import { targetSayaHp } from "./target-rinci-queries";
import { persenTurun } from "./toko-menurun";
import { tokoMenurunHp } from "./toko-menurun-queries";

/*
 * Payload tiga halaman HP salesman terhadap basis data sungguhan: Peringkat,
 * Target saya, dan toko menurun di beranda.
 *
 * Aturan mutlak pemilik: harga dan total konsinyasi tidak pernah sampai ke
 * aplikasi salesman — tidak di layar, tidak di payload, dan tidak lewat angka
 * turunan (capaian × target − putus − van = konsi). Nilai konsi sengaja
 * 41.237 supaya bisa dicari di JSON; omzet resmi sales A dengan konsi =
 * 49.500 + 41.237 + 10.000 = 100.737 (capaian resmi 100,7% dari 100.000).
 *
 * Bulan acak jauh di masa lalu; pengaturan bersama (`SystemSetting`) tidak
 * pernah ditulis — target total dan aturan peringkat lewat `opsi`. Teardown
 * hanya lewat id yang diseed.
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
const HARI_INI = tgl(20, "18:00");
const HARI_MS = 86_400_000;
/** Siang WIB, `n` hari sebelum HARI_INI. */
const mundur = (n: number) => new Date(tgl(20, "12:00").getTime() - n * HARI_MS);

/** Payload yang sampai ke HP tidak boleh memuat rupiah konsi atau angka yang memuatnya. */
function bersih(payload: unknown, terlarang: readonly string[]) {
  const json = JSON.stringify(payload);
  for (const angka of terlarang) expect(json, `payload memuat ${angka}`).not.toContain(angka);
  expect(json).not.toMatch(/"konsi":/);
}

d("payload Peringkat, Target, dan toko menurun di HP tanpa rupiah konsinyasi (test bed only)", () => {
  let uomId = "";
  let katA = "";
  let i1 = "";
  let i2 = "";
  let salesA = "";
  let salesB = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let tokoTurun = "";
  let tokoCampur = "";
  let tokoVan = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let vanIds: string[] = [];
  let targetIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    katA = "";
    i1 = "";
    i2 = "";
    salesA = "";
    salesB = "";
    tokoPutus = "";
    tokoKonsi = "";
    tokoTurun = "";
    tokoCampur = "";
    tokoVan = "";
    orderIds = [];
    deliveryIds = [];
    vanIds = [];
    targetIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PHH-${token}`, nameId: "t", nameEn: "t" } })).id;
    katA = (await prisma.itemCategory.create({ data: { code: `PHH-A-${token}`, name: `Kaos ${token}` } })).id;
    const barang = async (k: string) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-PHH-${k}-${token}`, nameId: `Barang PHH ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId, categoryId: katA },
        })
      ).id;
    i1 = await barang("1");
    i2 = await barang("2");

    salesA = (await prisma.user.create({ data: { email: `phh-a-${token}@test.local`, name: `Sales A ${token}` } })).id;
    salesB = (await prisma.user.create({ data: { email: `phh-b-${token}@test.local`, name: `Sales B ${token}` } })).id;
    // Kode toko sengaja TANPA awalan "TEST-": `app/pwa/stores/actions.spec.ts`
    // menghapus setiap toko berawalan itu, dan bisa jalan bersamaan.
    const toko = async (k: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `PHH-T${k}-${token}`, name: `Toko ${k} ${token}`, address: "x", termsType } })).id;
    tokoPutus = await toko("P", "PUTUS");
    tokoKonsi = await toko("K", "KONSI");
    tokoTurun = await toko("T", "KONSI");
    // Toko yang dulu konsinyasi lalu dilayani van, dan toko yang hanya dilayani van.
    tokoCampur = await toko("M", "PUTUS");
    tokoVan = await toko("V", "PUTUS");

    let n = 0;
    const pesanan = async (x: object, lines: object[]) => {
      n += 1;
      const o = await prisma.fieldSalesOrder.create({
        data: { orderNo: `TEST-PHH-${token}-${n}`, storeId: tokoPutus, salesmanId: salesA, subtotal: 0, total: 0, ...x, lines: { create: lines as never } },
        include: { lines: true },
      });
      orderIds.push(o.id);
      return o;
    };
    const van = async (salesmanId: string, total: number, qty: number) => {
      n += 1;
      const v = await prisma.vanSale.create({
        data: {
          docNo: `TEST-PHH-VAN-${token}-${n}`,
          salesmanId,
          storeId: null,
          subtotal: total,
          total,
          amountPaid: total,
          changeAmount: 0,
          createdAt: tgl(12),
          lines: { create: [{ itemId: i1, productName: "A", qty, unitPrice: total / qty, unitCost: 0, lineTotal: total }] },
        },
      });
      vanIds.push(v.id);
    };

    // Sales A — putus 5 pcs dikirim tanggal 5: 49.500.
    const putus = await pesanan({ status: "APPROVED", orderType: "PUTUS", approvedAt: tgl(3), subtotal: 49_500, total: 49_500 }, [
      { itemId: i1, productName: "A", qty: 5, unitPrice: 9_900, lineTotal: 49_500 },
    ]);
    n += 1;
    const dl = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-PHH-DLV-${token}-${n}`,
        orderId: putus.id,
        deliveredAt: tgl(5),
        deliveredById: salesA,
        invoiceDate: tgl(5),
        dueDate: tgl(5),
        subtotal: 49_500,
        total: 49_500,
        lines: { create: [{ orderLineId: putus.lines[0].id, itemId: i1, productName: "A", qty: 5, unitPrice: 9_900, lineTotal: 49_500 }] },
      },
    });
    deliveryIds.push(dl.id);
    // Sales A — konsi disetujui tanggal 10: 4 pcs bernilai 41.237 + 1 bonus.
    await pesanan({ storeId: tokoKonsi, status: "APPROVED", orderType: "KONSI", approvedAt: tgl(10), subtotal: 41_237, total: 41_237 }, [
      { itemId: i2, productName: "C", qty: 4, unitPrice: 10_309.25, lineTotal: 41_237 },
      { itemId: i2, productName: "C bonus", qty: 1, unitPrice: 0, lineTotal: 0, isBonus: true },
    ]);
    // Sales A — van 10.000; sales B — van 70.000 (tanpa konsi).
    await van(salesA, 10_000, 1);
    await van(salesB, 70_000, 7);

    // Toko konsi yang nilainya turun: konsi disetujui milik sales B, semuanya
    // sebelum bulan itu. 90 hari terakhir 11.119 + 10.031 = 21.150; 90 hari
    // sebelumnya 60.013 + 50.027 = 110.040 → turun 81%.
    for (const [hari, total] of [
      [150, 60_013],
      [120, 50_027],
      [60, 11_119],
      [25, 10_031],
    ] as const) {
      await pesanan(
        { storeId: tokoTurun, salesmanId: salesB, status: "APPROVED", orderType: "KONSI", approvedAt: mundur(hari), subtotal: total, total },
        [{ itemId: i2, productName: "C", qty: 1, unitPrice: total, lineTotal: total }],
      );
    }

    // Toko campuran: 90 hari sebelumnya konsi 40.009 + 40.003 = 80.012, 90 hari
    // terakhir van 9.001 + 6.002 = 15.003 (nota van dipegang salesman). Rasio
    // 0,1875 → 15.003 ÷ 0,1875 ≈ 80.016: total konsi terbuka sampai beberapa
    // rupiah. Toko van saja: 30.007 + 30.011 = 60.018 → 9.004 + 6.005 = 15.009,
    // turun 75% — angkanya boleh sampai ke HP.
    const vanToko = async (storeId: string, hari: number, total: number) => {
      n += 1;
      const v = await prisma.vanSale.create({
        data: {
          docNo: `TEST-PHH-VAN-${token}-${n}`,
          salesmanId: salesB,
          storeId,
          subtotal: total,
          total,
          amountPaid: total,
          changeAmount: 0,
          createdAt: mundur(hari),
          lines: { create: [{ itemId: i1, productName: "A", qty: 1, unitPrice: total, unitCost: 0, lineTotal: total }] },
        },
      });
      vanIds.push(v.id);
    };
    for (const [hari, total] of [
      [150, 40_009],
      [120, 40_003],
    ] as const) {
      await pesanan(
        { storeId: tokoCampur, salesmanId: salesB, status: "APPROVED", orderType: "KONSI", approvedAt: mundur(hari), subtotal: total, total },
        [{ itemId: i2, productName: "C", qty: 1, unitPrice: total, lineTotal: total }],
      );
    }
    await vanToko(tokoCampur, 60, 9_001);
    await vanToko(tokoCampur, 25, 6_002);
    await vanToko(tokoVan, 150, 30_007);
    await vanToko(tokoVan, 120, 30_011);
    await vanToko(tokoVan, 60, 9_004);
    await vanToko(tokoVan, 25, 6_005);

    const target = (scope: string, refId: string, measure: string, value: number) =>
      prisma.salesTarget.create({ data: { salesmanId: salesA, month: BULAN, scope, refId, measure, value, createdById: salesA } });
    targetIds = [
      (await target("KATEGORI", katA, "NILAI", 200_000)).id,
      (await target("BARANG", i2, "NILAI", 50_000)).id,
      (await target("BARANG", i1, "PCS", 10)).id,
    ];
  });

  afterAll(async () => {
    await prisma.salesTarget.deleteMany({ where: { id: { in: seededIds(targetIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(vanIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoKonsi, tokoTurun, tokoCampur, tokoVan].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2].filter(Boolean)) } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(katA) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesA, salesB].filter(Boolean)) } } });
  });

  it("peringkat: diurutkan dan dihitung atas putus + van; omzet dan pcs konsi hanya milik sendiri", async () => {
    const baris = await peringkatHp(BULAN, salesA, {
      peserta: [
        { id: salesA, nama: "Sales A" },
        { id: salesB, nama: "Sales B" },
      ],
      target: JSON.stringify({ [salesA]: { [BULAN]: 100_000 }, [salesB]: { [BULAN]: 100_000 } }),
      aturan: { tampilkanNama: true },
      hariIni: HARI_INI,
    });
    // Resmi (dengan konsi) A 100,7% di atas B 70%. Di HP A 59,5% — di bawah B.
    expect(baris).toEqual([
      { peringkat: 1, posisi: 1, nama: "Sales B", persen: 70, omzet: null, pcsKonsi: null, adaTarget: true, diriSendiri: false },
      { peringkat: 2, posisi: 2, nama: "Sales A", persen: 59.5, omzet: 59_500, pcsKonsi: 4, adaTarget: true, diriSendiri: true },
    ]);
    bersih(baris, ["41237", "100737", "100.7"]);
  });

  it("target saya: total, kategori, dan barang dalam rupiah tanpa konsi; pcs tetap menghitung konsi", async () => {
    const r = await targetSayaHp(salesA, BULAN, HARI_INI);
    expect(r.omzet).toBe(59_500);
    expect(r.baris.map((b) => b.scope)).toEqual(["KATEGORI", "BARANG", "BARANG"]);
    const kat = r.baris.find((b) => b.scope === "KATEGORI")!;
    expect(kat).toMatchObject({ measure: "NILAI", tanpaKonsi: true, target: 200_000, capai: 59_500, kurang: 140_500 });
    const nilaiKonsi = r.baris.find((b) => b.kunci === `BARANG:${i2}`)!;
    expect(nilaiKonsi).toMatchObject({ measure: "NILAI", tanpaKonsi: true, capai: 0, kurang: 50_000 });
    const pcs = r.baris.find((b) => b.kunci === `BARANG:${i1}`)!;
    expect(pcs).toMatchObject({ measure: "PCS", tanpaKonsi: false, capai: 6 });

    // Target total dirakit halaman dari `omzet` yang sama.
    const total = { omzet: r.omzet, kemajuan: kemajuanTarget(100_000, r.omzet, HARI_INI) };
    expect(total.kemajuan).toMatchObject({ capai: 59_500, persen: 60, sisa: 40_500 });
    bersih({ ...r, total }, ["41237", "100737", "41236", "41238"]);
  });

  it("toko menurun: tanpa rupiah; toko dengan nilai konsi tanpa rasio, toko lain tetap 'turun X%'", async () => {
    const hp = await tokoMenurunHp(
      [
        { storeId: tokoTurun, nama: "Toko T" },
        { storeId: tokoKonsi, nama: "Toko K" },
        { storeId: tokoPutus, nama: "Toko P" },
        { storeId: tokoCampur, nama: "Toko M" },
        { storeId: tokoVan, nama: "Toko V" },
      ],
      HARI_INI,
    );
    // Yang punya rasio dulu, lalu yang tanpa rasio menurut nama.
    expect(hp.map((m) => m.storeId)).toEqual([tokoVan, tokoCampur, tokoTurun]);
    for (const m of hp) expect(m).toMatchObject({ alasan: "NILAI_TURUN", nilai90: null, nilai90Sebelumnya: null });
    expect(hp[0].rasioNilai).toBe(0.2501);
    expect(persenTurun(hp[0])).toBe(75);
    // Konsi saja (T) dan campuran konsi + van (M): tanpa angka di HP.
    expect(hp[1].rasioNilai).toBeNull();
    expect(hp[2].rasioNilai).toBeNull();
    expect(persenTurun(hp[1])).toBeNull();
    expect(persenTurun(hp[2])).toBeNull();
    bersih(hp, ["21150", "110040", "60013", "50027", "11119", "10031", "80012", "40009", "40003", "0.1875", "0.1922"]);
  });
});
