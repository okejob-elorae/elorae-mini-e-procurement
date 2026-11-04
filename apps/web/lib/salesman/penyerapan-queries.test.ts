import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { dariSpgToko, penyerapanToko } from "./penyerapan-queries";

/*
 * Penyerapan per artikel terhadap basis data uji:
 *   - toko PUTUS yang punya buku stok (SPG): TERIMA/JUAL/RETUR_PEMBELI, satu
 *     barang yang sudah di rak sejak sebelum periode dan tidak laku;
 *   - toko konsinyasi tanpa buku: titipan + laporan laku bulanan;
 *   - toko konsinyasi tanpa laporan laku: belum ada data;
 *   - toko putus tanpa buku: tidak melaporkan penjualan, daftar kosong.
 * Ditambah "Dari SPG": barang dicari dan permintaan yang masih terbuka.
 *
 * Semua baris milik data buatan tes pada tahun lampau yang acak; teardown hanya
 * lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const TAHUN = 2004 + Math.floor(Math.random() * 16);
const tgl = (bulan: number, hari: number) => new Date(`${TAHUN}-${String(bulan).padStart(2, "0")}-${String(hari).padStart(2, "0")}T10:00:00+07:00`);
/** 15 Juni: periode 3 bulan = 16 Maret – 15 Juni. */
const HARI_INI = tgl(6, 15);
const HARGA_KONSI = 12_345;

