import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { pencocokanSiklus } from "./pencocokan-queries";
import { daftarSiklus } from "./queries";

/**
 * Pencocokan buku stok toko vs laporan laku konsinyasi, terhadap basis data
 * sungguhan. Data uji milik tes ini sendiri; teardown lewat `seededId()`.
 *
 * Skenario (siklus Agustus 2026, toko konsinyasi ber-SPG):
 * - Juli: kiriman A 10 (sebelum buku), opname pembuka A +10 → buku dimulai.
 * - Agustus: kiriman B 5, diterima SPG dengan 2 rusak (buku +3); nota A 3 + B 1;
 *   pembeli mengembalikan 1 A (layak); opname A −1; retur ke gudang A −1 yang
 *   belum dihitung gudang.
 * - Laporan SPG: A 2, B 1. Laporan toko diketik NAMA: A 2, B 2.
 */

const tag = `PCK${Math.random().toString(36).slice(2, 8)}`;
const pada = (iso: string) => new Date(iso);

let tokoId = "";
let uomId = "";
let barangA = "";
let barangB = "";
let orangId = "";
let siklusId = "";
let kirimIds: string[] = [];
let terimaId = "";
let jualId = "";
let returId = "";
let hilangIds: string[] = [];
let nomor = 0;
let konsiPesananIds: string[] = [];
let konsiBarisIds: string[] = [];
let konsiPengirimanIds: string[] = [];
let konsiTransferIds: string[] = [];
let konsiTerimaIds: string[] = [];

beforeEach(async () => {
  tokoId = "";
  uomId = "";
  barangA = "";
  barangB = "";
  orangId = "";
  siklusId = "";
  kirimIds = [];
  terimaId = "";
  jualId = "";
  returId = "";
  konsiPesananIds = [];
  konsiBarisIds = [];
  konsiPengirimanIds = [];
  konsiTransferIds = [];
  konsiTerimaIds = [];

  tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", isActive: true } })).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  barangA = (await prisma.item.create({ data: { sku: `${tag}-A`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId } })).id;
  barangB = (await prisma.item.create({ data: { sku: `${tag}-B`, nameId: `${tag} Rok`, nameEn: `${tag} Skirt`, type: "FINISHED_GOOD", uomId } })).id;
  orangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: `${tag} SPG`, passwordHash: "x" } })).id;
  siklusId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: tokoId, periodYear: 2026, periodMonth: 8 } })).id;

  await prisma.consignmentReport.create({
    data: {
      cycleId: siklusId,
      source: "SPG",
      reportedAt: pada("2026-09-01T03:00:00Z"),
      items: { create: [{ itemId: barangA, itemName: `${tag} Blus`, qty: 2 }, { itemId: barangB, itemName: `${tag} Rok`, qty: 1 }] },
    },
  });
  await prisma.consignmentReport.create({
    data: {
      cycleId: siklusId,
      source: "TOKO",
      reportedAt: pada("2026-09-02T03:00:00Z"),
      // Diketik nama saja — dicocokkan ke master barang lewat namanya.
      items: { create: [{ itemName: `  ${tag} BLUS `, qty: 2 }, { itemName: `${tag} rok`, qty: 2 }] },
    },
  });
});

afterEach(async () => {
  await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(hilangIds) } } });
  hilangIds = [];
  await prisma.auditLog.deleteMany({ where: { entityType: "ConsignmentCycle", entityId: seededId(siklusId) } });
  await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
  await prisma.storeReceiptLine.deleteMany({ where: { receiptId: seededId(terimaId) } });
  await prisma.storeReceipt.deleteMany({ where: { id: seededId(terimaId) } });
  await prisma.storeReceiptLine.deleteMany({ where: { receiptId: { in: seededIds(konsiTerimaIds) } } });
  await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(konsiTerimaIds) } } });
  // Pesanan konsi + antarannya: cadangan, transfer, pengiriman, lalu pesanan (barisnya ikut terhapus).
  await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(konsiBarisIds) } } });
  await prisma.konsiTransfer.deleteMany({ where: { id: { in: seededIds(konsiTransferIds) } } });
  await prisma.deliveryShipment.deleteMany({ where: { id: { in: seededIds(konsiPengirimanIds) } } });
  await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(konsiPesananIds) } } });
  await prisma.spgSaleReturnLine.deleteMany({ where: { returnId: seededId(returId) } });
  await prisma.spgSaleReturn.deleteMany({ where: { id: seededId(returId) } });
  await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: seededId(jualId) } });
  await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: seededId(jualId) }, select: { id: true } })).map((x) => x.id) } } });
  await prisma.spgSale.deleteMany({ where: { id: seededId(jualId) } });
  await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: { in: seededIds(kirimIds) } } });
  await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(kirimIds) } } });
  await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklusId) } } });
  await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
  await prisma.item.deleteMany({ where: { id: { in: seededIds([barangA, barangB].filter(Boolean)) } } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
  await prisma.user.deleteMany({ where: { id: seededId(orangId) } });
});

