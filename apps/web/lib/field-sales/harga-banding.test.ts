import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { approveFieldSalesOrder, HargaFinalTidakSahError } from "./writer";
import { recordFieldSalesDelivery } from "./delivery/writer";
import { InvalidFinalPriceError } from "./errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Menulis pesanan sungguhan — jangan pernah di basis data produksi. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Keputusan pemilik: harga final banding = harga BERSIH per potong. Promo baris yang dihitung dari
 * harga toko tidak boleh ikut memotong harga final — 100.000 promo 10% dibanding 80.000 harus
 * tertagih 80.000, bukan 70.000.
 */
d("harga final banding tidak bertumpuk dengan promo baris (basis data uji)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let promoId = "";
  let orderId = "";
  let barisBandingId = "";
  let barisBiasaId = "";
  let invId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; storeId = ""; salesmanId = ""; promoId = ""; orderId = ""; barisBandingId = ""; barisBiasaId = "";
    invId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-HB-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-HB-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 100000 },
    });
    itemId = item.id;
    const store = await prisma.store.create({
      data: { code: `TEST-HB-STORE-${token}`, name: "Toko uji banding", address: "Jl. Uji", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;
    const user = await prisma.user.create({ data: { email: `test-hb-${token}@example.com`, name: "Sales uji banding" } });
    salesmanId = user.id;
    const promo = await prisma.promo.create({
      data: {
        name: `TEST-PROMO-HB-${token}`,
        type: "PERCENT",
        level: "LINE",
        termsType: "PUTUS",
        value: 10,
        allStores: true,
        isActive: false,
        items: { create: [{ itemId }] },
      },
    });
    promoId = promo.id;

    /*
     * Dua baris dengan promo 10% dari harga toko 100.000 (potongan 10.000 per potong):
     * - baris banding: 1 pcs, diajukan 80.000;
     * - baris biasa: 2 pcs, tanpa banding (potongannya 20.000 tetap berlaku).
     * Promo tingkat pesanan 5.000 dihormati sejak dibuat.
     */
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-HB-${token}`,
        storeId,
        salesmanId,
        status: "PENDING_APPROVAL",
        orderType: "PUTUS",
        subtotal: 300000,
        orderDiscountAmount: 5000,
        total: 300000 - 10000 - 20000 - 5000,
        lines: {
          create: [
            {
              itemId,
              variantSku: "",
              productName: "Kaos uji banding",
              qty: 1,
              unitPrice: 100000,
              lineTotal: 100000,
              discountAmount: 10000,
              appliedPromoId: promoId,
              requestedUnitPrice: 80000,
              appealReason: "Harga pesaing",
            },
            {
              itemId,
              variantSku: "",
              productName: "Kaos uji biasa",
              qty: 2,
              unitPrice: 100000,
              lineTotal: 200000,
              discountAmount: 20000,
              appliedPromoId: promoId,
            },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    barisBandingId = order.lines.find((l) => l.productName === "Kaos uji banding")!.id;
    barisBiasaId = order.lines.find((l) => l.productName === "Kaos uji biasa")!.id;
  });

  afterEach(async () => {
    // Piutang lebih dulu: nota tidak bisa dihapus selama piutangnya masih menunjuknya.
    await prisma.receivable.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    // Pengiriman memotong stok lewat buku stok — barisnya ikut dibersihkan.
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.promoItem.deleteMany({ where: { promoId: seededId(promoId) } });
    await prisma.promo.deleteMany({ where: { id: seededId(promoId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("100.000 promo 10% dibanding 80.000 tertagih 80.000: potongan baris banding menjadi 0", async () => {
    await approveFieldSalesOrder({
      orderId,
      approvedById: salesmanId,
      finalPrices: [{ lineId: barisBandingId, finalUnitPrice: 80000 }],
    });

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, include: { lines: true } });
    const banding = order.lines.find((l) => l.id === barisBandingId)!;
    const biasa = order.lines.find((l) => l.id === barisBiasaId)!;

    expect(order.status).toBe("APPROVED");
    expect(Number(banding.unitPrice)).toBe(80000);
    expect(Number(banding.lineTotal)).toBe(80000);
    expect(Number(banding.discountAmount)).toBe(0);
    expect(banding.appliedPromoId).toBeNull();
    // Bersih baris banding = 80.000, bukan 70.000.
    expect(Number(banding.lineTotal) - Number(banding.discountAmount)).toBe(80000);

    // Baris tanpa banding tetap memakai promonya.
    expect(Number(biasa.discountAmount)).toBe(20000);
    expect(biasa.appliedPromoId).toBe(promoId);

    // Promo tingkat pesanan dihormati apa adanya sejak dibuat.
    expect(Number(order.orderDiscountAmount)).toBe(5000);
    expect(Number(order.subtotal)).toBe(80000 + 200000);
    expect(Number(order.total)).toBe(80000 + (200000 - 20000) - 5000);
  });

  it("sampai ke nota dan piutang: baris banding tertagih 80.000, baris biasa 180.000, minus promo pesanan 5.000", async () => {
    const inv = await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 3, reservedQty: 3, avgCost: 40000, totalValue: 120000 },
    });
    invId = inv.id;
    for (const [lineId, qty] of [[barisBandingId, 1], [barisBiasaId, 2]] as const) {
      await prisma.stockReservation.create({
        data: { source: "FIELD_SALES", fieldSalesLineId: lineId, itemId, variantSku: "", qty, state: "RESERVED" },
      });
    }
    await approveFieldSalesOrder({
      orderId,
      approvedById: salesmanId,
      finalPrices: [{ lineId: barisBandingId, finalUnitPrice: 80000 }],
    });

    const { deliveryId } = await recordFieldSalesDelivery({
      orderId,
      deliveredById: salesmanId,
      lines: [
        { orderLineId: barisBandingId, qty: 1 },
        { orderLineId: barisBiasaId, qty: 2 },
      ],
      invoiceDate: new Date("2026-10-05T00:00:00.000+07:00"),
      dueDate: new Date("2026-11-04T00:00:00.000+07:00"),
    });

    const baris = await prisma.fieldSalesDeliveryLine.findMany({ where: { deliveryId: seededId(deliveryId) } });
    const notaBanding = baris.find((b) => b.orderLineId === barisBandingId)!;
    expect(Number(notaBanding.lineTotal) - Number(notaBanding.discountAmount)).toBe(80000);

    // 80.000 + (200.000 − 20.000) − 5.000 = 255.000 — bukan 245.000 (promo 10.000 ikut menumpuk).
    const nota = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(deliveryId) } });
    expect(Number(nota.total)).toBe(255000);
    const piutang = await prisma.receivable.findUniqueOrThrow({ where: { deliveryId: seededId(deliveryId) } });
    expect(Number(piutang.amount)).toBe(255000);
  });

  it("baris banding yang TIDAK diberi harga final ditolak (MISSING_FINAL_PRICE) dan pesanan tidak berubah", async () => {
    const err = await approveFieldSalesOrder({ orderId, approvedById: salesmanId, finalPrices: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidFinalPriceError);
    expect((err as InvalidFinalPriceError).code).toBe("MISSING_FINAL_PRICE");

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, include: { lines: true } });
    expect(order.status).toBe("PENDING_APPROVAL");
    const banding = order.lines.find((l) => l.id === barisBandingId)!;
    expect(Number(banding.unitPrice)).toBe(100000);
    expect(Number(banding.discountAmount)).toBe(10000);
    expect(banding.appliedPromoId).toBe(promoId);
    expect(Number(order.total)).toBe(300000 - 10000 - 20000 - 5000);
  });

  it("harga final di bawah 0 ditolak dan pesanan tidak berubah", async () => {
    await expect(
      approveFieldSalesOrder({
        orderId,
        approvedById: salesmanId,
        finalPrices: [{ lineId: barisBandingId, finalUnitPrice: -1 }],
      }),
    ).rejects.toBeInstanceOf(HargaFinalTidakSahError);

    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, include: { lines: true } });
    expect(order.status).toBe("PENDING_APPROVAL");
    const banding = order.lines.find((l) => l.id === barisBandingId)!;
    expect(Number(banding.unitPrice)).toBe(100000);
    expect(Number(banding.discountAmount)).toBe(10000);
  });

  it("harga final yang bukan angka terhingga ditolak", async () => {
    await expect(
      approveFieldSalesOrder({
        orderId,
        approvedById: salesmanId,
        finalPrices: [{ lineId: barisBandingId, finalUnitPrice: Number.NaN }],
      }),
    ).rejects.toBeInstanceOf(HargaFinalTidakSahError);
  });

  it("harga final 0 (barang diberikan) sah: tertagih 0, bukan minus", async () => {
    await approveFieldSalesOrder({
      orderId,
      approvedById: salesmanId,
      finalPrices: [{ lineId: barisBandingId, finalUnitPrice: 0 }],
    });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) }, include: { lines: true } });
    const banding = order.lines.find((l) => l.id === barisBandingId)!;
    expect(Number(banding.lineTotal)).toBe(0);
    expect(Number(banding.discountAmount)).toBe(0);
    expect(Number(order.total)).toBe(0 + (200000 - 20000) - 5000);
  });
});
