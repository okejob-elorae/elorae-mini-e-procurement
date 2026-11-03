import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";

/*
 * Pesanan lapangan yang mengubah available gudang meneruskannya ke Jubelio
 * (baris `stock_push` PENDING), sesudah commit:
 *  - putus dibuat → stok dicadangkan (available turun);
 *  - putus dibatalkan salesman / ditolak kantor → cadangan dilepas (available naik);
 *  - putus dikirim → stok keluar saat surat jalan DIBUAT (`createShipmentAction`), sisa ditutup →
 *    cadangan dilepas;
 *  - konsi disetujui → stok dicadangkan (available turun); barangnya baru keluar
 *    gudang utama saat surat jalannya dibuat (masuk perjalanan ke toko).
 * Basis data uji sungguhan; fan-out notifikasi, panggilan api, sesi dan jurnal ditiru — jurnal
 * bukan yang diuji di sini, dan memostingnya akan menulis buku besar di basis data bersama.
 */

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 200 })) }));
vi.mock("@/lib/finance/ar/post-ar-journal-safely", () => ({ postArJournalSafely: vi.fn(async () => ({ ok: true })) }));

const { createFieldSalesOrder, approveFieldSalesOrder, rejectFieldSalesOrder, cancelFieldSalesOrderBySalesman } = await import(
  "./writer"
);
const { closeFieldSalesOrderRemainder } = await import("./delivery/writer");
const { catatNotaUji } = await import("./delivery/uji-nota");
const { createShipmentAction } = await import("@/app/actions/delivery-shipments");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const acak = () => 1_500_000_000 + Math.floor(Math.random() * 400_000_000);