async function kirim(noKirim: string, shippedAt: string, itemId: string, nama: string, qty: number): Promise<string> {
  const k = await prisma.consignmentShipment.create({
    data: { noKirim, storeId: tokoId, shippedAt: pada(shippedAt), items: { create: [{ itemId, itemName: nama, qty, price: 0, amount: 0 }] } },
  });
  kirimIds.push(k.id);
  return k.id;
}

async function gerak(
  itemId: string,
  qty: number,
  kind: "TERIMA" | "JUAL" | "OPNAME" | "RETUR_PEMBELI" | "RETUR_KELUAR" | "HILANG",
  iso: string,
  ref?: { refType: string; refId: string },
) {
  await prisma.storeStockMovement.create({
    data: { storeId: tokoId, itemId, variantSku: "", qty, kind, createdById: orangId, createdAt: pada(iso), ...(ref ?? {}) },
  });
}

async function siapkanBuku() {
  await kirim(`${tag}/KRM1`, "2026-07-15T03:00:00Z", barangA, `${tag} Blus`, 10);
  await gerak(barangA, 10, "OPNAME", "2026-07-20T03:00:00Z");

  const kirimB = await kirim(`${tag}/KRM2`, "2026-08-05T03:00:00Z", barangB, `${tag} Rok`, 5);
  terimaId = (
    await prisma.storeReceipt.create({
      data: {
        storeId: tokoId,
        sourceType: "KONSI_SHIPMENT",
        sourceId: kirimB,
        sourceDocNo: `${tag}/KRM2`,
        receivedById: orangId,
        receivedAt: pada("2026-08-06T03:00:00Z"),
        lines: {
          create: [{ itemId: barangB, productName: `${tag} Rok`, qtySent: 5, qtyReceived: 5, qtyDamaged: 2, damageStatus: "TERBUKA", damageNote: "sobek" }],
        },
      },
    })
  ).id;
  await gerak(barangB, 3, "TERIMA", "2026-08-06T03:00:00Z");

  const jual = await prisma.spgSale.create({
    data: {
      docNo: `${tag}/SPG1`,
      salesmanId: orangId,
      storeId: tokoId,
      subtotal: 0,
      total: 0,
      cashReceived: 0,
      changeGiven: 0,
      createdById: orangId,
      createdAt: pada("2026-08-10T03:00:00Z"),
      lines: {
        create: [
          { itemId: barangA, productName: `${tag} Blus`, qty: 3, unitPrice: 0, lineTotal: 0, returnedQty: 1 },
          { itemId: barangB, productName: `${tag} Rok`, qty: 1, unitPrice: 0, lineTotal: 0 },
        ],
      },
    },
    select: { id: true, lines: { select: { id: true, itemId: true } } },
  });
  jualId = jual.id;
  await gerak(barangA, -3, "JUAL", "2026-08-10T03:00:00Z", { refType: "SpgSale", refId: jual.id });
  await gerak(barangB, -1, "JUAL", "2026-08-10T03:00:00Z", { refType: "SpgSale", refId: jual.id });

  const barisA = jual.lines.find((l) => l.itemId === barangA)!;
  returId = (
    await prisma.spgSaleReturn.create({
      data: {
        spgSaleId: jual.id,
        storeId: tokoId,
        createdById: orangId,
        reason: "ukuran",
        idempotencyKey: `${tag}-RET1`,
        createdAt: pada("2026-08-12T03:00:00Z"),
        lines: { create: [{ spgSaleLineId: barisA.id, itemId: barangA, qty: 1, condition: "LAYAK" }] },
      },
    })
  ).id;
  // Seperti yang ditulis persetujuan retur (`setujuiReturPembeli`): baris buku menunjuk laporannya.
  // Retur LAYAK yang disetujui TANPA baris buku penunjuk dibaca laku bersih sebagai "sudah terhitung opname".
  await gerak(barangA, 1, "RETUR_PEMBELI", "2026-08-12T03:00:00Z", { refType: "SpgSaleReturn", refId: returId });

  await gerak(barangA, -1, "OPNAME", "2026-08-20T03:00:00Z");
  // Nota retur ke gudang yang belum dihitung (tidak ada NRI sama sekali).
  await gerak(barangA, -1, "RETUR_KELUAR", "2026-08-25T03:00:00Z", { refType: "StoreReturn", refId: `${tag}-nrt` });
}