d("penyerapan per artikel (test bed only)", () => {
  let uomId = "";
  let salesId = "";
  let spgId = "";
  let i1 = "";
  let i2 = "";
  let tokoBuku = "";
  let tokoTitipan = "";
  let tokoTanpaLaporan = "";
  let tokoPutus = "";
  let sku1 = "";
  let orderIds: string[] = [];
  let gerakIds: string[] = [];
  let siklusIds: string[] = [];
  let dicariIds: string[] = [];
  let mintaIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    salesId = "";
    spgId = "";
    i1 = "";
    i2 = "";
    tokoBuku = "";
    tokoTitipan = "";
    tokoTanpaLaporan = "";
    tokoPutus = "";
    orderIds = [];
    gerakIds = [];
    siklusIds = [];
    dicariIds = [];
    mintaIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-SRP-${token}`, nameId: "t", nameEn: "t" } })).id;
    sku1 = `TEST-SRP-1-${token}`;
    i1 = (
      await prisma.item.create({
        data: {
          sku: sku1,
          nameId: "Kaos SRP",
          nameEn: "Tee",
          type: "FINISHED_GOOD",
          uomId,
          variants: [
            { sku: `${sku1}-HTM-M`, size: "M", color: "Hitam" },
            { sku: `${sku1}-HTM-L`, size: "L", color: "Hitam" },
          ],
        },
      })
    ).id;
    i2 = (await prisma.item.create({ data: { sku: `TEST-SRP-2-${token}`, nameId: "Kemeja SRP", nameEn: "Shirt", type: "FINISHED_GOOD", uomId } })).id;

    salesId = (await prisma.user.create({ data: { email: `srp-s-${token}@test.local`, name: `Sales SRP ${token}` } })).id;
    const toko = async (k: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `TEST-SRP-${k}-${token}`, name: `Toko ${k} ${token}`, address: "x", termsType } })).id;
    tokoBuku = await toko("B", "PUTUS");
    tokoTitipan = await toko("T", "KONSI");
    tokoTanpaLaporan = await toko("N", "KONSI");
    tokoPutus = await toko("P", "PUTUS");
    spgId = (await prisma.user.create({ data: { email: `srp-g-${token}@test.local`, name: `SPG SRP ${token}`, assignedStoreId: tokoBuku } })).id;

    const gerak = async (itemId: string, variantSku: string, qty: number, kind: string, createdAt: Date) => {
      gerakIds.push(
        (await prisma.storeStockMovement.create({ data: { storeId: tokoBuku, itemId, variantSku, qty, kind: kind as never, createdById: spgId, createdAt } })).id,
      );
    };
    // Kemeja sudah di rak sejak Januari (sebelum periode) dan tidak laku.
    await gerak(i2, "", 5, "TERIMA", tgl(1, 5));
    await gerak(i1, `${sku1}-HTM-M`, 10, "TERIMA", tgl(4, 3));
    await gerak(i1, `${sku1}-HTM-L`, 10, "TERIMA", tgl(4, 3));
    await gerak(i1, `${sku1}-HTM-M`, -9, "JUAL", tgl(5, 1));
    await gerak(i1, `${sku1}-HTM-M`, 1, "RETUR_PEMBELI", tgl(5, 2));
    await gerak(i1, `${sku1}-HTM-L`, -2, "JUAL", tgl(5, 3));

    // Konsinyasi tanpa buku: 8 kemeja disetujui April, laporan Mei laku 3.
    const konsi = async (storeId: string) => {
      const o = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `TEST-SRP-${token}-${storeId.slice(-4)}`,
          storeId,
          salesmanId: salesId,
          status: "APPROVED",
          orderType: "KONSI",
          approvedAt: tgl(4, 2),
          subtotal: 8 * HARGA_KONSI,
          total: 8 * HARGA_KONSI,
          lines: { create: [{ itemId: i2, productName: "Kemeja", qty: 8, unitPrice: HARGA_KONSI, lineTotal: 8 * HARGA_KONSI }] },
        },
      });
      orderIds.push(o.id);
    };
    await konsi(tokoTitipan);
    await konsi(tokoTanpaLaporan);
    siklusIds.push(
      (
        await prisma.consignmentCycle.create({
          data: {
            noKonsi: `TEST-SRP-KNS-${token}`,
            storeId: tokoTitipan,
            periodYear: TAHUN,
            periodMonth: 5,
            sold: { create: [{ itemId: i2, itemName: "Kemeja", qty: 3, price: HARGA_KONSI, amount: 3 * HARGA_KONSI }] },
          },
        })
      ).id,
    );

    // Dari SPG: barang dicari (dua kali kaos M, sekali teks bebas, satu di luar periode).
    const cari = async (x: { itemId?: string; variantSku?: string; description: string; qty: number; createdAt: Date }) => {
      dicariIds.push((await prisma.lostSale.create({ data: { storeId: tokoBuku, userId: spgId, ...x } })).id);
    };
    await cari({ itemId: i1, variantSku: `${sku1}-HTM-M`, description: "kaos hitam M", qty: 1, createdAt: tgl(5, 10) });
    await cari({ itemId: i1, variantSku: `${sku1}-HTM-M`, description: "kaos hitam M", qty: 1, createdAt: tgl(5, 20) });
    await cari({ description: "Topi merah", qty: 3, createdAt: tgl(6, 1) });
    await cari({ description: "Topi merah lama", qty: 9, createdAt: tgl(1, 1) });
    for (const status of ["BARU", "DIPROSES", "SELESAI"] as const) {
      mintaIds.push((await prisma.stockRequest.create({ data: { storeId: tokoBuku, requestedById: spgId, status } })).id);
    }
  });

  afterAll(async () => {
    await prisma.stockRequest.deleteMany({ where: { id: { in: seededIds(mintaIds) } } });
    await prisma.lostSale.deleteMany({ where: { id: { in: seededIds(dicariIds) } } });
    await prisma.storeStockMovement.deleteMany({ where: { id: { in: seededIds(gerakIds) } } });
    await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklusIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId, spgId].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoBuku, tokoTitipan, tokoTanpaLaporan, tokoPutus].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("toko ber-buku (walau putus): masuk, laku bersih, sisa per ukuran; urutan tindakan", async () => {
    const r = (await penyerapanToko(tokoBuku, 3, HARI_INI))!;
    expect(r).toMatchObject({ sumber: "BUKU_TOKO", adaDataLaku: true, jenisToko: "PUTUS" });
    expect(r.artikel.map((a) => a.itemId)).toEqual([i1, i2]);

    const kaos = r.artikel[0];
    expect(kaos).toMatchObject({ masuk: 20, laku: 10, sisa: 10, persen: 50, status: "CEPAT", saran: "ISI_ULANG" });
    const m = kaos.varian.find((v) => v.variantSku === `${sku1}-HTM-M`)!;
    const l = kaos.varian.find((v) => v.variantSku === `${sku1}-HTM-L`)!;
    // Laku bersih M = 9 jual − 1 kembali.
    expect(m).toMatchObject({ label: "Hitam · M", masuk: 10, laku: 8, sisa: 2, persen: 80, status: "CEPAT", saran: "ISI_ULANG", saranQty: 2 });
    expect(l).toMatchObject({ masuk: 10, laku: 2, sisa: 8, persen: 20, status: "NORMAL", saran: null });

    const kemeja = r.artikel[1];
    expect(kemeja).toMatchObject({ awal: 5, masuk: 0, laku: 0, sisa: 5, persen: 0, status: "LAMBAT", saran: "JANGAN_KIRIM" });
    expect(kemeja.umurHari).toBeGreaterThan(150);
    expect(r.ringkas).toMatchObject({ masuk: 20, laku: 10, sisa: 15, isiUlang: 1, janganKirim: 1 });
  });

  it("konsinyasi tanpa buku: titipan + laporan laku, tanpa rupiah", async () => {
    const r = (await penyerapanToko(tokoTitipan, 3, HARI_INI))!;
    expect(r).toMatchObject({ sumber: "TITIPAN", adaDataLaku: true, jenisToko: "KONSI" });
    expect(r.artikel).toHaveLength(1);
    expect(r.artikel[0]).toMatchObject({ itemId: i2, masuk: 8, laku: 3, sisa: 5, awal: 0, persen: 38, status: "NORMAL" });
    expect(JSON.stringify(r)).not.toContain(String(HARGA_KONSI));
  });

  it("konsinyasi tanpa laporan laku di periode: belum ada data, tanpa saran", async () => {
    const r = (await penyerapanToko(tokoTanpaLaporan, 3, HARI_INI))!;
    expect(r).toMatchObject({ sumber: "TITIPAN", adaDataLaku: false });
    expect(r.artikel[0]).toMatchObject({ masuk: 8, status: "BELUM_ADA_DATA", saran: null });
  });

  it("putus tanpa buku: toko tidak melaporkan penjualan — tidak ada yang dikarang", async () => {
    const r = (await penyerapanToko(tokoPutus, 3, HARI_INI))!;
    expect(r).toMatchObject({ sumber: "TANPA_LAPORAN", adaDataLaku: false, artikel: [], jumlahArtikel: 0 });
    expect(await penyerapanToko(`tidak-ada-${token}`, 3, HARI_INI)).toBeNull();
  });

  it("dari SPG: barang dicari teratas dalam periode, permintaan terbuka dihitung", async () => {
    const r = await dariSpgToko(tokoBuku, 3, HARI_INI);
    expect(r.adaSpg).toBe(true);
    expect(r.permintaanTerbuka).toBe(2);
    expect(r.dicari.map((x) => ({ nama: x.nama, varian: x.varian, qty: x.qty, kali: x.kali }))).toEqual([
      { nama: "Topi merah", varian: null, qty: 3, kali: 1 },
      { nama: "Kaos SRP", varian: "Hitam · M", qty: 2, kali: 2 },
    ]);

    const kosong = await dariSpgToko(tokoPutus, 3, HARI_INI);
    expect(kosong).toEqual({ adaSpg: false, dicari: [], permintaanTerbuka: 0 });
  });
});
