import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import {
  akhirBulanWib,
  bagiSebanding,
  barangTransferDiToko,
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

describe("barangTransferDiToko", () => {
  it("yang tiba saat diterima toko — yang ditolak di pintu dan yang kurang tiba tidak", () => {
    expect(barangTransferDiToko({ qty: 10, receivedQty: 7, returnedQty: 2 })).toBe(7);
    expect(barangTransferDiToko({ qty: 10, receivedQty: 0, returnedQty: 0 })).toBe(0);
  });
  it("transfer lama tanpa jumlah tiba: yang diserahkan dikurangi yang dikembalikan", () => {
    expect(barangTransferDiToko({ qty: 6, receivedQty: null, returnedQty: 0 })).toBe(6);
    expect(barangTransferDiToko({ qty: "6", receivedQty: null, returnedQty: 2 })).toBe(4);
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
  let notaId = "";
  let nomor = 0;
  let pesananIds: string[] = [];
  let barisIds: string[] = [];
  let pengirimanIds: string[] = [];
  let transferIds: string[] = [];

  beforeEach(async () => {
    notaId = "";
    pesananIds = [];
    barisIds = [];
    pengirimanIds = [];
    transferIds = [];
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
    await prisma.spgSaleReturnLine.deleteMany({ where: { saleReturn: { spgSaleId: seededId(notaId) } } });
    await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: seededId(notaId) } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: seededId(notaId) } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: seededId(notaId) }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: seededId(notaId) } });
    await prisma.storeStockTarget.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
    await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: seededId(kirimId) } });
    await prisma.consignmentShipment.deleteMany({ where: { id: seededId(kirimId) } });
    // Pesanan konsi + antarannya: cadangan, transfer, pengiriman, lalu pesanan (barisnya ikut terhapus).
    await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(barisIds) } } });
    await prisma.konsiTransfer.deleteMany({ where: { id: { in: seededIds(transferIds) } } });
    await prisma.deliveryShipment.deleteMany({ where: { id: { in: seededIds(pengirimanIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(pesananIds) } } });
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

  /**
   * Pesanan konsi yang disetujui. `cadangan` = keadaan cadangan stok barisnya
   * (null = pesanan lebih tua dari cadangan stok). Pesanan aturan baru selalu
   * RESERVED sampai dikirim; pesanan lama sudah ditandai terkirim penuh oleh
   * migrasi `20260923000000_konsi_transfer_at_shipment_completion`.
   */
  async function pesananKonsi(qty: number, lain: { terkirim?: number; disetujui: Date; cadangan: "RESERVED" | "CONSUMED" | null }) {
    nomor += 1;
    const terkirim = lain.terkirim ?? 0;
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-KONSI-${nomor}`,
        storeId: tokoId,
        salesmanId: orangId,
        orderType: "KONSI",
        status: "APPROVED",
        deliveryStatus: terkirim >= qty ? "DELIVERED" : terkirim > 0 ? "PARTIAL" : "PENDING",
        approvedAt: lain.disetujui,
        subtotal: 0,
        total: 0,
        lines: { create: [{ itemId: barangId, variantSku: "", productName: `${tag} Blus`, qty, deliveredQty: terkirim, unitPrice: 0, lineTotal: 0 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    pesananIds.push(o.id);
    barisIds.push(o.lines[0].id);
    if (lain.cadangan) {
      await prisma.stockReservation.create({
        data: { source: "FIELD_SALES_KONSI", fieldSalesLineId: o.lines[0].id, itemId: barangId, variantSku: "", qty, consumedQty: terkirim, state: lain.cadangan },
      });
    }
    return { id: o.id, lineId: o.lines[0].id };
  }

  /** Pengiriman pesanan itu; yang sudah DISERAHKAN membawa transfernya (dibuat saat bukti terima). */
  async function antaranKonsi(o: { id: string; lineId: string }, qty: number, status: "DELIVERED" | "PACKED", pada: Date) {
    nomor += 1;
    const shp = await prisma.deliveryShipment.create({
      data: {
        docNo: `${tag}-SHP-${nomor}`,
        orderId: o.id,
        method: "SALESMAN_CARRY",
        status,
        packedById: orangId,
        carriedById: orangId,
        packedAt: pada,
        deliveredAt: status === "DELIVERED" ? pada : null,
        lines: { create: [{ orderLineId: o.lineId, itemId: barangId, variantSku: "", plannedQty: qty, deliveredQty: status === "DELIVERED" ? qty : null }] },
      },
      select: { id: true },
    });
    pengirimanIds.push(shp.id);
    if (status === "DELIVERED") await transferKonsi(o, qty, shp.id, pada);
  }

  async function transferKonsi(o: { id: string; lineId: string }, qty: number, shipmentId: string | null, pada: Date) {
    nomor += 1;
    const t = await prisma.konsiTransfer.create({
      data: {
        docNo: `${tag}-TRF-${nomor}`,
        orderId: o.id,
        storeId: tokoId,
        shipmentId,
        transferredById: orangId,
        createdAt: pada,
        lines: { create: [{ orderLineId: o.lineId, itemId: barangId, variantSku: "", productName: `${tag} Blus`, qty, unitCost: 0 }] },
      },
      select: { id: true },
    });
    transferIds.push(t.id);
  }

  /**
   * Antaran aturan sekarang: transfer dibuat saat surat jalannya dibuat (`IN_TRANSIT`), lalu diterima
   * toko (`RECEIVED`, `receivedQty` = yang tiba) atau tidak jadi dikirim (`CANCELLED`). `kembali` =
   * potong yang sudah kembali ke Gudang Utama (`returnedQty`: ditolak di pintu / dibatalkan).
   */
  async function antaranSuratJalan(
    o: { id: string; lineId: string },
    qty: number,
    keadaan: { status: "IN_TRANSIT" | "RECEIVED" | "CANCELLED"; kembali?: number; tiba?: number; selesai?: Date },
    dibuat: Date,
  ) {
    nomor += 1;
    const shp = await prisma.deliveryShipment.create({
      data: {
        docNo: `${tag}-SHP-${nomor}`,
        orderId: o.id,
        method: "SALESMAN_CARRY",
        status: keadaan.status === "RECEIVED" ? "DELIVERED" : keadaan.status,
        packedById: orangId,
        carriedById: orangId,
        packedAt: dibuat,
        deliveredAt: keadaan.status === "RECEIVED" ? (keadaan.selesai ?? dibuat) : null,
        cancelledAt: keadaan.status === "CANCELLED" ? (keadaan.selesai ?? dibuat) : null,
        lines: { create: [{ orderLineId: o.lineId, itemId: barangId, variantSku: "", plannedQty: qty, deliveredQty: keadaan.status === "RECEIVED" ? (keadaan.tiba ?? qty) : null }] },
      },
      select: { id: true },
    });
    pengirimanIds.push(shp.id);
    nomor += 1;
    const t = await prisma.konsiTransfer.create({
      data: {
        docNo: `${tag}-TRF-${nomor}`,
        orderId: o.id,
        storeId: tokoId,
        shipmentId: shp.id,
        transferredById: orangId,
        createdAt: dibuat,
        status: keadaan.status,
        ...(keadaan.status === "RECEIVED" ? { receivedAt: keadaan.selesai ?? dibuat, receivedById: orangId } : {}),
        ...(keadaan.status === "CANCELLED" ? { cancelledAt: keadaan.selesai ?? dibuat, cancelledById: orangId, cancelReason: "uji" } : {}),
        lines: {
          create: [
            {
              orderLineId: o.lineId,
              itemId: barangId,
              variantSku: "",
              productName: `${tag} Blus`,
              qty,
              unitCost: 0,
              returnedQty: keadaan.kembali ?? 0,
              receivedQty: keadaan.status === "RECEIVED" ? (keadaan.tiba ?? qty) : null,
            },
          ],
        },
      },
      select: { id: true },
    });
    transferIds.push(t.id);
  }

  it("antaran surat jalan: hanya yang DITERIMA toko, sebesar yang tiba — yang di perjalanan dalam proses, yang tidak jadi dikirim dan yang ditolak di pintu tidak di toko", async () => {
    // Pesanan 20: 5 di perjalanan; 4 tidak jadi dikirim (kembali seluruhnya); 10 diantar — 2 ditolak di
    // pintu, 7 tiba, 1 kurang (hilang di jalan). Terkirim di baris pesanan = 5 + (10 − 2) = 13 → sisa 7.
    const o = await pesananKonsi(20, { terkirim: 13, disetujui: hariLalu(20), cadangan: "RESERVED" });
    await antaranSuratJalan(o, 5, { status: "IN_TRANSIT" }, hariLalu(2));
    await antaranSuratJalan(o, 4, { status: "CANCELLED", kembali: 4, selesai: hariLalu(8) }, hariLalu(9));
    await antaranSuratJalan(o, 10, { status: "RECEIVED", kembali: 2, tiba: 7, selesai: hariLalu(5) }, hariLalu(6));

    const s = await stokDiToko(tokoId, SEKARANG);
    expect(s.source).toBe("TITIPAN");
    // 7 yang tiba saja (bukan 5 + 4 + 10), bertanggal diterimanya — bukan dibuatnya surat jalan.
    expect(s.baris).toEqual([expect.objectContaining({ itemId: barangId, qty: 7, firstInAt: hariLalu(5), source: "TITIPAN" })]);

    // Isi ulang tidak mengirim ulang yang masih di jalan: sisa pesanan 7 + 5 di perjalanan.
    const n = (await nilaiStokToko([tokoId], SEKARANG)).get(tokoId)!;
    expect(n.baris).toEqual([expect.objectContaining({ itemId: barangId, qty: 7, dalamProses: 12 })]);
  });

  it("konsi tanpa SPG: barang masuk saat antaran diserahkan, sebesar antaran itu — bukan yang disetujui; sisanya dalam proses, bukan stok", async () => {
    // Contoh pemilik: pesanan 100, antaran pertama 60 sudah diserahkan, 30 sedang dikemas, 10 belum dikemas.
    const besar = await pesananKonsi(100, { terkirim: 60, disetujui: hariLalu(20), cadangan: "RESERVED" });
    await antaranKonsi(besar, 60, "DELIVERED", hariLalu(10));
    await antaranKonsi(besar, 30, "PACKED", hariLalu(2));
    // Pesanan yang baru disetujui (stok dicadangkan, belum ada pengiriman) belum ada di toko.
    await pesananKonsi(10, { disetujui: hariLalu(1), cadangan: "RESERVED" });

    const s = await stokDiToko(tokoId, SEKARANG);
    expect(s.source).toBe("TITIPAN");
    // Bertanggal transfernya (bukti terima), bukan tanggal disetujui.
    expect(s.baris).toEqual([expect.objectContaining({ itemId: barangId, qty: 60, firstInAt: hariLalu(10), source: "TITIPAN" })]);

    // Isi ulang tidak memesan ulang yang masih menjadi utang ke toko: sisa 40 + pesanan baru 10.
    const n = (await nilaiStokToko([tokoId], SEKARANG)).get(tokoId)!;
    expect(n.baris).toEqual([expect.objectContaining({ itemId: barangId, qty: 60, dalamProses: 50 })]);
  });

  it("pesanan konsi lama (stok keluar saat disetujui) tetap terhitung di toko — sekali, dan tidak lagi dalam proses", async () => {
    // (b) lebih tua dari cadangan stok: tanpa cadangan, tanpa transfer → dari baris pesanannya, bertanggal disetujui.
    await pesananKonsi(5, { terkirim: 5, disetujui: hariLalu(200), cadangan: null });
    // (a) cadangan habis dipakai saat disetujui + transfer TANPA pengiriman → dari transfernya saja, bukan juga barisnya.
    const lamaA = await pesananKonsi(4, { terkirim: 4, disetujui: hariLalu(150), cadangan: "CONSUMED" });
    await transferKonsi(lamaA, 4, null, hariLalu(150));

    const s = await stokDiToko(tokoId, SEKARANG);
    expect(s.baris).toEqual([expect.objectContaining({ itemId: barangId, qty: 9, firstInAt: hariLalu(200) })]);
    const n = (await nilaiStokToko([tokoId], SEKARANG)).get(tokoId)!;
    expect(n.baris).toEqual([expect.objectContaining({ qty: 9, dalamProses: 0 })]);
  });

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

  it("laku bersih: barang rusak yang dikembalikan pembeli bukan penjualan, walau tidak kembali ke rak", async () => {
    // Opname pembuka 10, nota 3 potong 5 hari lalu, pembeli mengembalikan 1 layak dan 1 rusak.
    const nota = await prisma.spgSale.create({
      data: {
        docNo: `${tag}/SPG`,
        salesmanId: orangId,
        storeId: tokoId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: orangId,
        createdAt: hariLalu(5),
        lines: { create: [{ itemId: barangId, productName: `${tag} Blus`, qty: 3, unitPrice: 0, lineTotal: 0, returnedQty: 2 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    notaId = nota.id;
    // Retur dulu: baris buku RETUR_PEMBELI menunjuk laporannya (refType `SpgSaleReturn`, refId = id
    // retur), seperti yang ditulis `setujuiReturPembeli`. Tanpa penunjuk itu baris LAYAK terbaca
    // "tanpa baris buku" dan dikurangkan sekali lagi dari laku.
    const retur = await prisma.spgSaleReturn.create({
      data: {
        spgSaleId: nota.id,
        storeId: tokoId,
        createdById: orangId,
        reason: "uji",
        idempotencyKey: `${tag}-RET`,
        status: "DISETUJUI",
        createdAt: hariLalu(4),
        lines: {
          create: [
            { spgSaleLineId: nota.lines[0].id, itemId: barangId, qty: 1, condition: "LAYAK" },
            { spgSaleLineId: nota.lines[0].id, itemId: barangId, qty: 1, condition: "RUSAK" },
          ],
        },
      },
      select: { id: true },
    });
    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: tokoId, itemId: barangId, variantSku: "", qty: 10, kind: "OPNAME", createdById: orangId, createdAt: hariLalu(40) },
        { storeId: tokoId, itemId: barangId, variantSku: "", qty: -3, kind: "JUAL", refType: "SpgSale", refId: nota.id, createdById: orangId, createdAt: hariLalu(5) },
        { storeId: tokoId, itemId: barangId, variantSku: "", qty: 1, kind: "RETUR_PEMBELI", refType: "SpgSaleReturn", refId: retur.id, createdById: orangId, createdAt: hariLalu(4) },
      ],
    });
    const s = await stokDiToko(tokoId, SEKARANG);
    // Rak: 10 − 3 + 1 = 8 (yang rusak tidak kembali ke rak); laku bersih 3 − 1 − 1 = 1.
    expect(s.baris).toEqual([expect.objectContaining({ qty: 8, soldLast30: 1, soldLast60: 1, source: "BUKU_TOKO" })]);
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
