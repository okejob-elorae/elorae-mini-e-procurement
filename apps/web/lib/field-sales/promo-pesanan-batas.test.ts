import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(),
}));

import { approveFieldSalesOrder, batasiPromoPesanan } from "./writer";
import { recordFieldSalesDelivery } from "./delivery/writer";

/*
 * Keputusan pemilik 2026-10-06 (sementara): promo tingkat PESANAN tidak boleh
 * membuat total pesanan di bawah 0 sesudah harga final banding. Potongannya
 * dibatasi ke subtotal bersih (subtotal − potongan baris), dan angka yang
 * dibatasi itulah yang disimpan — pengiriman memprorata `orderDiscountAmount`.
 */

describe("batasiPromoPesanan (murni)", () => {
  it("potongan di bawah subtotal bersih tidak berubah", () => {
    expect(batasiPromoPesanan(100_000, 200_000)).toBe(100_000);
  });
  it("potongan melebihi subtotal bersih dipotong ke subtotal bersih", () => {
    expect(batasiPromoPesanan(100_000, 50_000)).toBe(50_000);
  });
  it("subtotal bersih 0 atau minus → potongan 0", () => {
    expect(batasiPromoPesanan(100_000, 0)).toBe(0);
    expect(batasiPromoPesanan(100_000, -5_000)).toBe(0);
  });
  it("potongan minus tidak pernah menaikkan total", () => {
    expect(batasiPromoPesanan(-1, 50_000)).toBe(0);
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("promo pesanan dibatasi saat harga final banding (basis data uji)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let orderId = "";
  let barisId = "";
  let invId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; storeId = ""; salesmanId = ""; orderId = ""; barisId = ""; invId = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PB-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `TEST-PB-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
      })
    ).id;
    storeId = (
      await prisma.store.create({
        data: { code: `TEST-PB-STORE-${token}`, name: "Toko uji promo pesanan", address: "Jl. Uji", termsType: "PUTUS", isActive: true },
      })
    ).id;
    salesmanId = (await prisma.user.create({ data: { email: `test-pb-${token}@example.com`, name: "Sales uji promo" } })).id;
    /*
     * 10 pcs × 35.000 = 350.000, promo pesanan Rp 100.000 saat dibuat → 250.000.
     * Salesman mengajukan 5.000 per potong.
     */
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `PUTUS/TEST-PB-${token}`,
        storeId,
        salesmanId,
        status: "PENDING_APPROVAL",
        orderType: "PUTUS",
        subtotal: 350000,
        orderDiscountAmount: 100000,
        total: 250000,
        lines: {
          create: [
            {
              itemId,
              variantSku: "",
              productName: "Kaos uji",
              qty: 10,
              unitPrice: 35000,
              lineTotal: 350000,
              requestedUnitPrice: 5000,
              appealReason: "Barang cacat",
            },
          ],
        },
      },
      include: { lines: true },
    });
    orderId = order.id;
    barisId = order.lines[0].id;
  });

  afterEach(async () => {
    await prisma.receivable.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: seededId(orderId) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    if (invId) await prisma.inventoryValue.deleteMany({ where: { id: seededId(invId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(salesmanId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const pesanan = () => prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(orderId) } });

  it("harga final 5.000: subtotal 50.000, promo 100.000 dibatasi 50.000, total 0 (bukan −50.000)", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId, finalPrices: [{ lineId: barisId, finalUnitPrice: 5000 }] });
    const o = await pesanan();
    expect(Number(o.subtotal)).toBe(50000);
    expect(Number(o.orderDiscountAmount)).toBe(50000);
    expect(Number(o.total)).toBe(0);
  });

  it("harga final 20.000: subtotal 200.000 masih di atas promo, promo 100.000 utuh, total 100.000", async () => {
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId, finalPrices: [{ lineId: barisId, finalUnitPrice: 20000 }] });
    const o = await pesanan();
    expect(Number(o.orderDiscountAmount)).toBe(100000);
    expect(Number(o.total)).toBe(100000);
  });

  it("sampai ke nota: kiriman penuh bernilai 0 dengan potongan pesanan 50.000, bukan nota minus", async () => {
    invId = (
      await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 10, avgCost: 20000, totalValue: 200000 } })
    ).id;
    await prisma.stockReservation.create({
      data: { source: "FIELD_SALES", fieldSalesLineId: barisId, itemId, variantSku: "", qty: 10, state: "RESERVED" },
    });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId, finalPrices: [{ lineId: barisId, finalUnitPrice: 5000 }] });

    const { deliveryId } = await recordFieldSalesDelivery({
      orderId,
      deliveredById: salesmanId,
      lines: [{ orderLineId: barisId, qty: 10 }],
      invoiceDate: new Date("2026-10-06T00:00:00.000+07:00"),
      dueDate: new Date("2026-11-05T00:00:00.000+07:00"),
    });
    const nota = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(deliveryId) } });
    expect(Number(nota.subtotal)).toBe(50000);
    expect(Number(nota.discountAmount)).toBe(50000);
    expect(Number(nota.total)).toBe(0);
  });
});
