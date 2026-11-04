import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bacaPesananKonsiLama } from "@/lib/spg/antaran-queries";
import { createDeliveryShipment } from "@/lib/delivery/shipment-writer";
import { bacaPesananKonsiCadanganLama, muatPesananKonsiCadanganLama } from "./pesanan-lama";
import { BAWAAN_PESANAN_LAMA_SEBELUM } from "./pesanan-lama-aturan";
import {
  batalKirimPesananLama,
  JEJAK_BATAL_KIRIM_PESANAN_LAMA,
  JEJAK_SAMPAI_PESANAN_LAMA,
  konfirmasiSampaiPesananLama,
} from "./pesanan-lama-writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Push stok ke Jubelio sesudah commit: barang uji tidak berpemetaan, tapi jangan sampai menulis antrean. */
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => ({ diantrekan: [], sudahAntre: [], tanpaPemetaan: [], barisGabungan: [], gagal: false })) }));

/**
 * Pesanan konsinyasi LAMA (keputusan pemilik no. 9) terhadap basis data sungguhan. Semua data milik
 * tes ini; setiap filter penghapusan lewat `seededId()`/`seededIds()`. Pesanan, baris, cadangan, dan
 * angka gudang dibuat LANGSUNG dalam bentuk aturan tim paling awal (persetujuan hanya mencadangkan,
 * disetujui sebelum alur per antaran) — penulis persetujuan hari ini tidak bisa lagi membuatnya.
 */
