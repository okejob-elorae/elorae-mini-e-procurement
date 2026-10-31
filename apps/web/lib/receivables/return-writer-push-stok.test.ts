import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Hitungan gudang (NRI) mengembalikan baris LAYAK ke stok jual gudang, jadi
 * available barang itu naik dan harus diteruskan ke Jubelio (baris
 * `stock_push` PENDING) sesudah commit. Baris RUSAK/EXPIRED masuk gudang
 * barang rusak, bukan stok jual — tanpa push. Basis data uji sungguhan;
 * panggilan ke api ditiru.
 */

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 200 })) }));

const { catatHitunganGudang } = await import("./return-writer");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `PSN-${Math.random().toString(36).slice(2, 9)}`;
const acak = () => 1_500_000_000 + Math.floor(Math.random() * 400_000_000);

d("push stok Jubelio dari hitungan gudang NRI (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let gudangId = "";
  const nriIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    gudangId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos Retur", nameEn: "Return Tee", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: acak(), jubelioItemId: acak(), jubelioItemCode: tag, erpVariantSku: "" },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 4, reservedQty: 1, avgCost: 1000, totalValue: 4000 },
    });
    gudangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: tag } })).id;
  });

  beforeEach(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
  });

  afterAll(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
    const gerak = await prisma.damagedStockMovement.findMany({ where: { itemId: seededId(itemId) }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: seededIds([...nriIds, ...gerak.map((g) => g.id)]) } },
    });
    await prisma.damagedStockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(gudangId) } });
  });

  const antrean = () =>
    prisma.jubelioOutbox.findMany({
      where: { entityType: "stock_push", entityId: seededId(itemId), status: "PENDING" },
      select: { payload: true },
    });

  const hitung = (condition: "LAYAK" | "RUSAK", qty: number) =>
    catatHitunganGudang({
      warehouseUserId: gudangId,
      receivedAt: new Date(),
      deliveryMethod: "EKSPEDISI",
      items: [{ itemId, itemName: "Kaos Retur", qty, price: 50_000, condition }],
    });

  it("baris RUSAK saja: stok jual tetap 4, tidak ada push", async () => {
    const h = await hitung("RUSAK", 2);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    nriIds.push(h.id);
    expect(h.barisStok).toBe(0);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId }, select: { qtyOnHand: true } });
    expect(Number(inv?.qtyOnHand)).toBe(4);
    expect(await antrean()).toHaveLength(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: seededId(itemId) } })).toBe(0);
  });

  it("baris LAYAK 3 pcs: stok jual 4 → 7, satu baris stock_push PENDING ber-ref nomor NRI", async () => {
    const h = await hitung("LAYAK", 3);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    nriIds.push(h.id);
    expect(h.barisStok).toBe(1);

    const inv = await prisma.inventoryValue.findFirst({ where: { itemId }, select: { qtyOnHand: true } });
    expect(Number(inv?.qtyOnHand)).toBe(7);
    const baris = await antrean();
    expect(baris).toHaveLength(1);
    expect(JSON.stringify(baris[0].payload)).toContain(h.noNri);

    // Buku stok mencatat penerimaan itu, menunjuk penyesuaian stoknya.
    const adj = await prisma.stockAdjustment.findFirstOrThrow({
      where: { itemId: seededId(itemId), source: "STORE_RETURN_RECEIVE" },
      select: { id: true, docNumber: true },
    });
    const buku = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId) } });
    expect(buku).toHaveLength(1);
    expect(buku[0]).toMatchObject({
      locationType: "MAIN",
      variantSku: "",
      type: "IN",
      refType: "StockAdjustment",
      refId: adj.id,
      refDocNumber: adj.docNumber,
      createdById: gudangId,
    });
    expect([Number(buku[0].qty), Number(buku[0].balanceQty), Number(buku[0].totalCost), Number(buku[0].balanceValue)]).toEqual([
      3, 7, 3000, 7000,
    ]);
  });
});
