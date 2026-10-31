import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { jumlahkanPenjualan, susunPenjualanSalesman } from "./dasbor";
import { penjualanSalesman } from "./queries";
import { capaianRinciSales, targetSaya } from "./target-rinci-queries";
import { TANPA_KATEGORI } from "./target-rinci";

/*
 * Capaian per kategori/barang terhadap basis data uji. Yang dipasak: jumlah
 * per kategori SAMA PERSIS dengan omzet "Bulan ini" di beranda HP, dihitung
 * dengan fungsi beranda sendiri (`penjualanSalesman` → `susunPenjualanSalesman`
 * → `jumlahkanPenjualan`), pada data putus (kiriman berdiskon, baris bonus,
 * kiriman tanpa baris), konsi (LAKU di toko konsinyasi yang ia pegang —
 * transfer disetujui/menunggu/ditolak tidak dihitung), dan van — termasuk
 * baris di luar bulan, sesudah hari ini, dan milik sales lain.
 *
 * Semua baris milik pengguna buatan tes pada bulan lampau yang acak; teardown
 * hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const TAHUN = acak(2003, 2019);
const BL = acak(2, 11);
const BULAN = `${TAHUN}-${String(BL).padStart(2, "0")}`;
const tgl = (hari: number, jam = "10:00", bulan = BULAN) => new Date(`${bulan}-${String(hari).padStart(2, "0")}T${jam}:00+07:00`);
const HARI_INI = tgl(20, "20:00");

/** Omzet "Bulan ini" persis seperti `app/pwa/page.tsx` menghitungnya. */
async function omzetBeranda(salesmanId: string, hariIni: Date) {
  const sejak = new Date(Date.parse(`${kunciHariWib(hariIni)}T00:00:00+07:00`) - 60 * 86_400_000);
  const jual = await penjualanSalesman(salesmanId, sejak);
  const bulan = kunciHariWib(hariIni).slice(0, 7);
  return jumlahkanPenjualan(susunPenjualanSalesman(jual, hariIni, 60).filter((x) => x.tanggal.startsWith(bulan)));
}

const sen = (n: number) => Math.round(n * 100);

