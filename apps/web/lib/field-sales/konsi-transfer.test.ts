import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder } from "./writer";
import { InsufficientStockError } from "./errors";
import { stokDiToko } from "@/lib/konsinyasi/stok-di-toko";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * Toko konsinyasi = gudang lain milik kita (keputusan pemilik): pesanan konsinyasi yang
 * DISETUJUI memindahkan barang keluar dari gudang utama ke stok toko itu.
 *
 * Angka uji: gudang 50 pcs × Rp40.000 = Rp2.000.000. Kirim 10 → gudang 40 pcs, Rp1.600.000,
 * titipan toko 10.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("persetujuan konsinyasi memindahkan stok gudang ke toko", () => {
  const tag = `KTR${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let orderIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    visitId = "";
    orderIds = [];
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
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    visitId = (await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } })).id;
  });

  afterEach(async () => {
    const notif = await prisma.adminNotification.findMany({ where: { category: "PENDING_ORDER_APPROVAL" }, select: { id: true, metadata: true } });
    const milik = notif.filter((n) => orderIds.includes(String((n.metadata as { orderId?: string } | null)?.orderId ?? "")));
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik.map((n) => n.id)) } } });
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

  const pesan = async (lines: Array<{ variantSku: string; qty: number }>) => {
    const { orderId } = await createFieldSalesOrder({
      storeId,
      salesmanId,
      visitId,
      lines: lines.map((l) => ({ itemId, variantSku: l.variantSku, productName: "Blus", qty: l.qty, unitPrice: 0 })),
    });
    orderIds.push(orderId);
    return orderId;
  };

  const gudang = async (variantSku: string | null = null) => {
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku } });
    return { qty: Number(inv!.qtyOnHand), reserved: Number(inv!.reservedQty), nilai: Number(inv!.totalValue), avg: Number(inv!.avgCost) };
  };

  it("kirim 10 pcs: gudang 50→40 (Rp2.000.000→Rp1.600.000), titipan toko +10, tanpa penjualan", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    const jualSebelum = await prisma.salesHistory.count({ where: { itemId } });

    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });

    expect(await gudang()).toEqual({ qty: 40, reserved: 0, nilai: 1_600_000, avg: 40000 });
    const adj = await prisma.stockAdjustment.findMany({ where: { itemId } });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ source: "KONSI_TRANSFER", type: "NEGATIVE" });
    expect(Number(adj[0].qtyChange)).toBe(-10);
    expect(Number(adj[0].prevQty)).toBe(50);
    expect(Number(adj[0].newQty)).toBe(40);
    expect(Number(adj[0].prevAvgCost)).toBe(40000);
    expect(Number(adj[0].newAvgCost)).toBe(40000);

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: order!.lines[0].id } });
    expect(rsv).toMatchObject({ source: "FIELD_SALES_KONSI", state: "CONSUMED" });
    expect(Number(rsv!.consumedQty)).toBe(10);

    const toko = await stokDiToko(storeId);
    expect(toko.source).toBe("TITIPAN");
    expect(toko.baris.map((b) => ({ itemId: b.itemId, qty: b.qty }))).toEqual([{ itemId, qty: 10 }]);

    // Transfer, bukan penjualan.
    expect(await prisma.salesHistory.count({ where: { itemId } })).toBe(jualSebelum);
  });

  it("persetujuan ulang tidak memotong dua kali", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    expect((await gudang()).qty).toBe(40);
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(1);
  });

  it("dua persetujuan bersamaan: satu pengurangan", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    const hasil = await Promise.allSettled([
      approveFieldSalesOrder({ orderId, approvedById: salesmanId }),
      approveFieldSalesOrder({ orderId, approvedById: salesmanId }),
    ]);
    expect(hasil.filter((h) => h.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await gudang()).toEqual({ qty: 40, reserved: 0, nilai: 1_600_000, avg: 40000 });
    expect(await prisma.stockAdjustment.count({ where: { itemId, source: "KONSI_TRANSFER" } })).toBe(1);
  });

  it("barang bervarian: hanya varian yang dikirim yang berkurang", async () => {
    await stokAwal([
      { variantSku: `${tag}-S`, qty: 20 },
      { variantSku: `${tag}-M`, qty: 20 },
    ]);
    const orderId = await pesan([{ variantSku: `${tag}-M`, qty: 6 }]);
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    expect((await gudang(`${tag}-S`)).qty).toBe(20);
    expect(await gudang(`${tag}-M`)).toEqual({ qty: 14, reserved: 0, nilai: 560_000, avg: 40000 });
  });

  it("stok tersedia kurang: ditolak, gudang dan status tidak berubah", async () => {
    await stokAwal([{ variantSku: null, qty: 4 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    await expect(approveFieldSalesOrder({ orderId, approvedById: salesmanId })).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await gudang()).qty).toBe(4);
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(0);
    expect((await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } }))!.status).toBe("PENDING_APPROVAL");
  });
});
