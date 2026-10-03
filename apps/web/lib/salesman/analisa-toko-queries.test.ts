import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { analisaToko } from "./analisa-toko-queries";

/*
 * "Analisa toko" terhadap basis data uji: toko putus (kiriman berdiskon, baris
 * bonus, van), toko konsinyasi berbuku (SPG menjual, pembeli mengembalikan),
 * toko konsinyasi tanpa buku (laporan laku per siklus), dan toko tanpa riwayat.
 * Yang dipasak: pcs dan rupiah per kategori, laku vs terkirim, barang lambat,
 * dan bahwa toko konsinyasi tidak pernah membawa rupiah.
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
/** 15 Juni: periode 3 bulan = 16 Maret – 15 Juni, pembanding = 16 Desember – 15 Maret. */
const HARI_INI = tgl(6, 15);
const HARGA_KONSI = 12_345;

d("analisa toko (test bed only)", () => {
  let uomId = "";
  let userId = "";
  let katKaos = "";
  let katKemeja = "";
  let i1 = "";
  let i2 = "";
  let i3 = "";
  let tokoP = "";
  let tokoK1 = "";
  let tokoK2 = "";
  let tokoKosong = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let vanIds: string[] = [];
  let gerakIds: string[] = [];
  let siklusIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    userId = "";
    katKaos = "";
    katKemeja = "";
    i1 = "";
    i2 = "";
    i3 = "";
    tokoP = "";
    tokoK1 = "";
    tokoK2 = "";
    tokoKosong = "";
    orderIds = [];
    deliveryIds = [];
    vanIds = [];
    gerakIds = [];
    siklusIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-AT-${token}`, nameId: "t", nameEn: "t" } })).id;
    katKaos = (await prisma.itemCategory.create({ data: { code: `AT-KAOS-${token}`, name: `Kaos ${token}` } })).id;
    katKemeja = (await prisma.itemCategory.create({ data: { code: `AT-KMJ-${token}`, name: `Kemeja ${token}` } })).id;
    const sku1 = `TEST-AT-1-${token}`;
    i1 = (
      await prisma.item.create({
        data: {
          sku: sku1,
          nameId: "Kaos AT",
          nameEn: "Tee",
          type: "FINISHED_GOOD",
          uomId,
          categoryId: katKaos,
          variants: [
            { sku: `${sku1}-HTM-M`, size: "M", color: "Hitam" },
            { sku: `${sku1}-PTH-L`, size: "L", color: "Putih" },
          ],
        },
      })
    ).id;
    i2 = (
      await prisma.item.create({
        data: { sku: `TEST-AT-2-${token}`, nameId: "Kemeja AT", nameEn: "Shirt", type: "FINISHED_GOOD", uomId, categoryId: katKemeja },
      })
    ).id;
    i3 = (await prisma.item.create({ data: { sku: `TEST-AT-3-${token}`, nameId: "Topi AT", nameEn: "Cap", type: "FINISHED_GOOD", uomId } })).id;

    userId = (await prisma.user.create({ data: { email: `at-${token}@test.local`, name: `Sales AT ${token}` } })).id;
    const toko = async (k: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `TEST-AT-${k}-${token}`, name: `Toko ${k} ${token}`, address: "x", termsType } })).id;
    tokoP = await toko("P", "PUTUS");
    tokoK1 = await toko("K1", "KONSI");
    tokoK2 = await toko("K2", "KONSI");
    tokoKosong = await toko("E", "PUTUS");

    let n = 0;
    const pesanan = async (storeId: string, x: object, lines: object[]) => {
      n += 1;
      const o = await prisma.fieldSalesOrder.create({
        data: { orderNo: `TEST-AT-${token}-${n}`, storeId, salesmanId: userId, subtotal: 0, total: 0, ...x, lines: { create: lines as never } },
        include: { lines: { orderBy: { productName: "asc" } } },
      });
      orderIds.push(o.id);
      return o;
    };
    const kiriman = async (orderId: string, deliveredAt: Date, total: number, lines: object[]) => {
      n += 1;
      deliveryIds.push(
        (
          await prisma.fieldSalesDelivery.create({
            data: {
              docNo: `TEST-AT-DLV-${token}-${n}`,
              orderId,
              deliveredAt,
              deliveredById: userId,
              invoiceDate: deliveredAt,
              dueDate: deliveredAt,
              subtotal: total,
              total,
              lines: { create: lines as never },
            },
          })
        ).id,
      );
    };
    const gerak = async (storeId: string, itemId: string, variantSku: string, qty: number, kind: string, createdAt: Date) => {
      gerakIds.push(
        (await prisma.storeStockMovement.create({ data: { storeId, itemId, variantSku, qty, kind: kind as never, createdById: userId, createdAt } })).id,
      );
    };

    // ── Toko putus ─────────────────────────────────────────────────────────
    const putus = await pesanan(
      tokoP,
      { status: "APPROVED", orderType: "PUTUS", approvedAt: tgl(4, 1), subtotal: 100_000, orderDiscountAmount: 1_000, total: 99_000 },
      [
        { itemId: i1, variantSku: `${sku1}-HTM-M`, productName: "A kaos", qty: 6, unitPrice: 10_000, lineTotal: 60_000 },
        { itemId: i1, variantSku: `${sku1}-HTM-M`, productName: "B kaos bonus", qty: 1, unitPrice: 0, lineTotal: 0, isBonus: true },
        { itemId: i2, productName: "C kemeja", qty: 14, unitPrice: 10_000, lineTotal: 140_000 },
      ],
    );
    const [lKaos, lBonus, lKemeja] = putus.lines;
    // Periode ini (10 April): 6 kaos M + bonus + 4 kemeja, total 99.000.
    await kiriman(putus.id, tgl(4, 10), 99_000, [
      { orderLineId: lKaos.id, itemId: i1, variantSku: `${sku1}-HTM-M`, productName: "A kaos", qty: 6, unitPrice: 10_000, lineTotal: 60_000 },
      { orderLineId: lBonus.id, itemId: i1, variantSku: `${sku1}-HTM-M`, productName: "B kaos bonus", qty: 1, unitPrice: 0, lineTotal: 0 },
      { orderLineId: lKemeja.id, itemId: i2, productName: "C kemeja", qty: 4, unitPrice: 10_000, lineTotal: 40_000 },
    ]);
    // Pembanding (10 Februari): 10 kemeja.
    await kiriman(putus.id, tgl(2, 10), 100_000, [
      { orderLineId: lKemeja.id, itemId: i2, productName: "C kemeja", qty: 10, unitPrice: 10_000, lineTotal: 100_000 },
    ]);
    // Van ke toko putus (5 Mei): 2 topi.
    n += 1;
    vanIds.push(
      (
        await prisma.vanSale.create({
          data: {
            docNo: `TEST-AT-VAN-${token}-${n}`,
            salesmanId: userId,
            storeId: tokoP,
            subtotal: 8_000,
            total: 8_000,
            amountPaid: 8_000,
            changeAmount: 0,
            createdAt: tgl(5, 5),
            lines: { create: [{ itemId: i3, productName: "Topi", qty: 2, unitPrice: 4_000, unitCost: 0, lineTotal: 8_000 }] },
          },
        })
      ).id,
    );

    // ── Toko konsinyasi berbuku ────────────────────────────────────────────
    await pesanan(
      tokoK1,
      { status: "APPROVED", orderType: "KONSI", approvedAt: tgl(4, 2), subtotal: 10 * HARGA_KONSI, total: 10 * HARGA_KONSI },
      [{ itemId: i1, variantSku: `${sku1}-HTM-M`, productName: "A kaos", qty: 10, unitPrice: HARGA_KONSI, lineTotal: 10 * HARGA_KONSI }],
    );
    await gerak(tokoK1, i1, `${sku1}-HTM-M`, 10, "TERIMA", tgl(4, 3));
    await gerak(tokoK1, i1, `${sku1}-HTM-M`, -6, "JUAL", tgl(5, 1));
    await gerak(tokoK1, i1, `${sku1}-HTM-M`, 1, "RETUR_PEMBELI", tgl(5, 2));
    // Kemeja sudah di toko sejak Januari dan tidak laku sama sekali.
    await gerak(tokoK1, i2, "", 5, "TERIMA", tgl(1, 5));

    // ── Toko konsinyasi tanpa buku ─────────────────────────────────────────
    await pesanan(
      tokoK2,
      { status: "APPROVED", orderType: "KONSI", approvedAt: tgl(4, 2), subtotal: 8 * HARGA_KONSI, total: 8 * HARGA_KONSI },
      [{ itemId: i2, productName: "C kemeja", qty: 8, unitPrice: HARGA_KONSI, lineTotal: 8 * HARGA_KONSI }],
    );
    const siklus = await prisma.consignmentCycle.create({
      data: {
        noKonsi: `TEST-AT-KNS-${token}`,
        storeId: tokoK2,
        periodYear: TAHUN,
        periodMonth: 5,
        sold: { create: [{ itemId: i2, itemName: "Kemeja", qty: 3, price: HARGA_KONSI, amount: 3 * HARGA_KONSI }] },
      },
    });
    siklusIds.push(siklus.id);
  });

  afterAll(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { id: { in: seededIds(gerakIds) } } });
    await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklusIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(vanIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoP, tokoK1, tokoK2, tokoKosong].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([i1, i2, i3].filter(Boolean)) } } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: seededIds([katKaos, katKemeja].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("toko putus: pcs dan rupiah per kategori, bonus tidak dihitung, diskon pesanan ikut", async () => {
    const r = (await analisaToko(tokoP, 3, HARI_INI))!;
    expect(r.dasar).toBe("BELI");
    expect(r.laku).toBeNull();
    expect(r.kosong).toBe(false);
    const a = r.analisa;
    expect(a.totalPcs).toBe(12);
    expect(a.totalPcsSebelumnya).toBe(10);
    expect(a.totalNilai).toBe(107_000);
    const kaos = a.kategori.find((k) => k.kategoriId === katKaos)!;
    const kemeja = a.kategori.find((k) => k.kategoriId === katKemeja)!;
    const tanpa = a.kategori.find((k) => k.kategoriId === null)!;
    expect(kaos).toMatchObject({ nama: `Kaos ${token}`, pcs: 6, pcsSebelumnya: 0, persen: 50, arah: "baru" });
    expect(kemeja).toMatchObject({ pcs: 4, pcsSebelumnya: 10, persen: 33, persenSebelumnya: 100, arah: "turun" });
    expect(tanpa).toMatchObject({ pcs: 2, nilai: 8_000, arah: "baru" });
    // Total kiriman 99.000 dibagi 60.000 : 40.000 → 59.400 + 39.600.
    expect(kaos.nilai).toBe(59_400);
    expect(kemeja.nilai).toBe(39_600);
    expect(a.artikel[0]).toMatchObject({ itemId: i1, pcs: 6, ukuran: [{ label: "M", pcs: 6, persen: 100 }], warna: [{ label: "Hitam", pcs: 6, persen: 100 }] });
    expect(r.wawasan[0]).toEqual({ kode: "KATEGORI_UTAMA", kategori: `Kaos ${token}`, persen: 50, persenSebelumnya: 0 });
  });

  it("toko konsinyasi berbuku: laku bersih dari buku, kemeja lambat, tanpa rupiah", async () => {
    const r = (await analisaToko(tokoK1, 3, HARI_INI))!;
    expect(r.dasar).toBe("LAKU");
    expect(r.analisa.totalPcs).toBe(5);
    expect(r.analisa.totalNilai).toBeNull();
    expect(r.analisa.kategori.every((k) => k.nilai === null)).toBe(true);
    expect(r.laku).toMatchObject({ sumber: "BUKU_TOKO", adaDataLaku: true, terkirimPcs: 10, lakuPcs: 5, sisaPcs: 10, persenLakuDariKirim: 50, jumlahLambat: 1 });
    expect(r.laku!.cepat).toEqual([{ itemId: i1, nama: "Kaos AT", sku: `TEST-AT-1-${token}`, laku: 5, sisa: 5, persen: 50 }]);
    expect(r.laku!.lambat[0]).toMatchObject({ itemId: i2, sisa: 5 });
    expect(r.analisa.artikel[0].ukuran).toEqual([{ label: "M", pcs: 5, persen: 100 }]);
    expect(r.wawasan.slice(0, 2)).toEqual([
      { kode: "LAKU_DARI_KIRIM", persen: 50, laku: 5, terkirim: 10 },
      { kode: "BELUM_LAKU", jumlah: 1 },
    ]);
    // Harga konsinyasi tidak pernah keluar dari analisa.
    expect(JSON.stringify(r)).not.toContain(String(HARGA_KONSI));
  });

  it("toko konsinyasi tanpa buku: laku dari laporan siklus", async () => {
    const r = (await analisaToko(tokoK2, 3, HARI_INI))!;
    expect(r.dasar).toBe("LAKU");
    expect(r.laku).toMatchObject({ sumber: "TITIPAN", terkirimPcs: 8, lakuPcs: 3, persenLakuDariKirim: 38 });
    expect(r.analisa.totalPcs).toBe(3);
    expect(r.analisa.tren.find((t) => t.bulan === `${TAHUN}-05`)?.pcs).toBe(3);
    expect(JSON.stringify(r)).not.toContain(String(HARGA_KONSI));
  });

  it("periode lebih panjang memasukkan bulan pembanding sebelumnya", async () => {
    const r = (await analisaToko(tokoP, 6, HARI_INI))!;
    expect(r.analisa.totalPcs).toBe(22);
    expect(r.analisa.tren).toHaveLength(6);
  });

  it("toko tanpa riwayat: kosong, tanpa wawasan", async () => {
    const r = (await analisaToko(tokoKosong, 3, HARI_INI))!;
    expect(r.kosong).toBe(true);
    expect(r.wawasan).toEqual([]);
    expect(await analisaToko(`tidak-ada-${token}`, 3, HARI_INI)).toBeNull();
  });
});