d("target rinci — capaian per kategori/barang (test bed only)", () => {
  let uomId = "";
  let salesId = "";
  let lainId = "";
  let tokoId = "";
  let tokoKonsi = "";
  let katA = "";
  let katB = "";
  let i1 = "";
  let i2 = "";
  let i3 = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let vanIds: string[] = [];
  let targetIds: string[] = [];
  let gerakIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    salesId = "";
    lainId = "";
    tokoId = "";
    tokoKonsi = "";
    katA = "";
    katB = "";
    i1 = "";
    i2 = "";
    i3 = "";
    orderIds = [];
    deliveryIds = [];
    vanIds = [];
    targetIds = [];
    gerakIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-TR-${token}`, nameId: "t", nameEn: "t" } })).id;
    katA = (await prisma.itemCategory.create({ data: { code: `TR-A-${token}`, name: `Kaos ${token}` } })).id;
    katB = (await prisma.itemCategory.create({ data: { code: `TR-B-${token}`, name: `Kemeja ${token}` } })).id;
    const barang = async (k: string, categoryId: string | null) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-TR-${k}-${token}`, nameId: `Barang ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId, categoryId },
        })
      ).id;
    i1 = await barang("1", katA);
    i2 = await barang("2", katB);
    i3 = await barang("3", null);

    salesId = (await prisma.user.create({ data: { email: `tr-${token}@test.local`, name: `Sales TR ${token}` } })).id;
    lainId = (await prisma.user.create({ data: { email: `tr-lain-${token}@test.local`, name: `Lain TR ${token}` } })).id;
    tokoId = (
      await prisma.store.create({ data: { code: `TEST-TR-${token}`, name: "Toko TR", address: "x", termsType: "PUTUS" } })
    ).id;
    // Toko konsinyasi yang dipegang sales ini; margin kosong → harga di toko = harga Elorae.
    tokoKonsi = (
      await prisma.store.create({
        data: { code: `TR-K-${token}`, name: "Toko TR konsi", address: "x", termsType: "KONSI", salesmanId: salesId },
      })
    ).id;

    let n = 0;
    const pesanan = async (x: object, lines: object[]) => {
      n += 1;
      const o = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `TEST-TR-${token}-${n}`,
          storeId: tokoId,
          salesmanId: salesId,
          subtotal: 0,
          total: 0,
          ...x,
          lines: { create: lines as never },
        },
        include: { lines: { orderBy: { productName: "asc" } } },
      });
      orderIds.push(o.id);
      return o;
    };
    const kiriman = async (orderId: string, deliveredAt: Date, total: number, discountAmount: number, lines: object[]) => {
      n += 1;
      const dl = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-TR-DLV-${token}-${n}`,
          orderId,
          deliveredAt,
          deliveredById: salesId,
          invoiceDate: deliveredAt,
          dueDate: deliveredAt,
          subtotal: total,
          discountAmount,
          total,
          lines: { create: lines as never },
        },
      });
      deliveryIds.push(dl.id);
    };
    const van = async (salesmanId: string, createdAt: Date, total: number, lines: object[]) => {
      n += 1;
      const v = await prisma.vanSale.create({
        data: {
          docNo: `TEST-TR-VAN-${token}-${n}`,
          salesmanId,
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

    // Putus: 3 kaos (diskon baris 1.000), 2 kemeja, 1 kaos bonus; diskon pesanan.
    const putus = await pesanan(
      { status: "APPROVED", orderType: "PUTUS", approvedAt: tgl(3), subtotal: 60_000, orderDiscountAmount: 2_000, total: 57_000 },
      [
        { itemId: i1, productName: "A kaos", qty: 3, unitPrice: 10_000, lineTotal: 30_000, discountAmount: 1_000 },
        { itemId: i2, productName: "B kemeja", qty: 2, unitPrice: 15_000, lineTotal: 30_000 },
        { itemId: i1, productName: "C kaos bonus", qty: 1, unitPrice: 0, lineTotal: 0, isBonus: true },
      ],
    );
    const [lKaos, lKemeja, lBonus] = putus.lines;
    // Kiriman 1 (tanggal 5): 2 kaos + 2 kemeja + bonus, diskon baris 666,67 + bagian diskon pesanan 1.234,56.
    await kiriman(putus.id, tgl(5), 48_098.77, 1_234.56, [
      { orderLineId: lKaos.id, itemId: i1, productName: "A kaos", qty: 2, unitPrice: 10_000, lineTotal: 20_000, discountAmount: 666.67 },
      { orderLineId: lKemeja.id, itemId: i2, productName: "B kemeja", qty: 2, unitPrice: 15_000, lineTotal: 30_000 },
      { orderLineId: lBonus.id, itemId: i1, productName: "C kaos bonus", qty: 1, unitPrice: 0, lineTotal: 0 },
    ]);
    // Kiriman tanpa baris (data lama): totalnya tetap omzet, masuk "tanpa kategori".
    await kiriman(putus.id, tgl(6), 777.77, 0, []);
    // Kiriman 2 sesudah hari ini (tanggal 25): belum dihitung beranda.
    await kiriman(putus.id, tgl(25), 9_000, 0, [
      { orderLineId: lKaos.id, itemId: i1, productName: "A kaos", qty: 1, unitPrice: 10_000, lineTotal: 10_000, discountAmount: 333.33 },
    ]);
    // Kiriman bulan lalu, 23.30 WIB hari terakhir: bukan bulan ini.
    await kiriman(putus.id, new Date(new Date(`${BULAN}-01T00:00:00+07:00`).getTime() - 30 * 60_000), 5_000, 0, [
      { orderLineId: lKemeja.id, itemId: i2, productName: "B kemeja", qty: 1, unitPrice: 5_000, lineTotal: 5_000 },
    ]);

    // Transfer konsi disetujui tanggal 9 (72.500): bukan omzet. Yang laku tanggal 10:
    // 4 polos × 10.000 + 1 kaos × 12.500 = 52.500.
    await pesanan({ storeId: tokoKonsi, status: "APPROVED", orderType: "KONSI", approvedAt: tgl(9), subtotal: 72_500, total: 72_500 }, [
      { itemId: i3, productName: "C polos", qty: 6, unitPrice: 10_000, lineTotal: 60_000 },
      { itemId: i1, productName: "A kaos", qty: 1, unitPrice: 12_500, lineTotal: 12_500 },
    ]);
    for (const [itemId, qty] of [
      [i3, -4],
      [i1, -1],
    ] as const) {
      const g = await prisma.storeStockMovement.create({
        data: { storeId: tokoKonsi, itemId, variantSku: "", qty, kind: "JUAL", createdById: salesId, createdAt: tgl(10) },
      });
      gerakIds.push(g.id);
    }
    // Konsi menunggu dan ditolak: tidak dihitung.
    await pesanan({ status: "PENDING_APPROVAL", orderType: "KONSI", subtotal: 99_000, total: 99_000 }, [
      { itemId: i3, productName: "C polos", qty: 9, unitPrice: 11_000, lineTotal: 99_000 },
    ]);
    await pesanan({ status: "REJECTED", orderType: "KONSI", approvedAt: tgl(11), subtotal: 88_000, total: 88_000 }, [
      { itemId: i3, productName: "C polos", qty: 8, unitPrice: 11_000, lineTotal: 88_000 },
    ]);

    // Van tanggal 12, dan 00.30 WIB tanggal 1 (masih tanggal 31 menurut UTC).
    await van(salesId, tgl(12), 24_999.99, [
      { itemId: i2, productName: "B kemeja", qty: 1, unitPrice: 15_000, unitCost: 0, lineTotal: 15_000 },
      { itemId: i3, productName: "C polos", qty: 2, unitPrice: 5_000, unitCost: 0, lineTotal: 9_999.99 },
    ]);
    await van(salesId, tgl(1, "00:30"), 3_000, [
      { itemId: i3, productName: "C polos", qty: 1, unitPrice: 3_000, unitCost: 0, lineTotal: 3_000 },
    ]);
    // Van sales lain: tidak pernah ikut.
    await van(lainId, tgl(12), 70_000, [
      { itemId: i1, productName: "A kaos", qty: 7, unitPrice: 10_000, unitCost: 0, lineTotal: 70_000 },
    ]);

    targetIds = [
      (await prisma.salesTarget.create({
        data: { salesmanId: salesId, month: BULAN, scope: "KATEGORI", refId: katA, measure: "PCS", value: 6, createdById: salesId },
      })).id,
      (await prisma.salesTarget.create({
        data: { salesmanId: salesId, month: BULAN, scope: "BARANG", refId: i3, measure: "NILAI", value: 100_000, createdById: salesId },
      })).id,
    ];
  });

  afterAll(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { id: { in: seededIds(gerakIds) } } });
    await prisma.salesTarget.deleteMany({ where: { id: { in: seededIds(targetIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(vanIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoId, tokoKonsi].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2, i3].filter(Boolean)) } } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: seededIds([katA, katB].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId, lainId].filter(Boolean)) } } });
  });

  it("jumlah per kategori = omzet 'Bulan ini' di beranda, per kanal pun sama", async () => {
    const beranda = await omzetBeranda(salesId, HARI_INI);
    const c = (await capaianRinciSales([salesId], BULAN, HARI_INI)).get(salesId)!;

    // Sanity: datanya memang mengisi ketiga kanal.
    expect(beranda.putus).toBeGreaterThan(0);
    expect(beranda.konsi).toBeGreaterThan(0);
    expect(beranda.van).toBeGreaterThan(0);

    expect(sen(c.total)).toBe(sen(beranda.total));
    expect(sen(c.kanal.putus)).toBe(sen(beranda.putus));
    expect(sen(c.kanal.konsi)).toBe(sen(beranda.konsi));
    expect(sen(c.kanal.van)).toBe(sen(beranda.van));
    const perKategori = Object.values(c.kategori).reduce((n, x) => n + sen(x.nilai), 0);
    expect(perKategori).toBe(sen(beranda.total));

    // Angka yang diharapkan, dihitung tangan: 48.098,77 + 777,77 + 52.500 + 24.999,99 + 3.000.
    expect(sen(c.total)).toBe(sen(129_376.53));
  });

  it("pcs per kategori dan per barang: bonus tidak dihitung; nilai konsi & van tepat per baris", async () => {
    const c = (await capaianRinciSales([salesId], BULAN, HARI_INI)).get(salesId)!;
    expect(c.kategori[katA].pcs).toBe(3); // 2 terkirim + 1 konsi; bonus tidak
    expect(c.kategori[katB].pcs).toBe(3); // 2 terkirim + 1 van
    expect(c.kategori[TANPA_KATEGORI].pcs).toBe(7); // konsi 4 + van 2 + van 1
    expect(c.barang[i3]).toEqual({ nilai: 52_999.99, pcs: 7 });
    expect(sen(c.barang[i1].nilai + c.barang[i2].nilai + c.barang[i3].nilai)).toBe(sen(c.total - 777.77));
  });

  it("satu kueri untuk banyak sales: sales lain terpisah, tidak bocor", async () => {
    const peta = await capaianRinciSales([salesId, lainId], BULAN, HARI_INI);
    expect(peta.get(lainId)).toMatchObject({ total: 70_000, barang: { [i1]: { nilai: 70_000, pcs: 7 } } });
    expect(sen(peta.get(salesId)!.total)).toBe(sen(129_376.53));
  });

  it("dilihat sesudah bulannya lewat: kiriman tanggal 25 ikut; bulan depan masih kosong", async () => {
    const nanti = tgl(15, "10:00", `${TAHUN}-${String(BL + 1).padStart(2, "0")}`);
    const c = (await capaianRinciSales([salesId], BULAN, nanti)).get(salesId)!;
    expect(sen(c.total)).toBe(sen(129_376.53 + 9_000));
    const depan = (await capaianRinciSales([salesId], `${TAHUN}-${String(BL + 1).padStart(2, "0")}`, HARI_INI)).get(salesId)!;
    expect(depan.total).toBe(0);
  });

  it("targetSaya: kemajuan memakai ukuran targetnya sendiri", async () => {
    const r = await targetSaya(salesId, BULAN, HARI_INI);
    const kat = r.baris.find((b) => b.scope === "KATEGORI")!;
    expect(kat).toMatchObject({ refId: katA, nama: `Kaos ${token}`, measure: "PCS" });
    expect(kat.kemajuan).toMatchObject({ target: 6, capai: 3, kurang: 3, persen: 50 });
    const brg = r.baris.find((b) => b.scope === "BARANG")!;
    expect(brg).toMatchObject({ refId: i3, nama: "Barang 3", sku: `TEST-TR-3-${token}`, tanpaKonsi: true });
    // Barang 3 terjual Rp 52.999,99 semuanya, Rp 40.000 di antaranya lewat
    // konsinyasi. Di HP target barang dalam rupiah dihitung TANPA konsinyasi —
    // nilai konsi satu barang ÷ pcs lakunya = harga satuan konsi.
    expect(brg.kemajuan).toMatchObject({ target: 100_000, capai: 12_999.99 });
    expect(kat.tanpaKonsi).toBe(false);
  });

  it("layar kantor tetap menghitung semua saluran untuk target yang sama", async () => {
    const c = (await capaianRinciSales([salesId], BULAN, HARI_INI)).get(salesId)!;
    expect(c.barang[i3].nilai).toBe(52_999.99);
    expect(c.barangKonsi[i3].nilai).toBe(40_000);
  });
});
