import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, reserveKonsiFieldSalesOrder, seededId, seededIds } from "@elorae/db";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { koreksiStokKonsi } from "./koreksi-stok-konsi";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * Koreksi data lama "konsinyasi tidak pernah keluar dari gudang", terhadap basis data sungguhan.
 *
 * Keadaan lama yang ditiru persis seperti penulis lama meninggalkannya:
 *   - pesanan KONSI 10 pcs DISETUJUI: hanya dicadangkan (reservedQty +10), qtyOnHand tidak turun;
 *   - kiriman modul konsinyasi 5 pcs: tidak menyentuh gudang sama sekali.
 * Gudang 50 pcs × Rp40.000 = Rp2.000.000 → seharusnya 35 pcs, Rp1.400.000.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const LAMA = new Date("2026-08-01T03:00:00Z");

d("koreksiStokKonsi — kiriman konsinyasi lama yang belum keluar dari gudang", () => {
  const tag = `KSK${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let orderIds: string[] = [];
  let kirimIds: string[] = [];
  let nriIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    visitId = "";
    orderIds = [];
    kirimIds = [];
    nriIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 75000 },
      })
    ).id;
    storeId = (
      await prisma.store.create({
        data: { code: `S-${tag}`, name: `${tag} Toko`, address: "uji", termsType: "KONSI", markupPercent: 25, isActive: true },
      })
    ).id;
    salesmanId = (await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } }))!.id;
    visitId = (await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } })).id;
  });

  afterEach(async () => {
    const notif = await prisma.adminNotification.findMany({ where: { category: "PENDING_ORDER_APPROVAL" }, select: { id: true, metadata: true } });
    const milik = notif.filter((n) => orderIds.includes(String((n.metadata as { orderId?: string } | null)?.orderId ?? "")));
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik.map((n) => n.id)) } } });
    await prisma.warehouseReturnItem.deleteMany({ where: { warehouseReturnId: { in: seededIds(nriIds) } } });
    await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: { in: seededIds(kirimIds) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(kirimIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const stokAwal = async (rows: Array<{ variantSku: string | null; qty: number }>) => {
    for (const r of rows) {
      await prisma.inventoryValue.create({
        data: { itemId, variantSku: r.variantSku, qtyOnHand: r.qty, reservedQty: 0, avgCost: 40000, totalValue: r.qty * 40000 },
      });
    }
  };

  /** Pesanan KONSI yang disetujui oleh penulis LAMA: dicadangkan, tidak pernah dipotong. */
  const pesananLama = async (variantSku: string, qty: number) => {
    const { orderId, orderNo } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku, productName: "Blus", qty, unitPrice: 0 }],
    });
    orderIds.push(orderId);
    const lines = await prisma.fieldSalesOrderLine.findMany({ where: { orderId } });
    await reserveKonsiFieldSalesOrder(prisma, {
      orderNo,
      lines: lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
    });
    await prisma.fieldSalesOrder.update({ where: { id: orderId }, data: { status: "APPROVED", approvedAt: LAMA, approvedById: salesmanId } });
    return orderId;
  };

  /** Kiriman modul konsinyasi yang dicatat penulis LAMA: gudang tidak disentuh. */
  const kirimanLama = async (qty: number, variantSku: string | null = null) => {
    const k = await prisma.consignmentShipment.create({
      data: {
        noKirim: `${tag}/KRM/${kirimIds.length + 1}`,
        storeId,
        shippedAt: LAMA,
        items: { create: [{ itemId, variantSku, itemName: `${tag} Blus`, qty, price: 100000, amount: qty * 100000 }] },
      },
    });
    kirimIds.push(k.id);
    return k.id;
  };

  const gudang = async (variantSku: string | null = null) => {
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku } });
    return { qty: Number(inv!.qtyOnHand), reserved: Number(inv!.reservedQty), nilai: Number(inv!.totalValue) };
  };

  const cakupan = () => ({ orderIds, shipmentIds: kirimIds });

  /** Jejak penetapan ulang angka gudang (opname / Jubelio) sesudah tanggal kirim. */
  const hitungUlang = async (source: string, docNumber: string, createdAt = new Date()) => {
    await prisma.stockAdjustment.create({
      data: {
        docNumber,
        itemId,
        type: "NEGATIVE",
        qtyChange: 0,
        reason: "uji hitung ulang",
        prevQty: 50,
        newQty: 50,
        prevAvgCost: 40000,
        newAvgCost: 40000,
        source,
        createdAt,
      },
    });
  };

  it("mode kering melaporkan selisih per barang tanpa menulis apa pun", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await pesananLama("", 10);
    await kirimanLama(5);
    const sebelum = await gudang();
    expect(sebelum).toEqual({ qty: 50, reserved: 10, nilai: 2_000_000 });

    const lap = await koreksiStokKonsi({ terapkan: false, ...cakupan() });
    expect(lap.diterapkan).toBeNull();
    expect(lap.perBarang).toEqual([
      expect.objectContaining({ itemId, variantSku: "", terkirim: 15, sudahDipotong: 0, selisih: 15, akanDipotong: 15, stokGudang: 50, cadanganGudang: 10 }),
    ]);
    expect(await gudang()).toEqual(sebelum);
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(0);
  });

  it("--apply memotong 15 pcs (Rp600.000), melepas cadangan lama, dan tidak memotong dua kali bila diulang", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesananLama("", 10);
    await kirimanLama(5);

    const lap = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(lap.diterapkan).toEqual({ dokumenDipotong: 2, barisDipotong: 2, cadanganDilepas: 0, gagal: [] });
    expect(await gudang()).toEqual({ qty: 35, reserved: 0, nilai: 1_400_000 });
    const adj = await prisma.stockAdjustment.findMany({ where: { itemId }, orderBy: { qtyChange: "asc" } });
    expect(adj.map((a) => [a.source, Number(a.qtyChange)])).toEqual([
      ["KONSI_TRANSFER", -10],
      ["KONSI_TRANSFER", -5],
    ]);
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId } });
    const rsv = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: line.id } });
    expect(rsv.state).toBe("CONSUMED");

    const ulang = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(ulang.diterapkan).toEqual({ dokumenDipotong: 0, barisDipotong: 0, cadanganDilepas: 0, gagal: [] });
    expect(ulang.perBarang[0]).toMatchObject({ terkirim: 15, sudahDipotong: 15, selisih: 0, akanDipotong: 0 });
    expect(await gudang()).toEqual({ qty: 35, reserved: 0, nilai: 1_400_000 });
  });

  it("dua koreksi bersamaan: satu pengurangan", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await pesananLama("", 10);
    await kirimanLama(5);
    await Promise.allSettled([koreksiStokKonsi({ terapkan: true, ...cakupan() }), koreksiStokKonsi({ terapkan: true, ...cakupan() })]);
    expect(await gudang()).toEqual({ qty: 35, reserved: 0, nilai: 1_400_000 });
    expect(await prisma.stockAdjustment.count({ where: { itemId, source: "KONSI_TRANSFER" } })).toBe(2);
  });

  it("gudang yang sudah dihitung ulang (opname) sesudah kirim: TERTIMPA, tidak dipotong kecuali dipaksa", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await kirimanLama(5);
    await prisma.stockAdjustment.create({
      data: {
        docNumber: `OPN-${tag}`,
        itemId,
        type: "NEGATIVE",
        qtyChange: 0,
        reason: "uji opname",
        prevQty: 50,
        newQty: 50,
        prevAvgCost: 40000,
        newAvgCost: 40000,
        source: "ERP_OPNAME",
      },
    });

    const lap = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(lap.perBarang[0]).toMatchObject({ selisih: 5, tertimpa: 5, akanDipotong: 0 });
    expect(lap.diterapkan).toEqual({ dokumenDipotong: 0, barisDipotong: 0, cadanganDilepas: 0, gagal: [] });
    expect((await gudang()).qty).toBe(50);

    const paksa = await koreksiStokKonsi({ terapkan: true, sertakanTertimpa: true, ...cakupan() });
    expect(paksa.diterapkan?.barisDipotong).toBe(1);
    expect((await gudang()).qty).toBe(45);
  });

  it("stok fisik lebih kecil dari jumlah kirim: dokumen itu gagal, gudang tidak dibuat negatif", async () => {
    await stokAwal([{ variantSku: null, qty: 3 }]);
    await kirimanLama(5);
    const lap = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(lap.diterapkan?.barisDipotong).toBe(0);
    expect(lap.diterapkan?.gagal).toEqual([
      expect.objectContaining({ sumber: "KIRIMAN", kurang: [expect.objectContaining({ itemId, requested: 5, available: 3 })] }),
    ]);
    expect((await gudang()).qty).toBe(3);
  });

  it("retur NRI dari toko konsi atas barang yang tidak pernah tercatat dikirim: hanya dilaporkan", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await pesananLama("", 4);
    const lain = await prisma.item.create({
      data: { sku: `${tag}-L`, nameId: `${tag} Rok`, nameEn: `${tag} Skirt`, type: "FINISHED_GOOD", uomId, isActive: true },
    });
    try {
      const nri = await prisma.warehouseReturn.create({
        data: {
          noNri: `${tag}/NRI`,
          storeId,
          warehouseUserId: salesmanId,
          receivedAt: LAMA,
          physicalAmount: 0,
          status: "FINAL",
          items: { create: [{ itemId: lain.id, itemName: `${tag} Rok`, qty: 3, price: 0, amount: 0 }] },
        },
      });
      nriIds.push(nri.id);
      const lap = await koreksiStokKonsi({ terapkan: false, ...cakupan() });
      expect(lap.returTanpaKiriman).toEqual([expect.objectContaining({ itemId: lain.id, variantSku: "", qty: 3 })]);
      expect(lap.perBarang.map((r) => r.itemId)).toEqual([itemId]);
    } finally {
      await prisma.warehouseReturnItem.deleteMany({ where: { warehouseReturnId: { in: seededIds(nriIds) } } });
      await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
      nriIds = [];
      await prisma.item.delete({ where: { id: lain.id } });
    }
  });

  it("kiriman lama per barang untuk barang bervarian: VARIAN_TIDAK_PASTI, tidak dipotong", async () => {
    await stokAwal([
      { variantSku: `${tag}-S`, qty: 20 },
      { variantSku: `${tag}-M`, qty: 20 },
    ]);
    await kirimanLama(5);
    const lap = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(lap.baris.map((b) => b.keadaan)).toEqual(["VARIAN_TIDAK_PASTI"]);
    expect(lap.diterapkan?.barisDipotong).toBe(0);
    expect((await gudang(`${tag}-S`)).qty).toBe(20);
    expect((await gudang(`${tag}-M`)).qty).toBe(20);
  });

  it("pemulihan cadangan marketplace (BACKFILL-, JUBELIO_RECONCILE) bukan hitung ulang: kiriman tetap dipotong", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await kirimanLama(5);
    await hitungUlang("JUBELIO_RECONCILE", `BACKFILL-${tag}`);
    const lap = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(lap.baris.map((b) => b.keadaan)).toEqual(["AKAN_DIPOTONG"]);
    expect(await gudang()).toEqual({ qty: 45, reserved: 0, nilai: 1_800_000 });
  });

  it("pesanan lama TERTIMPA opname: cadangan lama dilaporkan, dilepas hanya dengan opsi, qtyOnHand tidak dipotong lagi", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesananLama("", 10);
    await hitungUlang("ERP_OPNAME", `OPN-${tag}`);
    // Opname menghitung fisik 40: 10 pcs sudah di toko, angka gudang sudah benar.
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemId) }, data: { qtyOnHand: 40, totalValue: 1_600_000 } });

    const kering = await koreksiStokKonsi({ terapkan: false, ...cakupan() });
    expect(kering.perBarang[0]).toMatchObject({ tertimpa: 10, selisih: 10, cadanganLamaTertimpa: 10, sumberHitungUlang: "ERP_OPNAME" });

    // Tanpa opsi: tidak dipotong, cadangan lama tetap menahan 10 (tersedia 30, padahal fisik 40).
    const tanpa = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(tanpa.diterapkan).toMatchObject({ barisDipotong: 0, cadanganDilepas: 0 });
    expect(await gudang()).toEqual({ qty: 40, reserved: 10, nilai: 1_600_000 });

    const lepas = await koreksiStokKonsi({ terapkan: true, lepasCadanganOpname: true, ...cakupan() });
    expect(lepas.diterapkan).toMatchObject({ barisDipotong: 0, cadanganDilepas: 1 });
    expect(await gudang()).toEqual({ qty: 40, reserved: 0, nilai: 1_600_000 });
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId } });
    expect((await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: line.id } })).state).toBe("RELEASED");
    expect(await prisma.stockAdjustment.count({ where: { itemId, source: "KONSI_TRANSFER" } })).toBe(0);

    // Diulang, bahkan dengan sertakanTertimpa: selesai, tidak dipotong dan tidak dilepas lagi.
    const ulang = await koreksiStokKonsi({ terapkan: true, sertakanTertimpa: true, ...cakupan() });
    expect(ulang.baris.map((b) => b.keadaan)).toEqual(["CADANGAN_DILEPAS"]);
    expect(ulang.perBarang[0]).toMatchObject({ selisih: 0, cadanganDilepas: 10, sudahDipotong: 0 });
    expect(ulang.diterapkan).toMatchObject({ barisDipotong: 0, cadanganDilepas: 0 });
    expect(await gudang()).toEqual({ qty: 40, reserved: 0, nilai: 1_600_000 });
  });

  it("dua pelepasan cadangan bersamaan: cadangan berkurang sekali", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await pesananLama("", 10);
    await hitungUlang("ERP_OPNAME", `OPN-${tag}`);
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemId) }, data: { qtyOnHand: 40, reservedQty: 13, totalValue: 1_600_000 } });
    await Promise.allSettled([
      koreksiStokKonsi({ terapkan: true, lepasCadanganOpname: true, ...cakupan() }),
      koreksiStokKonsi({ terapkan: true, lepasCadanganOpname: true, ...cakupan() }),
    ]);
    // 13 = 10 cadangan konsi lama + 3 cadangan lain; hanya yang 10 yang lepas, sekali.
    expect(await gudang()).toEqual({ qty: 40, reserved: 3, nilai: 1_600_000 });
  });

  it("hitung ulang TERAKHIR oleh Jubelio: cadangan lama tidak dilepas walau opsi opname menyala", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await pesananLama("", 10);
    await hitungUlang("ERP_OPNAME", `OPN-${tag}`, new Date("2026-09-01T03:00:00Z"));
    await hitungUlang("JUBELIO_WEBHOOK", `JBL-${tag}`, new Date("2026-09-15T03:00:00Z"));
    const lap = await koreksiStokKonsi({ terapkan: true, lepasCadanganOpname: true, ...cakupan() });
    expect(lap.perBarang[0]).toMatchObject({ tertimpa: 10, cadanganLamaTertimpa: 10, sumberHitungUlang: "JUBELIO_WEBHOOK" });
    expect(lap.diterapkan).toMatchObject({ barisDipotong: 0, cadanganDilepas: 0 });
    expect(await gudang()).toEqual({ qty: 50, reserved: 10, nilai: 2_000_000 });
  });
});
