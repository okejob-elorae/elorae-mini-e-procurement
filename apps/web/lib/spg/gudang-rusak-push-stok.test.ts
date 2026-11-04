import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Gudang barang rusak: hanya PERBAIKI yang menambah stok JUAL gudang, jadi
 * hanya PERBAIKI yang meneruskan available baru ke Jubelio (baris `stock_push`
 * PENDING) — sesudah commit. JUAL_OBRAL/MUSNAHKAN tidak menyentuh stok jual.
 * Basis data uji sungguhan; panggilan ke api ditiru.
 */

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 200 })) }));

const { putuskanGudangRusak } = await import("./gudang-rusak-writer");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `PSR-${Math.random().toString(36).slice(2, 9)}`;
const acak = () => 1_500_000_000 + Math.floor(Math.random() * 400_000_000);

d("push stok Jubelio dari keputusan gudang barang rusak (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let userId = "";

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos Rusak", nameEn: "Damaged Tee", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: acak(), jubelioItemId: acak(), jubelioItemCode: tag, erpVariantSku: "" },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 },
    });
    userId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: tag } })).id;
    // Saldo gudang rusak awal: 3 pcs dari retur toko.
    await prisma.damagedStockMovement.create({
      data: { itemId, variantSku: "", productName: "Kaos Rusak", qty: 3, kind: "MASUK_RETUR", createdById: userId },
    });
  });

  beforeEach(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
  });

  afterAll(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
    const gerak = await prisma.damagedStockMovement.findMany({ where: { itemId: seededId(itemId) }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(gerak.map((g) => g.id)) } } });
    await prisma.damagedStockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  const antrean = () =>
    prisma.jubelioOutbox.findMany({
      where: { entityType: "stock_push", entityId: seededId(itemId), status: "PENDING" },
      select: { id: true },
    });

  it("MUSNAHKAN tidak menyentuh stok jual dan tidak mengantrekan push", async () => {
    const h = await putuskanGudangRusak({ itemId, keputusan: "MUSNAHKAN", qty: 1, catatan: "sobek", olehUserId: userId });
    expect(h.ok).toBe(true);
    expect(await antrean()).toHaveLength(0);
  });

  it("PERBAIKI: stok jual 10 → 12, satu baris stock_push PENDING", async () => {
    const h = await putuskanGudangRusak({ itemId, keputusan: "PERBAIKI", qty: 2, catatan: "dijahit ulang", olehUserId: userId });
    expect(h.ok).toBe(true);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId }, select: { qtyOnHand: true } });
    expect(Number(inv?.qtyOnHand)).toBe(12);
    expect(await antrean()).toHaveLength(1);
    // Baris tanpa varian (null) yang sudah ada dipakai, tidak dibuka kembarannya; buku stok mencatatnya.
    expect(await prisma.inventoryValue.count({ where: { itemId: seededId(itemId) } })).toBe(1);
    const buku = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId) } });
    expect(buku).toHaveLength(1);
    expect(buku[0]).toMatchObject({ locationType: "MAIN", variantSku: "", type: "IN", refType: "StockAdjustment", refId: h.ok ? h.penyesuaianId : null });
    expect(Number(buku[0].balanceQty)).toBe(12);
  });

  it("PERBAIKI yang ditolak (saldo rusak habis) tidak mengantrekan push", async () => {
    const h = await putuskanGudangRusak({ itemId, keputusan: "PERBAIKI", qty: 1, catatan: "x", olehUserId: userId });
    expect(h).toEqual({ ok: false, alasan: "SALDO_KURANG" });
    expect(await antrean()).toHaveLength(0);
  });
});