/**
 * Pesanan konsi yang disetujui. `cadangan` = keadaan cadangan stok barisnya
 * (null = pesanan lebih tua dari cadangan stok). Pesanan aturan baru selalu
 * RESERVED sampai dikirim.
 */
async function pesananKonsi(itemId: string, qty: number, lain: { terkirim?: number; disetujui: string; cadangan: "RESERVED" | "CONSUMED" | null }) {
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
      approvedAt: pada(lain.disetujui),
      subtotal: 0,
      total: 0,
      lines: { create: [{ itemId, variantSku: "", productName: "uji", qty, deliveredQty: terkirim, unitPrice: 0, lineTotal: 0 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  konsiPesananIds.push(o.id);
  konsiBarisIds.push(o.lines[0].id);
  if (lain.cadangan) {
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES_KONSI", fieldSalesLineId: o.lines[0].id, itemId, variantSku: "", qty, consumedQty: terkirim, state: lain.cadangan },
    });
  }
  return { id: o.id, lineId: o.lines[0].id, itemId };
}

/** Transfer konsi (dibuat saat pengiriman diserahkan); `shipmentId` null = transfer lama saat disetujui. */
async function transferKonsi(o: { id: string; lineId: string; itemId: string }, qty: number, shipmentId: string | null, iso: string): Promise<string> {
  nomor += 1;
  const t = await prisma.konsiTransfer.create({
    data: {
      docNo: `${tag}-TRF-${nomor}`,
      orderId: o.id,
      storeId: tokoId,
      shipmentId,
      transferredById: orangId,
      createdAt: pada(iso),
      lines: { create: [{ orderLineId: o.lineId, itemId: o.itemId, variantSku: "", productName: "uji", qty, unitCost: 0 }] },
    },
    select: { id: true },
  });
  konsiTransferIds.push(t.id);
  return t.id;
}

/** Antaran: pengiriman pesanan itu; yang DELIVERED membawa transfernya. Mengembalikan id transfernya ("" kalau belum diserahkan). */
async function antaranKonsi(o: { id: string; lineId: string; itemId: string }, qty: number, status: "DELIVERED" | "PACKED" | "IN_TRANSIT", iso: string): Promise<string> {
  nomor += 1;
  const shp = await prisma.deliveryShipment.create({
    data: {
      docNo: `${tag}-SHP-${nomor}`,
      orderId: o.id,
      method: "SALESMAN_CARRY",
      status,
      packedById: orangId,
      carriedById: orangId,
      packedAt: pada(iso),
      deliveredAt: status === "DELIVERED" ? pada(iso) : null,
      lines: { create: [{ orderLineId: o.lineId, itemId: o.itemId, variantSku: "", plannedQty: qty, deliveredQty: status === "DELIVERED" ? qty : null }] },
    },
    select: { id: true },
  });
  konsiPengirimanIds.push(shp.id);
  return status === "DELIVERED" ? transferKonsi(o, qty, shp.id, iso) : "";
}

/** Tanda terima SPG atas satu kiriman konsi + gerakan TERIMA-nya di buku. */
async function terimaKonsi(sourceType: "KONSI_TRANSFER" | "KONSI_ORDER", sourceId: string, itemId: string, dikirim: number, diterima: number, iso: string) {
  const r = await prisma.storeReceipt.create({
    data: {
      storeId: tokoId,
      sourceType,
      sourceId,
      sourceDocNo: `${tag}-TT`,
      receivedById: orangId,
      receivedAt: pada(iso),
      lines: { create: [{ itemId, productName: "uji", qtySent: dikirim, qtyReceived: diterima }] },
    },
  });
  konsiTerimaIds.push(r.id);
  await gerak(itemId, diterima, "TERIMA", iso);
}

describe("pencocokanSiklus (basis data)", () => {
  it("terjual per barang: buku, nota bersih, dan dua laporan — laporan bernama dicocokkan ke barangnya", async () => {
    await siapkanBuku();
    const p = (await pencocokanSiklus(siklusId))!;
    expect(p.adaBuku).toBe(true);
    expect(p.bukuMulaiTengahBulan).toBe(false);

    const a = p.baris.find((b) => b.itemId === barangA)!;
    const b = p.baris.find((x) => x.itemId === barangB)!;
    expect(a.terjual).toEqual({ buku: 2, nota: 2, laporanSpg: 2, laporanToko: 2, resmi: null });
    expect(a.terjualBerselisih).toBe(false);
    expect(b.terjual).toEqual({ buku: 1, nota: 1, laporanSpg: 1, laporanToko: 2, resmi: null });
    expect(b.terjualBerselisih).toBe(true);
    // Tidak ada baris "nama:" — kedua nama ketikan dikenali.
    expect(p.baris.every((x) => x.itemId !== null)).toBe(true);
  });

  it("stok akhir bulan: retur yang belum dihitung gudang dan barang rusak tidak dianggap hilang", async () => {
    await siapkanBuku();
    const p = (await pencocokanSiklus(siklusId))!;
    const a = p.baris.find((b) => b.itemId === barangA)!;
    const b = p.baris.find((x) => x.itemId === barangB)!;
    // A: titipan 10 − 2 (laporan toko) = 8; buku 10 − 3 + 1 − 1 − 1 = 6;
    // retur belum dihitung 1 → seharusnya 7 → kurang 1.
    expect(a.stok).toEqual({ buku: 6, titipan: 8, dalamProses: 1, hilangTercatat: 0, seharusnya: 7, selisih: -1, kemungkinanHilang: 1 });
    // B: titipan 5 − 2 = 3; buku 3 − 1 = 2; rusak menunggu 2 → seharusnya 1 → lebih 1.
    expect(b.stok).toEqual({ buku: 2, titipan: 3, dalamProses: 2, hilangTercatat: 0, seharusnya: 1, selisih: 1, kemungkinanHilang: 0 });
    expect(p.ringkas).toMatchObject({
      barangTerjualBerselisih: 1,
      barangStokBerselisih: 2,
      barangKemungkinanHilang: 1,
      pcsKemungkinanHilang: 1,
      barangBerselisih: 2,
      cocok: false,
    });
    expect(p.bulanSementara).toEqual([{ periode: "2026-08", dasar: "LAPORAN_TOKO" }]);
  });

  it("barang yang sudah dicatat hilang dari opname tidak dihitung lagi; hilang di mutasi dan yang dibatalkan tidak ikut", async () => {
    await siapkanBuku();
    const hilang = async (source: string, status: string, qty: number, decidedAt: string | null = null) => {
      const l = await prisma.stockLoss.create({
        data: {
          storeId: tokoId,
          source,
          totalQty: qty,
          totalAmount: 0,
          valueBasis: "HARGA_ELORAE",
          status,
          decidedAt: decidedAt ? pada(decidedAt) : null,
          createdById: orangId,
          createdAt: pada("2026-08-20T03:00:00Z"),
          lines: { create: [{ itemId: barangA, productName: `${tag} Blus`, qty, unitValue: 0, amount: 0 }] },
        },
      });
      hilangIds.push(l.id);
    };
    await hilang("OPNAME", "DITETAPKAN", 1);
    await hilang("OPNAME", "DIBATALKAN", 5, "2026-08-22T03:00:00Z");
    await hilang("MUTASI", "TERBUKA", 2);
    const p = (await pencocokanSiklus(siklusId))!;
    const a = p.baris.find((b) => b.itemId === barangA)!;
    expect(a.stok).toMatchObject({ buku: 6, titipan: 8, dalamProses: 1, hilangTercatat: 1, seharusnya: 6, selisih: 0, kemungkinanHilang: 0 });
    expect(p.ringkas).toMatchObject({ barangKemungkinanHilang: 0, pcsKemungkinanHilang: 0 });
  });

  it("catatan yang dibatalkan SESUDAH akhir bulan masih berlaku untuk bulan itu", async () => {
    await siapkanBuku();
    const l = await prisma.stockLoss.create({
      data: {
        storeId: tokoId,
        source: "OPNAME",
        totalQty: 1,
        totalAmount: 0,
        valueBasis: "HARGA_ELORAE",
        status: "DIBATALKAN",
        decidedAt: pada("2026-09-03T03:00:00Z"),
        createdById: orangId,
        createdAt: pada("2026-08-20T03:00:00Z"),
        lines: { create: [{ itemId: barangA, productName: `${tag} Blus`, qty: 1, unitValue: 0, amount: 0 }] },
      },
    });
    hilangIds.push(l.id);
    const a = (await pencocokanSiklus(siklusId))!.baris.find((b) => b.itemId === barangA)!;
    expect(a.stok).toMatchObject({ hilangTercatat: 1, selisih: 0, kemungkinanHilang: 0 });
  });

  it("catatan MANUAL dihitung sebesar gerakan HILANG-nya di buku; yang dibatalkan sebelum akhir bulan tidak", async () => {
    await siapkanBuku();
    const manual = async (status: string, decidedAt: string | null, qty: number, gerakan: number[]) => {
      const l = await prisma.stockLoss.create({
        data: {
          storeId: tokoId,
          source: "MANUAL",
          totalQty: qty,
          totalAmount: 0,
          valueBasis: "HARGA_ELORAE",
          status,
          decidedAt: decidedAt ? pada(decidedAt) : null,
          createdById: orangId,
          createdAt: pada("2026-08-21T03:00:00Z"),
          lines: { create: [{ itemId: barangA, productName: `${tag} Blus`, qty, unitValue: 0, amount: 0 }] },
        },
      });
      hilangIds.push(l.id);
      for (const [i, q] of gerakan.entries()) {
        await gerak(barangA, q, "HILANG", `2026-08-2${1 + i}T04:00:00Z`, { refType: "StockLoss", refId: l.id });
      }
    };
    // Tercatat 2 dan memotong buku 2. Satu lagi (1) ternyata ada: opname sudah
    // meluruskan buku (+1), lalu catatannya dibatalkan dalam bulan itu — gerakannya
    // tinggal, tapi catatan batal tidak dihitung hilang.
    await manual("DITETAPKAN", "2026-08-22T03:00:00Z", 2, [-2]);
    await manual("DIBATALKAN", "2026-08-23T03:00:00Z", 1, [-1]);
    await gerak(barangA, 1, "OPNAME", "2026-08-22T06:00:00Z");
    // Catatan MANUAL tanpa gerakan buku (toko belum berbuku saat dicatat) tidak ikut.
    await manual("TERBUKA", null, 4, []);
    const a = (await pencocokanSiklus(siklusId))!.baris.find((b) => b.itemId === barangA)!;
    // Buku 6 − 2 = 4; titipan 8; retur belum dihitung 1; tercatat hilang 2 → seharusnya 5 → kurang 1 (sama seperti tanpa catatan).
    expect(a.stok).toMatchObject({ buku: 4, titipan: 8, dalamProses: 1, hilangTercatat: 2, seharusnya: 5, selisih: -1, kemungkinanHilang: 1 });
  });

  it("barang rusak yang dikembalikan pembeli bukan terjual; ia dalam proses sampai NRI-nya final", async () => {
    await siapkanBuku();
    const baris = await prisma.spgSaleLine.findFirstOrThrow({ where: { spgSaleId: jualId, itemId: barangA }, select: { id: true } });
    await prisma.spgSaleReturnLine.create({ data: { returnId: returId, spgSaleLineId: baris.id, itemId: barangA, qty: 1, condition: "RUSAK" } });
    await prisma.spgSaleLine.update({ where: { id: baris.id }, data: { returnedQty: 2 } });
    const p = (await pencocokanSiklus(siklusId))!;
    const a = p.baris.find((b) => b.itemId === barangA)!;
    // Buku: 3 − 1 layak − 1 rusak = 1; nota bersih 3 − 2 = 1.
    expect(a.terjual).toMatchObject({ buku: 1, nota: 1 });
    // Titipan (dasar laporan toko 2) tetap 8; buku tidak berubah (6); rusak di toko 1 + retur belum dihitung 1.
    expect(a.stok).toMatchObject({ buku: 6, titipan: 8, dalamProses: 2, seharusnya: 6, selisih: 0, kemungkinanHilang: 0 });
    expect((await daftarSiklus()).find((x) => x.id === siklusId)?.penandaCocok).toEqual({ berselisih: 2 });
  });

  it("kiriman yang belum diterima SPG dihitung dalam proses", async () => {
    await siapkanBuku();
    await kirim(`${tag}/KRM3`, "2026-08-28T03:00:00Z", barangA, `${tag} Blus`, 4);
    const a = (await pencocokanSiklus(siklusId))!.baris.find((b) => b.itemId === barangA)!;
    expect(a.stok).toMatchObject({ titipan: 12, dalamProses: 5, seharusnya: 7, kemungkinanHilang: 1 });
  });

  it("antaran konsi: masuk dan dalam proses sebesar antarannya, bertanggal transfernya — sisa pesanan yang belum dikirim gudang tidak ada di mana pun", async () => {
    await siapkanBuku();
    // Pesanan 100 A, antaran pertama 60 diserahkan 15 Agustus, sisa 40: 30 sedang dikemas, 10 belum.
    const o = await pesananKonsi(barangA, 100, { terkirim: 60, disetujui: "2026-08-01T03:00:00Z", cadangan: "RESERVED" });
    const t1 = await antaranKonsi(o, 60, "DELIVERED", "2026-08-15T03:00:00Z");
    await antaranKonsi(o, 30, "PACKED", "2026-08-28T03:00:00Z");
    // Pesanan yang hanya disetujui (dicadangkan, belum dikirim) tidak pernah masuk titipan.
    await pesananKonsi(barangA, 25, { disetujui: "2026-08-20T03:00:00Z", cadangan: "RESERVED" });

    // Belum diterima SPG: titipan 8 + 60 (bukan + 100 / + 125), dalam proses 1 + 60 (bukan + 40 sisanya).
    let a = (await pencocokanSiklus(siklusId))!.baris.find((b) => b.itemId === barangA)!;
    expect(a.stok).toEqual({ buku: 6, titipan: 68, dalamProses: 61, hilangTercatat: 0, seharusnya: 7, selisih: -1, kemungkinanHilang: 1 });

    // SPG menghitung 57 dari 60: kurang 3 di perjalanan, dicatat barang hilang (sumber PENERIMAAN).
    await terimaKonsi("KONSI_TRANSFER", t1, barangA, 60, 57, "2026-08-16T03:00:00Z");
    const l = await prisma.stockLoss.create({
      data: {
        storeId: tokoId,
        source: "PENERIMAAN",
        totalQty: 3,
        totalAmount: 0,
        valueBasis: "HARGA_ELORAE",
        status: "TERBUKA",
        createdById: orangId,
        createdAt: pada("2026-08-16T03:00:00Z"),
        lines: { create: [{ itemId: barangA, productName: `${tag} Blus`, qty: 3, unitValue: 0, amount: 0 }] },
      },
    });
    hilangIds.push(l.id);
    a = (await pencocokanSiklus(siklusId))!.baris.find((b) => b.itemId === barangA)!;
    // Buku 6 + 57; antaran sudah diterima → keluar dari dalam proses; kurang 3 sudah tercatat → tidak menambah kemungkinan hilang.
    expect(a.stok).toEqual({ buku: 63, titipan: 68, dalamProses: 1, hilangTercatat: 3, seharusnya: 64, selisih: -1, kemungkinanHilang: 1 });
  });

  it("pesanan konsi lama (stok keluar saat disetujui) masuk sekali — dari transfernya kalau ada, kalau tidak dari barisnya — dan diterima sekali per pesanan", async () => {
    await siapkanBuku();
    // (b) lebih tua dari cadangan stok: tanpa cadangan, tanpa transfer.
    const lamaB = await pesananKonsi(barangB, 5, { terkirim: 5, disetujui: "2026-08-03T03:00:00Z", cadangan: null });
    // (a) cadangan habis dipakai saat disetujui + transfer TANPA pengiriman.
    const lamaA = await pesananKonsi(barangB, 4, { terkirim: 4, disetujui: "2026-08-04T03:00:00Z", cadangan: "CONSUMED" });
    await transferKonsi(lamaA, 4, null, "2026-08-04T03:00:00Z");

    // B dasar: titipan 3, dalam proses 2. Keduanya belum diterima: + 5 + 4, tidak dobel.
    let b = (await pencocokanSiklus(siklusId))!.baris.find((x) => x.itemId === barangB)!;
    expect(b.stok).toEqual({ buku: 2, titipan: 12, dalamProses: 11, hilangTercatat: 0, seharusnya: 1, selisih: 1, kemungkinanHilang: 0 });

    // Pesanan lama diterima per PESANAN (`KONSI_ORDER`), bukan per transfernya.
    await terimaKonsi("KONSI_ORDER", lamaA.id, barangB, 4, 4, "2026-08-05T03:00:00Z");
    await terimaKonsi("KONSI_ORDER", lamaB.id, barangB, 5, 5, "2026-08-05T04:00:00Z");
    b = (await pencocokanSiklus(siklusId))!.baris.find((x) => x.itemId === barangB)!;
    expect(b.stok).toEqual({ buku: 11, titipan: 12, dalamProses: 2, hilangTercatat: 0, seharusnya: 10, selisih: 1, kemungkinanHilang: 0 });
  });

  it("sesudah dikunci, angka resmi dipakai untuk terjual dan stok titipan", async () => {
    await siapkanBuku();
    await prisma.consignmentSold.createMany({
      data: [
        { cycleId: siklusId, itemId: barangA, itemName: `${tag} Blus`, qty: 2, price: 70_000, amount: 140_000 },
        { cycleId: siklusId, itemId: barangB, itemName: `${tag} Rok`, qty: 1, price: 70_000, amount: 70_000 },
      ],
    });
    await prisma.consignmentCycle.update({ where: { id: siklusId }, data: { lockedAt: new Date() } });
    const p = (await pencocokanSiklus(siklusId))!;
    const b = p.baris.find((x) => x.itemId === barangB)!;
    expect(b.terjual.resmi).toBe(1);
    expect(b.stok).toMatchObject({ titipan: 4, seharusnya: 2, selisih: 0 });
    expect(p.bulanSementara).toEqual([]);
  });

  it("toko tanpa buku stok: tidak ada angka buku maupun stok, hanya laporan yang dibandingkan", async () => {
    const p = (await pencocokanSiklus(siklusId))!;
    expect(p.adaBuku).toBe(false);
    expect(p.ringkas.adaStok).toBe(false);
    expect(p.sumber).toMatchObject({ buku: false, nota: false, laporanSpg: true, laporanToko: true });
    expect(p.baris.every((b) => b.terjual.buku === null && b.stok === null)).toBe(true);
    expect(p.ringkas).toMatchObject({ sumberTerjual: 2, barangTerjualBerselisih: 1 });
  });

  it("daftar siklus memberi penanda yang sama dengan bagian terjual di rincian", async () => {
    await siapkanBuku();
    const baris = (await daftarSiklus()).find((x) => x.id === siklusId);
    expect(baris?.penandaCocok).toEqual({ berselisih: 1 });
  });

  it("null untuk siklus yang tidak ada", async () => {
    expect(await pencocokanSiklus("tidak-ada")).toBeNull();
  });
});
