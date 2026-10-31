import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Basis data sungguhan: pengiriman lewat aksi → piutang nota; koreksi tanggal nota → tanggal
 * piutangnya ikut, di transaksi yang sama dengan jejak koreksinya.
 */
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PESANAN_DIKIRIM: "PESANAN_DIKIRIM", PESANAN_DITUTUP: "PESANAN_DITUTUP" },
  kabariPengguna: vi.fn(),
}));
vi.mock("./audit", () => ({ logPrint: vi.fn() }));
// Jurnal nota (lib/finance/lapangan) diuji di tempatnya sendiri; di sini ia akan menulis
// JOURNAL_PENDING untuk nota uji yang dihapus teardown (pemetaan dev belum lengkap).
vi.mock("@/lib/finance/lapangan/kait", () => ({ kaitNotaTerbit: vi.fn(async () => undefined) }));

import { recordDeliveryAction, updateDeliveryDatesAction } from "./field-sales-deliveries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("aksi pengiriman ↔ piutang nota (basis data uji)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let invId = "";
  let storeId = "";
  let salesmanId = "";
  let adminId = "";
  let orderId = "";
  let lineId = "";
  let deliveryIds: string[] = [];

  beforeEach(async () => {
    uomId = ""; itemId = ""; invId = ""; storeId = ""; salesmanId = ""; adminId = ""; orderId = ""; lineId = "";
    deliveryIds = [];

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-APN-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-APN-${token}`, nameId: "Kemeja uji", nameEn: "Test shirt", type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: 125000 },
    });
    itemId = item.id;
    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 6, reservedQty: 6, avgCost: 60000, totalValue: 360000 },
    });
    invId = inv.id;
    const store = await prisma.store.create({
      data: { code: `TEST-APN-STORE-${token}`, name: "Toko uji aksi nota", address: "Jl. Uji", termsType: "PUTUS", paymentTempo: 30, isActive: true },
    });
    storeId = store.id;
    const salesman = await prisma.user.create({ data: { email: `test-apn-sales-${token}@example.com`, name: "Sales uji aksi" } });
    salesmanId = salesman.id;
    const admin = await prisma.user.create({ data: { email: `test-apn-admin-${token}@example.com`, name: "Gudang uji aksi" } });
    adminId = admin.id;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-APN-${token}`,
        storeId,
        salesmanId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 750000,
        total: 750000,
        lines: { create: [{ itemId, variantSku: "", productName: "Kemeja uji", qty: 6, unitPrice: 125000, lineTotal: 750000 }] },
      },
      include: { lines: true },
    });
    orderId = order.id;
    lineId = order.lines[0].id;
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty: 6, state: "RESERVED" },
    });
    mockAuth.mockResolvedValue({ user: { id: adminId, permissions: ["*"] } });
  });

  afterEach(async () => {
    const nota = await prisma.fieldSalesDelivery.findMany({ where: { orderId: seededId(orderId) }, select: { id: true } });
    deliveryIds = nota.map((n) => n.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesDelivery", entityId: { in: seededIds(deliveryIds) } } });
    await prisma.receivable.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.taxInvoice.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(adminId)] } } });
  });

  it("pengiriman lewat aksi melahirkan piutang; koreksi tanggal nota ikut memindahkan tanggal piutangnya", async () => {
    const r = await recordDeliveryAction({
      orderId,
      lines: [{ orderLineId: lineId, qty: 4 }],
      invoiceDate: "2026-10-05",
      dueDate: "2026-11-04",
      idempotencyKey: `apn-${token}`,
    });
    expect(r).toEqual({ ok: true });

    const nota = await prisma.fieldSalesDelivery.findFirstOrThrow({ where: { orderId: seededId(orderId) } });
    const piutang = await prisma.receivable.findUniqueOrThrow({ where: { deliveryId: nota.id } });
    expect(Number(piutang.amount)).toBe(500000);
    expect(piutang.invoiceNo).toBe(nota.docNo);
    expect(piutang.salesmanId).toBe(salesmanId);

    const koreksi = await updateDeliveryDatesAction({
      deliveryId: nota.id,
      invoiceDate: "2026-10-07",
      dueDate: "2026-11-21",
      reason: "Salah ketik tanggal nota",
    });
    expect(koreksi).toEqual({ ok: true });

    const notaBaru = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: nota.id } });
    const piutangBaru = await prisma.receivable.findUniqueOrThrow({ where: { id: piutang.id } });
    expect(piutangBaru.invoiceDate.getTime()).toBe(notaBaru.invoiceDate.getTime());
    expect(piutangBaru.dueDate.getTime()).toBe(notaBaru.dueDate.getTime());
    expect(piutangBaru.invoiceDate.getTime()).not.toBe(piutang.invoiceDate.getTime());
    // Nilai dan sisa tidak disentuh koreksi tanggal.
    expect(Number(piutangBaru.amount)).toBe(500000);
    expect(Number(piutangBaru.outstanding)).toBe(500000);

    const jejak = await prisma.auditLog.findMany({ where: { entityType: "FieldSalesDelivery", entityId: nota.id, action: "UPDATE_DELIVERY_DATES" } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].metadata).toMatchObject({ receivableId: piutang.id });
  });

  it("koreksi tanggal nota lama yang belum punya piutang tetap berhasil dan tidak membuat piutang", async () => {
    const nota = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `TEST-APN-LAMA-${token}`,
        orderId,
        deliveredAt: new Date(),
        deliveredById: adminId,
        invoiceDate: new Date("2026-10-05T00:00:00.000+07:00"),
        dueDate: new Date("2026-11-04T00:00:00.000+07:00"),
        subtotal: 125000,
        discountAmount: 0,
        total: 125000,
      },
    });

    const koreksi = await updateDeliveryDatesAction({
      deliveryId: nota.id,
      invoiceDate: "2026-10-06",
      dueDate: "2026-11-05",
      reason: "Tanggal nota lama dibetulkan",
    });
    expect(koreksi).toEqual({ ok: true });
    expect(await prisma.receivable.count({ where: { deliveryId: nota.id } })).toBe(0);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "FieldSalesDelivery", entityId: nota.id } });
    expect(jejak.metadata).toMatchObject({ receivableId: null });
  });
});
