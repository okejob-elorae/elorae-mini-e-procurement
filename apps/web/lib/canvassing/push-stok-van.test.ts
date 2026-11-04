import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Muat van dan rekonsiliasi van menggerakkan stok GUDANG UTAMA, jadi keduanya
 * wajib meneruskan available baru ke Jubelio (baris `stock_push` PENDING) —
 * sesudah transaksi commit, dan hanya bila stoknya benar-benar bergerak.
 * Basis data uji sungguhan; panggilan ke api ditiru.
 */

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 200 })) }));

const { loadVan } = await import("./writer");
const { recordVanReconcile } = await import("./reconcile-writer");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `PSV-${Math.random().toString(36).slice(2, 9)}`;
const acak = () => 1_500_000_000 + Math.floor(Math.random() * 400_000_000);

d("push stok Jubelio dari muat & rekonsiliasi van (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let kanvasId = "";
  let adminId = "";
  const loadIds: string[] = [];
  const reconIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    kanvasId = "";
    adminId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos Van", nameEn: "Van Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 },
      })
    ).id;
    await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: acak(), jubelioItemId: acak(), jubelioItemCode: tag, erpVariantSku: "" },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 100, reservedQty: 10, avgCost: 1000, totalValue: 100000 },
    });
    kanvasId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-k@uji.local`, name: `${tag} k` } })).id;
    adminId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.local`, name: `${tag} a` } })).id;
  });

  beforeEach(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
  });

  afterAll(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
    await prisma.vanReconcileLine.deleteMany({ where: { vanReconcileId: { in: seededIds(reconIds) } } });
    await prisma.vanReconcile.deleteMany({ where: { id: { in: seededIds(reconIds) } } });
    await prisma.vanLoadLine.deleteMany({ where: { vanLoadId: { in: seededIds(loadIds) } } });
    await prisma.vanLoad.deleteMany({ where: { id: { in: seededIds(loadIds) } } });
    await prisma.vanStock.deleteMany({ where: { userId: seededId(kanvasId), itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([kanvasId, adminId].filter(Boolean)) } } });
  });

  const antrean = () =>
    prisma.jubelioOutbox.findMany({
      where: { entityType: "stock_push", entityId: seededId(itemId), status: "PENDING" },
      select: { payload: true },
    });

  it("muat van yang ditolak (stok kurang) tidak mengantrekan apa pun", async () => {
    // available = 100 − 10 = 90; minta 91.
    const r = await loadVan({ canvasserId: kanvasId, loadedById: adminId, lines: [{ itemId, variantSku: null, qty: 91 }] });
    expect(r.ok).toBe(false);
    expect(await antrean()).toHaveLength(0);
  });

  it("muat van: gudang utama 100 → 80, satu baris stock_push PENDING ber-ref dokumen muat", async () => {
    const r = await loadVan({ canvasserId: kanvasId, loadedById: adminId, lines: [{ itemId, variantSku: null, qty: 20 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    loadIds.push(r.loadId);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId }, select: { qtyOnHand: true } });
    expect(Number(inv?.qtyOnHand)).toBe(80);
    const baris = await antrean();
    expect(baris).toHaveLength(1);
    expect(JSON.stringify(baris[0].payload)).toContain(r.docNo);
  });

  it("rekonsiliasi van: 15 dari 20 kembali (gudang 80 → 95), satu baris stock_push PENDING", async () => {
    const r = await recordVanReconcile({
      canvasserId: kanvasId,
      reconciledById: adminId,
      counts: [{ itemId, variantSku: "", countedQty: 15 }],
      note: "5 terjual tunai",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    reconIds.push(r.reconcileId);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId }, select: { qtyOnHand: true } });
    expect(Number(inv?.qtyOnHand)).toBe(95);
    const baris = await antrean();
    expect(baris).toHaveLength(1);
    expect(JSON.stringify(baris[0].payload)).toContain(r.docNo);
  });
});