d("pesanan konsi lama: konfirmasi sampai dan tidak jadi dikirim (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const LAMA = new Date("2026-08-01T03:00:00.000Z");
  let urut = 0;

  let uomId = "";
  let itemId = "";
  let invId = "";
  let tokoSpgId = "";
  let tokoTanpaSpgId = "";
  let tokoLainId = "";
  let spgId = "";
  let spgLainId = "";
  let pemegangId = "";
  let salesmanLainId = "";
  let kantorId = "";
  let orderIds: string[] = [];
  let opnameIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    invId = "";
    tokoSpgId = "";
    tokoTanpaSpgId = "";
    tokoLainId = "";
    spgId = "";
    spgLainId = "";
    pemegangId = "";
    salesmanLainId = "";
    kantorId = "";
    orderIds = [];
    opnameIds = [];
    urut += 1;
    const tag = `${token}-${urut}`;

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-KLM-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `TEST-KLM-${tag}`, nameId: "Kaos konsi lama", nameEn: "Old konsi tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
      })
    ).id;
    invId = (await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 10000, totalValue: 1000000 } })).id;

    pemegangId = (await prisma.user.create({ data: { email: `test-klm-pemegang-${tag}@example.com`, name: "Pemegang Uji" } })).id;
    salesmanLainId = (await prisma.user.create({ data: { email: `test-klm-sales-${tag}@example.com`, name: "Salesman Lain Uji" } })).id;
    kantorId = (await prisma.user.create({ data: { email: `test-klm-kantor-${tag}@example.com`, name: "Kantor Uji" } })).id;

    const toko = (kode: string, salesmanId: string | null) =>
      prisma.store.create({
        data: { code: `TEST-KLM-${kode}-${tag}`, name: `Toko ${kode} Uji`, address: "Alamat uji", termsType: "KONSI", markupPercent: 20, isActive: true, salesmanId },
      });
    tokoSpgId = (await toko("SPG", pemegangId)).id;
    tokoTanpaSpgId = (await toko("TANPA", pemegangId)).id;
    tokoLainId = (await toko("LAIN", null)).id;

    spgId = (await prisma.user.create({ data: { email: `test-klm-spg-${tag}@example.com`, name: "SPG Uji", assignedStoreId: tokoSpgId } })).id;
    spgLainId = (await prisma.user.create({ data: { email: `test-klm-spg-lain-${tag}@example.com`, name: "SPG Lain Uji", assignedStoreId: tokoLainId } })).id;
  });

  afterEach(async () => {
    const tokoIds = [tokoSpgId, tokoTanpaSpgId, tokoLainId].filter(Boolean);
    const userIds = [spgId, spgLainId, pemegangId, salesmanLainId, kantorId].filter(Boolean);
    const tandaTerima = await prisma.storeReceipt.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds(tokoIds) } } });
    await prisma.storeReceiptLine.deleteMany({ where: { receiptId: { in: seededIds(tandaTerima.map((r) => r.id)) } } });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(tandaTerima.map((r) => r.id)) } } });
    await prisma.konsiTransferLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.konsiTransfer.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: { in: seededIds(orderIds) } } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.storeStock.deleteMany({ where: { storeId: { in: seededIds(tokoIds) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesOrder", entityId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.stockOpnameItem.deleteMany({ where: { opnameId: { in: seededIds(opnameIds) } } });
    await prisma.stockOpname.deleteMany({ where: { id: { in: seededIds(opnameIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.storeVisit.deleteMany({ where: { userId: { in: seededIds(userIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds(userIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  /** Pesanan konsi yang disetujui dengan aturan paling awal: dicadangkan, stok gudang belum dipotong. */
  async function pesananLama(storeId: string, qty: number, approvedAt: Date = LAMA) {
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-KLM/${token}/${urut}/${orderIds.length + 1}`,
        storeId,
        salesmanId: pemegangId,
        orderType: "KONSI",
        status: "APPROVED",
        approvedAt,
        approvedById: kantorId,
        subtotal: 0,
        total: 0,
      },
    });
    orderIds.push(o.id);
    const l = await prisma.fieldSalesOrderLine.create({
      data: { orderId: o.id, itemId, variantSku: "", productName: "Kaos konsi lama", qty, unitPrice: 0, lineTotal: 0 },
    });
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES_KONSI", fieldSalesLineId: l.id, itemId, variantSku: "", qty, state: "RESERVED", inventoryValueId: invId },
    });
    await prisma.inventoryValue.update({ where: { id: invId }, data: { reservedQty: { increment: qty } } });
    return { orderId: o.id, lineId: l.id };
  }

  const checkIn = (userId: string, storeId: string) => prisma.storeVisit.create({ data: { userId, storeId, checkinLat: 0, checkinLng: 0 } });

  /** Opname gudang sendiri yang disetujui dan menghitung barang ini. */
  async function opnameGudang(snapshotAt: Date, countedQty = 90) {
    const op = await prisma.stockOpname.create({
      data: {
        docNumber: `TEST-KLM-OPN-${token}-${urut}-${opnameIds.length + 1}`,
        scope: "FINISHED_GOOD",
        status: "APPROVED",
        snapshotAt,
        createdById: kantorId,
        approvedById: kantorId,
        approvedAt: new Date(snapshotAt.getTime() + 3_600_000),
        items: { create: [{ itemId, variantSku: null, itemName: "Kaos konsi lama", snapshotQty: 100, countedQty }] },
      },
    });
    opnameIds.push(op.id);
    return op.id;
  }

  const gudang = async () => {
    const r = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(invId) } });
    return { qty: Number(r.qtyOnHand), reserved: Number(r.reservedQty) };
  };
  const stokToko = async (storeId: string) =>
    Number((await prisma.storeStock.findFirst({ where: { storeId: seededId(storeId), itemId: seededId(itemId) } }))?.qty ?? 0);

  it("biasa: SPG mengonfirmasi semua → gudang −10 & cadangan −10, toko +10, transfer bertanda konfirmasi, baris terkirim, tanda terima buku toko, jejak", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    // Opname SEBELUM pesanan disetujui tidak dihitung: hitungannya masih memuat barang ini.
    await opnameGudang(new Date("2026-07-01T03:00:00.000Z"));
    await checkIn(spgId, tokoSpgId);

    const r = await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 10 }], idempotencyKey: `k-${token}-a` });
    expect(r).toMatchObject({ ok: true, pcs: 10, pcsSesudahOpname: 0, peran: "SPG" });
    if (!r.ok) throw new Error("gagal");

    expect(await gudang()).toEqual({ qty: 90, reserved: 0 });
    expect(await stokToko(tokoSpgId)).toBe(10);

    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(r.transferId) }, include: { lines: true } });
    expect(t).toMatchObject({ oldOrderArrival: true, shipmentId: null, orderId: p.orderId, storeId: tokoSpgId, transferredById: spgId });
    expect(t.lines.map((l) => ({ qty: Number(l.qty), unitCost: Number(l.unitCost), opname: l.mainCountedByOpnameId }))).toEqual([{ qty: 10, unitCost: 10000, opname: null }]);
    // Kartu stok gudang dipotong sekali, bertanda transfer itu.
    const main = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId), locationType: "MAIN", refId: seededId(r.transferId) } });
    expect(main.map((e) => Number(e.qty))).toEqual([-10]);

    const baris = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineId) } });
    expect(baris.deliveredQty).toBe(10);
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(p.orderId) } })).deliveryStatus).toBe("DELIVERED");
    expect((await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(p.lineId) } })).state).toBe("CONSUMED");

    const terima = await prisma.storeReceipt.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "KONSI_TRANSFER", sourceId: seededId(r.transferId) } },
      include: { lines: true },
    });
    expect(terima.lines.map((l) => [l.qtySent, l.qtyReceived])).toEqual([[10, 10]]);
    const gerak = await prisma.storeStockMovement.findMany({ where: { storeId: seededId(tokoSpgId), refId: seededId(terima.id) } });
    expect(gerak.map((g) => [g.kind, g.qty])).toEqual([["TERIMA", 10]]);

    const jejak = await prisma.auditLog.findMany({ where: { entityType: "FieldSalesOrder", entityId: seededId(p.orderId), action: JEJAK_SAMPAI_PESANAN_LAMA } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].metadata).toMatchObject({ transferId: r.transferId, pcs: 10, peran: "SPG" });

    // Tidak menjadi jenis lama yang lain (diterima per pesanan): tidak ada penerimaan kedua.
    expect((await bacaPesananKonsiLama(prisma, [p.orderId])).lama.has(p.orderId)).toBe(false);
    expect(await muatPesananKonsiCadanganLama(prisma, p.orderId)).toBeNull();
  });

  it("gudang sudah diopname SESUDAH disetujui: hanya toko yang bertambah, cadangan dilepas, qtyOnHand tidak disentuh", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    const opnameId = await opnameGudang(new Date("2026-09-01T03:00:00.000Z"));
    // Hitungan opname itu sudah mengeluarkan barang ini dari gudang (setMainStock tidak menyentuh cadangan).
    await prisma.inventoryValue.update({ where: { id: invId }, data: { qtyOnHand: 90 } });
    await checkIn(spgId, tokoSpgId);

    const r = await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 10 }] });
    expect(r).toMatchObject({ ok: true, pcs: 10, pcsSesudahOpname: 10 });
    if (!r.ok) throw new Error("gagal");

    expect(await gudang()).toEqual({ qty: 90, reserved: 0 });
    expect(await stokToko(tokoSpgId)).toBe(10);
    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(r.transferId) }, include: { lines: true } });
    expect(t.lines.map((l) => l.mainCountedByOpnameId)).toEqual([opnameId]);
    // Tidak ada potongan kartu stok gudang maupun penyesuaian KONSI_TRANSFER — yang bergerak hanya toko.
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId), locationType: "MAIN", refId: seededId(r.transferId) } })).toBe(0);
    expect(await prisma.stockAdjustment.count({ where: { itemId: seededId(itemId), source: "KONSI_TRANSFER" } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId), locationType: "STORE", refId: seededId(r.transferId) } })).toBe(1);
  });

  it("hitungan kurang: sisanya tetap dicadangkan untuk konfirmasi berikutnya, tanpa catatan barang hilang", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    await checkIn(spgId, tokoSpgId);

    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 4 }] })).toMatchObject({ ok: true, pcs: 4 });
    expect(await gudang()).toEqual({ qty: 96, reserved: 6 });
    const cadangan = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(p.lineId) } });
    expect([cadangan.state, Number(cadangan.consumedQty)]).toEqual(["RESERVED", 4]);
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(p.orderId) } })).deliveryStatus).toBe("PARTIAL");
    expect((await muatPesananKonsiCadanganLama(prisma, p.orderId))?.baris.map((b) => b.sisa)).toEqual([6]);
    expect(await prisma.stockLoss.count({ where: { storeId: seededId(tokoSpgId) } })).toBe(0);

    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 6 }] })).toMatchObject({ ok: true, pcs: 6 });
    expect(await gudang()).toEqual({ qty: 90, reserved: 0 });
    expect(await stokToko(tokoSpgId)).toBe(10);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(p.orderId), oldOrderArrival: true } })).toBe(2);
  });

  it("lebih dari sisa dan semua nol ditolak, tanpa menulis apa pun", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    await checkIn(spgId, tokoSpgId);
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 11 }] })).toEqual({ ok: false, alasan: "LEBIH_DARI_SISA" });
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 0 }] })).toEqual({ ok: false, alasan: "KOSONG" });
    expect(await gudang()).toEqual({ qty: 100, reserved: 10 });
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(p.orderId) } })).toBe(0);
  });

  it("kiriman ulang berkunci sama mendapat hasil pertama dan tidak memotong dua kali", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    await checkIn(spgId, tokoSpgId);
    const kunci = `k-${token}-ulang`;
    const a = await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 3 }], idempotencyKey: kunci });
    const b = await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 3 }], idempotencyKey: kunci });
    expect(a.ok && b.ok && b.transferId === a.transferId && b.ulang === true).toBe(true);
    expect(await gudang()).toEqual({ qty: 97, reserved: 7 });
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(p.orderId) } })).toBe(1);
  });

  it("kantor 'tidak jadi dikirim': sisa ditutup, cadangan dilepas, qtyOnHand tetap, dicap ditutup dan dicatat di jejak", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    await checkIn(spgId, tokoSpgId);
    await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 4 }] });

    expect(await batalKirimPesananLama({ orderId: p.orderId, userId: kantorId, alasan: "  " })).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await batalKirimPesananLama({ orderId: p.orderId, userId: kantorId, alasan: "Barang tidak pernah dikirim" })).toMatchObject({ ok: true, pcs: 6 });

    expect(await gudang()).toEqual({ qty: 96, reserved: 0 });
    const baris = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineId) } });
    expect([baris.deliveredQty, baris.cancelledQty]).toEqual([4, 6]);
    const o = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(p.orderId) } });
    expect(o).toMatchObject({ deliveryStatus: "CLOSED", closedById: kantorId, closeReason: "Barang tidak pernah dikirim" });
    expect((await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(p.lineId) } })).state).toBe("RELEASED");
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "FieldSalesOrder", entityId: seededId(p.orderId), action: JEJAK_BATAL_KIRIM_PESANAN_LAMA } });
    expect(jejak.map((j) => j.reason)).toEqual(["Barang tidak pernah dikirim"]);

    // Sesudahnya bukan pesanan lama lagi: tidak bisa dikonfirmasi, tidak bisa ditutup dua kali.
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgId, baris: [{ lineId: p.lineId, qty: 1 }] })).toEqual({ ok: false, alasan: "TIDAK_DITEMUKAN" });
    expect(await batalKirimPesananLama({ orderId: p.orderId, userId: kantorId, alasan: "lagi" })).toEqual({ ok: false, alasan: "TIDAK_DITEMUKAN" });
  });

  it("kantor tidak pernah bisa mengonfirmasi, juga bila sedang 'check-in' di toko itu", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    await checkIn(kantorId, tokoSpgId);
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: kantorId, baris: [{ lineId: p.lineId, qty: 10 }] })).toEqual({ ok: false, alasan: "BUKAN_PENERIMA" });
    expect(await gudang()).toEqual({ qty: 100, reserved: 10 });
  });

  it("SPG toko lain tidak bisa mengonfirmasi; pemegang toko ber-SPG juga tidak", async () => {
    const p = await pesananLama(tokoSpgId, 10);
    await checkIn(spgLainId, tokoSpgId);
    await checkIn(pemegangId, tokoSpgId);
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: spgLainId, baris: [{ lineId: p.lineId, qty: 10 }] })).toEqual({ ok: false, alasan: "BUKAN_PENERIMA" });
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: pemegangId, baris: [{ lineId: p.lineId, qty: 10 }] })).toEqual({ ok: false, alasan: "BUKAN_PENERIMA" });
    expect(await gudang()).toEqual({ qty: 100, reserved: 10 });
  });

  it("toko tanpa SPG: salesman pemegang yang sedang check-in bisa; tanpa check-in atau salesman lain tidak; buku toko tidak dibukakan", async () => {
    const p = await pesananLama(tokoTanpaSpgId, 10);
    const baris = [{ lineId: p.lineId, qty: 10 }];
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: pemegangId, baris })).toEqual({ ok: false, alasan: "TANPA_KUNJUNGAN" });
    await checkIn(salesmanLainId, tokoTanpaSpgId);
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: salesmanLainId, baris })).toEqual({ ok: false, alasan: "BUKAN_PENERIMA" });
    // Check-in di toko LAIN tidak dihitung.
    await checkIn(pemegangId, tokoSpgId);
    expect(await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: pemegangId, baris })).toEqual({ ok: false, alasan: "TANPA_KUNJUNGAN" });
    await prisma.storeVisit.updateMany({ where: { userId: seededId(pemegangId), checkoutAt: null }, data: { checkoutAt: new Date() } });
    await checkIn(pemegangId, tokoTanpaSpgId);

    const r = await konfirmasiSampaiPesananLama({ orderId: p.orderId, userId: pemegangId, baris });
    expect(r).toMatchObject({ ok: true, pcs: 10, peran: "SALESMAN", receiptId: null });
    expect(await stokToko(tokoTanpaSpgId)).toBe(10);
    expect(await prisma.storeStockMovement.count({ where: { storeId: seededId(tokoTanpaSpgId) } })).toBe(0);
  });

  it("pesanan yang disetujui SESUDAH batasnya bukan pesanan lama: tidak bisa dikonfirmasi, tetap lewat pengiriman", async () => {
    const baru = await pesananLama(tokoSpgId, 10, new Date(BAWAAN_PESANAN_LAMA_SEBELUM.getTime() + 60_000));
    const lama = await pesananLama(tokoSpgId, 5);
    await checkIn(spgId, tokoSpgId);

    const temu = await bacaPesananKonsiCadanganLama(prisma, { storeIds: [tokoSpgId] });
    expect([...temu.keys()]).toEqual([lama.orderId]);
    expect(await konfirmasiSampaiPesananLama({ orderId: baru.orderId, userId: spgId, baris: [{ lineId: baru.lineId, qty: 10 }] })).toEqual({ ok: false, alasan: "TIDAK_DITEMUKAN" });

    // Kedua jenis lama tidak pernah tertukar: yang cadangannya masih ditahan bukan jenis "diterima per pesanan".
    expect((await bacaPesananKonsiLama(prisma, [lama.orderId, baru.orderId])).lama.size).toBe(0);
    // Cakupan kosong tidak pernah menyapu seluruh tabel.
    expect((await bacaPesananKonsiCadanganLama(prisma, { storeIds: [] })).size).toBe(0);
    expect((await bacaPesananKonsiCadanganLama(prisma, {})).size).toBe(0);

    // Kantor tidak bisa mengemas pengiriman untuk pesanan lama; pesanan baru tetap bisa.
    await expect(
      createDeliveryShipment({
        orderId: lama.orderId,
        method: "EXPEDITION",
        lines: [{ orderLineId: lama.lineId, qty: 5 }],
        packedById: kantorId,
        idempotencyKey: `klm-${token}-${urut}-lama`,
      }),
    ).rejects.toMatchObject({ code: "KONSI_PESANAN_LAMA" });
    await expect(
      createDeliveryShipment({
        orderId: baru.orderId,
        method: "EXPEDITION",
        lines: [{ orderLineId: baru.lineId, qty: 10 }],
        packedById: kantorId,
        idempotencyKey: `klm-${token}-${urut}-baru`,
      }),
    ).resolves.toMatchObject({ shipmentId: expect.any(String) });
  });
});