d("push stok Jubelio dari pesanan lapangan (test bed only)", () => {
  const tag = `PSP${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let itemId = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let salesmanId = "";
  let adminId = "";
  let visitIds: string[] = [];
  let orderIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    tokoPutus = "";
    tokoKonsi = "";
    salesmanId = "";
    adminId = "";
    visitIds = [];
    orderIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 75000 },
      })
    ).id;
    await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: acak(), jubelioItemId: acak(), jubelioItemCode: tag, erpVariantSku: "" },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 50, reservedQty: 0, avgCost: 40000, totalValue: 2_000_000 },
    });
    tokoPutus = (
      await prisma.store.create({ data: { code: `SP-${tag}`, name: `${tag} Putus`, address: "uji", termsType: "PUTUS", isActive: true } })
    ).id;
    tokoKonsi = (
      await prisma.store.create({
        data: { code: `SK-${tag}`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", markupPercent: 25, isActive: true },
      })
    ).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    adminId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } })).id;
    for (const storeId of [tokoPutus, tokoKonsi]) {
      visitIds.push((await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } })).id);
    }
  });

  afterEach(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
    const notif = await prisma.adminNotification.findMany({
      where: { category: { in: ["PENDING_ORDER_APPROVAL", "STOCK_OVERSELL_RISK"] } },
      select: { id: true, metadata: true },
    });
    const milik = notif.filter((n) => orderIds.includes(String((n.metadata as { orderId?: string } | null)?.orderId ?? "")));
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik.map((n) => n.id)) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(orderIds) } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.deliveryShipmentLine.deleteMany({ where: { shipment: { orderId: { in: seededIds(orderIds) } } } });
    await prisma.deliveryShipment.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: { in: seededIds(orderIds) } } } });
    await prisma.receivable.deleteMany({ where: { storeId: seededId(tokoPutus) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoKonsi].filter(Boolean)) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const antrean = () =>
    prisma.jubelioOutbox.findMany({
      where: { entityType: "stock_push", entityId: seededId(itemId), status: "PENDING" },
      select: { id: true, payload: true },
    });
  /** Baris lama dianggap sudah diproses api, supaya perubahan berikutnya mendapat baris sendiri. */
  const tandaiSelesai = () =>
    prisma.jubelioOutbox.updateMany({
      where: { entityType: "stock_push", entityId: seededId(itemId), status: "PENDING" },
      data: { status: "DONE", processedAt: new Date() },
    });
  const gudang = async () => {
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId }, select: { qtyOnHand: true, reservedQty: true } });
    return { onHand: Number(inv?.qtyOnHand), reserved: Number(inv?.reservedQty) };
  };
  const pesan = async (storeId: string, visitId: string, qty: number) => {
    const { orderId, orderNo } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "Blus", qty, unitPrice: 0 }],
    });
    orderIds.push(orderId);
    return { orderId, orderNo };
  };

  /**
   * Nota putus terbit saat surat jalan DIBUAT (P44a: "Catat pengiriman" dihapus). Lewat aksi
   * produksinya sendiri — `createShipmentAction` adalah satu-satunya yang mengantre push stok untuk
   * nota, jadi tes ini gagal kalau aksi itu berhenti mengantre.
   */
  const buatSuratJalan = async (orderId: string, lines: Array<{ orderLineId: string; qty: number }>, idempotencyKey: string) => {
    mockAuth.mockResolvedValue({ user: { id: adminId, permissions: ["deliveries:ship"] } });
    const hasil = await createShipmentAction({
      orderId,
      method: "EXPEDITION",
      lines,
      idempotencyKey,
      dueDate: formatDateOnlyJakarta(new Date(Date.now() + 30 * 86_400_000)),
    });
    if (!hasil.ok) throw new Error(`createShipmentAction menolak: ${hasil.reason}`);
    if (!hasil.docNo || !hasil.shipmentId) throw new Error("createShipmentAction tidak mengembalikan nomor surat jalan");
    return { docNo: hasil.docNo, shipmentId: hasil.shipmentId, ulang: hasil.ulang === true };
  };

  it("putus dibuat lalu dibatalkan salesman: tiap perubahan cadangan mengantrekan push", async () => {
    const { orderId, orderNo } = await pesan(tokoPutus, visitIds[0], 12);
    expect(await gudang()).toEqual({ onHand: 50, reserved: 12 });
    const dibuat = await antrean();
    expect(dibuat).toHaveLength(1);
    expect(JSON.stringify(dibuat[0].payload)).toContain(orderNo);

    await tandaiSelesai();
    await cancelFieldSalesOrderBySalesman({ orderId, salesmanId, reason: "toko batal" });
    expect(await gudang()).toEqual({ onHand: 50, reserved: 0 });
    expect(await antrean()).toHaveLength(1);
  });

  it("putus ditolak kantor: cadangan dilepas dan push diantrekan", async () => {
    const { orderId } = await pesan(tokoPutus, visitIds[0], 6);
    await tandaiSelesai();

    await rejectFieldSalesOrder({ orderId, rejectedById: adminId, reason: "stok untuk marketplace" });
    expect(await gudang()).toEqual({ onHand: 50, reserved: 0 });
    expect(await antrean()).toHaveLength(1);
  });

  it("putus dikirim 5 dari 12 lewat surat jalan: aksi pembuatnya mengantrekan push; tutup sisa selagi dikemas ditolak tanpa push", async () => {
    const { orderId } = await pesan(tokoPutus, visitIds[0], 12);
    await approveFieldSalesOrder({ orderId, approvedById: adminId });
    await tandaiSelesai();

    const baris = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } });
    const { docNo } = await buatSuratJalan(orderId, [{ orderLineId: baris.id, qty: 5 }], `${tag}-kirim-5`);
    expect(await gudang()).toEqual({ onHand: 45, reserved: 7 });
    const kirim = await antrean();
    expect(kirim).toHaveLength(1);
    expect(JSON.stringify(kirim[0].payload)).toContain(docNo);

    // Surat jalannya masih PACKED: sisanya belum boleh ditutup, cadangan tetap, tidak ada push.
    await tandaiSelesai();
    await expect(closeFieldSalesOrderRemainder({ orderId, closedById: adminId, reason: "toko cukup 5" })).rejects.toMatchObject({
      code: "SHIPMENT_IN_FLIGHT",
    });
    expect(await gudang()).toEqual({ onHand: 45, reserved: 7 });
    expect(await antrean()).toHaveLength(0);
  });

  it("sisa putus ditutup: cadangan dilepas dan push diantrekan", async () => {
    const { orderId } = await pesan(tokoPutus, visitIds[0], 12);
    await approveFieldSalesOrder({ orderId, approvedById: adminId });
    const baris = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } });
    // Nota tanpa surat jalan: penutupan menolak selama ada surat jalan yang belum tuntas.
    await catatNotaUji({
      orderId,
      deliveredById: adminId,
      lines: [{ orderLineId: baris.id, qty: 5 }],
      invoiceDate: new Date("2026-10-06T00:00:00+07:00"),
      dueDate: new Date("2026-10-20T00:00:00+07:00"),
    });
    expect(await gudang()).toEqual({ onHand: 45, reserved: 7 });
    await tandaiSelesai();

    await closeFieldSalesOrderRemainder({ orderId, closedById: adminId, reason: "toko cukup 5" });
    expect(await gudang()).toEqual({ onHand: 45, reserved: 0 });
    expect(await antrean()).toHaveLength(1);
  });

  it("kiriman ulang berkunci sama tidak menggerakkan stok dua kali; surat jalan ulang mendorong angka mutlak yang sama lagi", async () => {
    const kunciPesanan = `${tag}-pesan-1`;
    const masukan = {
      storeId: tokoPutus,
      salesmanId,
      visitId: visitIds[0],
      idempotencyKey: kunciPesanan,
      lines: [{ itemId, variantSku: "", productName: "Blus", qty: 8, unitPrice: 0 }],
    };
    const pertama = await createFieldSalesOrder(masukan);
    orderIds.push(pertama.orderId);
    expect(await antrean()).toHaveLength(1);
    await tandaiSelesai();

    const ulang = await createFieldSalesOrder(masukan);
    expect(ulang.orderId).toBe(pertama.orderId);
    expect(await gudang()).toEqual({ onHand: 50, reserved: 8 });
    expect(await antrean()).toHaveLength(0);

    await approveFieldSalesOrder({ orderId: pertama.orderId, approvedById: adminId });
    // Persetujuan putus hanya kertas: stok belum bergerak, tidak ada push.
    expect(await antrean()).toHaveLength(0);

    const baris = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: pertama.orderId }, select: { id: true } });
    const kunciKirim = `${tag}-kirim-1`;
    const k1 = await buatSuratJalan(pertama.orderId, [{ orderLineId: baris.id, qty: 3 }], kunciKirim);
    expect(await gudang()).toEqual({ onHand: 47, reserved: 5 });
    expect(await antrean()).toHaveLength(1);
    await tandaiSelesai();

    /*
     * Ulangan berkunci sama mengembalikan surat jalan yang sama dan tidak memindahkan stok lagi.
     * Aksinya sengaja tetap mendorong stok (R1: jawaban pertama bisa hilang sebelum push berjalan);
     * angka yang didorong mutlak, jadi dorongan kedua tidak mengubah apa pun di Jubelio.
     */
    const k2 = await buatSuratJalan(pertama.orderId, [{ orderLineId: baris.id, qty: 3 }], kunciKirim);
    expect(k2.ulang).toBe(true);
    expect(k2.shipmentId).toBe(k1.shipmentId);
    expect(await prisma.deliveryShipment.count({ where: { orderId: pertama.orderId } })).toBe(1);
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId: pertama.orderId } })).toBe(1);
    expect(await gudang()).toEqual({ onHand: 47, reserved: 5 });
    const dorongUlang = await antrean();
    expect(dorongUlang).toHaveLength(1);
    expect(JSON.stringify(dorongUlang[0].payload)).toContain(k1.docNo);
  });

  it("konsi: dibuat tanpa push (stok belum bergerak), disetujui 10 pcs dicadangkan dan push diantrekan", async () => {
    const { orderId, orderNo } = await pesan(tokoKonsi, visitIds[1], 10);
    expect(await antrean()).toHaveLength(0);

    await approveFieldSalesOrder({ orderId, approvedById: adminId });
    expect(await gudang()).toEqual({ onHand: 50, reserved: 10 });
    const baris = await antrean();
    expect(baris).toHaveLength(1);
    expect(JSON.stringify(baris[0].payload)).toContain(orderNo);
  });
});
