import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder } from "./writer";
import { InsufficientStockError } from "./errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * Persetujuan pesanan konsinyasi hanya MENCADANGKAN stok gudang utama. Barangnya baru keluar
 * gudang ke toko saat pengiriman selesai (satu `KonsiTransfer` per pengiriman), jadi kiriman yang
 * kurang atau ditolak tidak pernah sampai di toko.
 *
 * Angka uji: gudang 50 pcs × Rp40.000 = Rp2.000.000. Setujui 10 → gudang tetap 50 pcs dan
 * Rp2.000.000, 10 di antaranya dicadangkan; belum ada yang pindah ke toko.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("persetujuan konsinyasi mencadangkan stok gudang, belum memindahkannya ke toko", () => {
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
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
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

  /** Belum ada yang keluar gudang: tanpa penyesuaian, tanpa buku stok, tanpa stok toko, tanpa transfer. */
  const belumPindah = async () => {
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(0);
    expect(await prisma.storeStock.count({ where: { storeId, itemId } })).toBe(0);
    expect(await prisma.konsiTransfer.count({ where: { orderId: { in: seededIds(orderIds) } } })).toBe(0);
  };

  it("setujui 10 pcs: gudang tetap 50 (Rp2.000.000), 10 dicadangkan, belum ada yang pindah ke toko, tanpa penjualan", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    const jualSebelum = await prisma.salesHistory.count({ where: { itemId } });

    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });

    expect(await gudang()).toEqual({ qty: 50, reserved: 10, nilai: 2_000_000, avg: 40000 });
    await belumPindah();

    const order = await prisma.fieldSalesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    expect(order!.status).toBe("APPROVED");
    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: order!.lines[0].id } });
    expect(rsv).toMatchObject({ source: "FIELD_SALES_KONSI", state: "RESERVED" });
    expect(Number(rsv!.qty)).toBe(10);
    expect(Number(rsv!.consumedQty)).toBe(0);

    // Transfer, bukan penjualan.
    expect(await prisma.salesHistory.count({ where: { itemId } })).toBe(jualSebelum);
  });

  it("persetujuan ulang tidak mencadangkan dua kali", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    expect(await gudang()).toEqual({ qty: 50, reserved: 10, nilai: 2_000_000, avg: 40000 });
    expect(await prisma.stockReservation.count({ where: { itemId } })).toBe(1);
    await belumPindah();
  });

  it("dua persetujuan bersamaan: satu cadangan", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    const hasil = await Promise.allSettled([
      approveFieldSalesOrder({ orderId, approvedById: salesmanId }),
      approveFieldSalesOrder({ orderId, approvedById: salesmanId }),
    ]);
    expect(hasil.filter((h) => h.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await gudang()).toEqual({ qty: 50, reserved: 10, nilai: 2_000_000, avg: 40000 });
    expect(await prisma.stockReservation.count({ where: { itemId, source: "FIELD_SALES_KONSI" } })).toBe(1);
    await belumPindah();
  });

  it("barang bervarian: hanya varian yang dipesan yang dicadangkan", async () => {
    await stokAwal([
      { variantSku: `${tag}-S`, qty: 20 },
      { variantSku: `${tag}-M`, qty: 20 },
    ]);
    const orderId = await pesan([{ variantSku: `${tag}-M`, qty: 6 }]);
    await approveFieldSalesOrder({ orderId, approvedById: salesmanId });
    expect(await gudang(`${tag}-S`)).toEqual({ qty: 20, reserved: 0, nilai: 800_000, avg: 40000 });
    expect(await gudang(`${tag}-M`)).toEqual({ qty: 20, reserved: 6, nilai: 800_000, avg: 40000 });
    await belumPindah();
  });

  it("stok tersedia kurang: ditolak, tanpa cadangan, status tidak berubah", async () => {
    await stokAwal([{ variantSku: null, qty: 4 }]);
    const orderId = await pesan([{ variantSku: "", qty: 10 }]);
    await expect(approveFieldSalesOrder({ orderId, approvedById: salesmanId })).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await gudang()).toEqual({ qty: 4, reserved: 0, nilai: 160_000, avg: 40000 });
    expect(await prisma.stockReservation.count({ where: { itemId } })).toBe(0);
    await belumPindah();
    expect((await prisma.fieldSalesOrder.findUnique({ where: { id: orderId } }))!.status).toBe("PENDING_APPROVAL");
  });
});
