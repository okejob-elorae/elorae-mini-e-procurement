import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, reserveKonsiFieldSalesOrder, seededId, seededIds } from "@elorae/db";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { koreksiStokKonsi } from "./koreksi-stok-konsi";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * Koreksi data lama "konsinyasi tidak pernah keluar dari gudang", terhadap basis data sungguhan.
 *
 *   - kiriman modul konsinyasi 5 pcs yang dicatat penulis LAMA: tidak menyentuh gudang sama sekali
 *     → dipotong koreksi, tercatat di buku stok;
 *   - pesanan KONSI 10 pcs DISETUJUI: hanya dicadangkan (reservedQty +10), qtyOnHand tidak turun.
 *     Itu keadaan "menunggu kirim" yang biasa — stoknya pindah saat pengiriman selesai — jadi
 *     koreksi hanya melaporkannya, tidak pernah memotong atau melepas cadangannya.
 * Gudang 50 pcs × Rp40.000 = Rp2.000.000 → sesudah koreksi 45 pcs, Rp1.800.000, cadangan tetap 10.
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
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
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

  /** Pesanan KONSI yang disetujui: dicadangkan, stoknya baru pindah saat pengiriman selesai. */
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

  const cadanganBaris = async (orderId: string) => {
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId } });
    return prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: line.id } });
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
      expect.objectContaining({
        itemId,
        variantSku: "",
        terkirim: 5,
        sudahDipotong: 0,
        selisih: 5,
        akanDipotong: 5,
        menungguKirim: 10,
        stokGudang: 50,
        cadanganGudang: 10,
      }),
    ]);
    expect(lap.baris.map((b) => [b.sumber, b.keadaan, b.cadanganLama])).toEqual([
      ["PESANAN", "MENUNGGU_KIRIM", 10],
      ["KIRIMAN", "AKAN_DIPOTONG", 0],
    ]);
    expect(await gudang()).toEqual(sebelum);
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(0);
  });

  it("--apply memotong kiriman 5 pcs (Rp200.000) lewat buku stok, pesanan yang menunggu kirim tidak disentuh, dan tidak memotong dua kali bila diulang", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesananLama("", 10);
    await kirimanLama(5);

    const lap = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(lap.diterapkan).toEqual({ dokumenDipotong: 1, barisDipotong: 1, cadanganDilepas: 0, gagal: [] });
    expect(await gudang()).toEqual({ qty: 45, reserved: 10, nilai: 1_800_000 });
    const adj = await prisma.stockAdjustment.findMany({ where: { itemId } });
    expect(adj.map((a) => [a.source, Number(a.qtyChange), Number(a.prevQty), Number(a.newQty)])).toEqual([["KONSI_TRANSFER", -5, 50, 45]]);
    const buku = await prisma.stockLedgerEntry.findMany({ where: { itemId } });
    expect(buku).toHaveLength(1);
    expect(buku[0]).toMatchObject({ locationType: "MAIN", variantSku: "", type: "OUT", refType: "StockAdjustment", refId: adj[0].id });
    expect([Number(buku[0].qty), Number(buku[0].balanceQty), Number(buku[0].totalCost), Number(buku[0].balanceValue)]).toEqual([
      -5, 45, -200_000, 1_800_000,
    ]);
    // Cadangan pesanan tetap milik alur pengiriman.
    expect(await cadanganBaris(orderId)).toMatchObject({ state: "RESERVED" });

    const ulang = await koreksiStokKonsi({ terapkan: true, sertakanTertimpa: true, ...cakupan() });
    expect(ulang.diterapkan).toEqual({ dokumenDipotong: 0, barisDipotong: 0, cadanganDilepas: 0, gagal: [] });
    expect(ulang.perBarang[0]).toMatchObject({ terkirim: 5, sudahDipotong: 5, selisih: 0, akanDipotong: 0, menungguKirim: 10 });
    expect(await gudang()).toEqual({ qty: 45, reserved: 10, nilai: 1_800_000 });
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(1);
  });

  it("dua koreksi bersamaan: satu pengurangan", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    await pesananLama("", 10);
    await kirimanLama(5);
    await Promise.allSettled([koreksiStokKonsi({ terapkan: true, ...cakupan() }), koreksiStokKonsi({ terapkan: true, ...cakupan() })]);
    expect(await gudang()).toEqual({ qty: 45, reserved: 10, nilai: 1_800_000 });
    expect(await prisma.stockAdjustment.count({ where: { itemId, source: "KONSI_TRANSFER" } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(1);
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
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(0);
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

  it("pesanan yang menunggu kirim tidak pernah dipotong, walau gudangnya diopname sesudah disetujui dan TERTIMPA dipaksa", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesananLama("", 10);
    await hitungUlang("ERP_OPNAME", `OPN-${tag}`);

    const lap = await koreksiStokKonsi({ terapkan: true, sertakanTertimpa: true, ...cakupan() });
    expect(lap.baris.map((b) => [b.keadaan, b.cadanganLama, b.sumberHitungUlang])).toEqual([["MENUNGGU_KIRIM", 10, "ERP_OPNAME"]]);
    expect(lap.perBarang[0]).toMatchObject({ terkirim: 0, selisih: 0, tertimpa: 0, menungguKirim: 10, cadanganLamaTertimpa: 0 });
    expect(lap.diterapkan).toEqual({ dokumenDipotong: 0, barisDipotong: 0, cadanganDilepas: 0, gagal: [] });
    expect(await gudang()).toEqual({ qty: 50, reserved: 10, nilai: 2_000_000 });
    expect(await cadanganBaris(orderId)).toMatchObject({ state: "RESERVED" });
    expect(await prisma.stockAdjustment.count({ where: { itemId, source: "KONSI_TRANSFER" } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(0);
  });

  it("pesanan yang sebagian sudah dikirim: sisanya tetap menunggu kirim, tidak dipotong lagi", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesananLama("", 10);
    // Pengiriman pertama 4 pcs sudah selesai: gudang 46, cadangan tinggal 6 (seperti issueKonsiTransfer).
    const rsv = await cadanganBaris(orderId);
    await prisma.stockReservation.update({ where: { id: rsv.id }, data: { consumedQty: 4 } });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemId) }, data: { qtyOnHand: 46, reservedQty: 6, totalValue: 1_840_000 } });

    const lap = await koreksiStokKonsi({ terapkan: true, sertakanTertimpa: true, ...cakupan() });
    expect(lap.baris.map((b) => [b.keadaan, b.cadanganLama])).toEqual([["MENUNGGU_KIRIM", 6]]);
    expect(lap.diterapkan).toMatchObject({ barisDipotong: 0 });
    expect(await gudang()).toEqual({ qty: 46, reserved: 6, nilai: 1_840_000 });
    expect(await cadanganBaris(orderId)).toMatchObject({ state: "RESERVED" });
  });

  it("pesanan yang selesai dikirim (cadangan CONSUMED): sudah dipotong, tidak dipotong lagi", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesananLama("", 10);
    const rsv = await cadanganBaris(orderId);
    await prisma.stockReservation.update({ where: { id: rsv.id }, data: { consumedQty: 10, state: "CONSUMED", resolvedAt: new Date() } });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemId) }, data: { qtyOnHand: 40, reservedQty: 0, totalValue: 1_600_000 } });

    const lap = await koreksiStokKonsi({ terapkan: true, ...cakupan() });
    expect(lap.baris.map((b) => b.keadaan)).toEqual(["SUDAH_DIPOTONG"]);
    expect(lap.perBarang[0]).toMatchObject({ terkirim: 10, sudahDipotong: 10, selisih: 0, menungguKirim: 0 });
    expect(lap.diterapkan).toMatchObject({ barisDipotong: 0 });
    expect(await gudang()).toEqual({ qty: 40, reserved: 0, nilai: 1_600_000 });
  });

  it("lepasCadanganOpname ditolak: cadangan pesanan milik alur pengiriman, tidak ada yang ditulis", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesananLama("", 10);
    await hitungUlang("ERP_OPNAME", `OPN-${tag}`);
    await expect(koreksiStokKonsi({ terapkan: true, lepasCadanganOpname: true, ...cakupan() })).rejects.toThrow(/lepasCadanganOpname/);
    expect(await gudang()).toEqual({ qty: 50, reserved: 10, nilai: 2_000_000 });
    expect(await cadanganBaris(orderId)).toMatchObject({ state: "RESERVED" });
  });
});
