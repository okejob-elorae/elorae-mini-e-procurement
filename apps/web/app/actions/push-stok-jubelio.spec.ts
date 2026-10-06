import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Perubahan stok di ERP diteruskan ke Jubelio (basis data uji nyata; sesi,
 * notifikasi, jurnal, dan panggilan api ditiru).
 *
 * Dulu GRN, penolakan GRN oleh pemilik, penerimaan barang jadi, penyesuaian
 * manual, dan retur marketplace yang diterima mengubah stok ERP tanpa mengirim
 * apa pun ke Jubelio. Webhook stok Jubelio berikutnya lalu menimpa angka ERP
 * dengan angka Jubelio yang tidak tahu perubahan itu; satu-satunya penolong
 * adalah tombol push stok manual admin.
 *
 * Yang dibuktikan: setiap aksi itu, SESUDAH dokumennya tercatat, menulis satu
 * baris `stock_push` PENDING untuk barang yang punya pemetaan Jubelio — dan
 * tidak untuk barang tanpa pemetaan.
 */

const sesi = vi.hoisted(() => ({ id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.permissions } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async () => ({ success: true, userId: sesi.id })),
}));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifyStockAdjustmentCreated: async () => {},
  notifyGRNCreated: async () => {},
  notifyMaterialArrivedForPo: async () => {},
  notifyWOCompleted: async () => {},
}));
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
/* Jurnal tidak diuji di sini dan tidak boleh menyentuh pemetaan akun bersama. */
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(async () => ({ ok: true })),
  postGrnReversalJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/production/fg-receipt-journal", () => ({
  postFgReceiptJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/finance/sales/sales-return-journal", () => ({
  postSalesReturnRevenueJournal: vi.fn(async () => ({ ok: true })),
  postSalesReturnCogsJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/leadtime/auto-confirm", () => ({ applyChainSignal: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/redis/lock", () => ({
  SalesReturnLockBusyError: class extends Error {},
  withSalesReturnLock: async (_id: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 200 })) }));

const { createStockAdjustment } = await import("./inventory");
const { createGRN, declineGRNByOwner } = await import("./grn");
const { receiveFG } = await import("./production");
const { acceptReturnItemAction } = await import("./sales-return-decision");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `PSJ-${Math.random().toString(36).slice(2, 9)}`;
const acak = () => 1_500_000_000 + Math.floor(Math.random() * 400_000_000);

d("push stok ke Jubelio sesudah dokumen stok (test bed only)", () => {
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let terpetakan = "";
  let lepas = "";
  let buatanErp = "";
  let woId = "";
  let returnId = "";
  const grnIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    terpetakan = "";
    lepas = "";
    buatanErp = "";
    woId = "";
    returnId = "";
    userId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: "Gudang uji" } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `T-${tag}`, name: `Jenis ${tag}` } })).id;
    supplierId = (
      await prisma.supplier.create({ data: { code: `S-${tag}`, name: "Pemasok uji", typeId, status: "ACTIVE" } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    terpetakan = (
      await prisma.item.create({
        data: { sku: `${tag}-A`, nameId: "Kaos terpetakan", nameEn: "Mapped tee", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    lepas = (
      await prisma.item.create({
        data: { sku: `${tag}-B`, nameId: "Kaos lepas", nameEn: "Unmapped tee", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    // Barang buatan ERP: baris stok tanpa varian bernilai null (lib/items/mutations.ts).
    buatanErp = (
      await prisma.item.create({
        data: { sku: `${tag}-C`, nameId: "Kaos buatan ERP", nameEn: "ERP tee", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    await prisma.inventoryValue.create({
      data: { itemId: buatanErp, variantSku: null, qtyOnHand: 20, avgCost: 40_000, totalValue: 800_000 },
    });
    await prisma.jubelioProductMapping.create({
      data: {
        itemId: buatanErp,
        jubelioItemGroupId: acak(),
        jubelioItemId: acak(),
        jubelioItemCode: `${tag}-C`,
        erpVariantSku: "",
      },
    });
    for (const itemId of [terpetakan, lepas]) {
      await prisma.inventoryValue.create({
        data: { itemId, variantSku: "", qtyOnHand: 20, avgCost: 40_000, totalValue: 800_000 },
      });
    }
    await prisma.jubelioProductMapping.create({
      data: {
        itemId: terpetakan,
        jubelioItemGroupId: acak(),
        jubelioItemId: acak(),
        jubelioItemCode: `${tag}-A`,
        erpVariantSku: "",
      },
    });
  });

  beforeEach(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityId: { in: seededIds([terpetakan, lepas, buatanErp]) } } });
  });

  afterAll(async () => {
    const items = seededIds([terpetakan, lepas, buatanErp].filter(Boolean));
    await prisma.jubelioOutbox.deleteMany({ where: { entityId: { in: seededIds(items) } } });
    await prisma.salesReturnItem.deleteMany({ where: { salesReturnId: seededId(returnId) } });
    await prisma.salesReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.fGReceipt.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.workOrderStep.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(woId) } });
    const semuaGrn = (
      await prisma.gRN.findMany({ where: { supplierId: seededId(supplierId) }, select: { id: true } })
    ).map((g) => g.id);
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds([...semuaGrn, ...grnIds]) } } });
    await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(items) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  function sebagai(permissions: string[]) {
    sesi.id = userId;
    sesi.permissions = permissions;
  }

  async function antrean() {
    return prisma.jubelioOutbox.findMany({
      where: { entityType: "stock_push", entityId: { in: seededIds([terpetakan, lepas, buatanErp]) } },
      select: { entityId: true, status: true, payload: true },
    });
  }

  it("penyesuaian manual: barang terpetakan diantrekan ke Jubelio", async () => {
    sebagai(["inventory:manage"]);
    const adj = await createStockAdjustment(
      { itemId: terpetakan, type: "NEGATIVE", qty: 2, reason: "Barang rusak di rak" },
      "123456",
      userId,
    );

    expect(await antrean()).toEqual([
      { entityId: terpetakan, status: "PENDING", payload: { sumber: "ADJUSTMENT", ref: adj.docNumber } },
    ]);
  });

  it("penyesuaian manual barang buatan ERP (baris null): stok 20 + 3 = 23 di baris yang sama, lalu diantrekan", async () => {
    sebagai(["inventory:manage"]);
    const adj = await createStockAdjustment(
      { itemId: buatanErp, type: "POSITIVE", qty: 3, reason: "Ketemu di gudang" },
      "123456",
      userId,
    );

    const baris = await prisma.inventoryValue.findMany({
      where: { itemId: seededId(buatanErp) },
      select: { variantSku: true, qtyOnHand: true, totalValue: true },
    });
    // Tidak ada baris "" kembar; baris null yang bertambah, nilai 23 × 40.000.
    expect(baris.map((b) => ({ v: b.variantSku, q: Number(b.qtyOnHand), n: Number(b.totalValue) }))).toEqual([
      { v: null, q: 23, n: 920_000 },
    ]);
    expect(Number(adj.prevQty)).toBe(20);
    expect(Number(adj.newQty)).toBe(23);
    expect(await antrean()).toEqual([
      { entityId: buatanErp, status: "PENDING", payload: { sumber: "ADJUSTMENT", ref: adj.docNumber } },
    ]);
  });

  it("penyesuaian manual: barang tanpa pemetaan tidak diantrekan", async () => {
    sebagai(["inventory:manage"]);
    await createStockAdjustment(
      { itemId: lepas, type: "POSITIVE", qty: 1, reason: "Ketemu di gudang" },
      "123456",
      userId,
    );
    expect(await antrean()).toEqual([]);
  });

  it("GRN: hanya barang terpetakan di GRN itu yang diantrekan", async () => {
    sebagai(["inventory:manage"]);
    const grn = await createGRN({
      supplierId,
      items: [
        { itemId: terpetakan, qty: 5, unitCost: 40_000 },
        { itemId: lepas, qty: 3, unitCost: 40_000 },
      ],
    });
    grnIds.push(grn.id);

    expect(await antrean()).toEqual([
      { entityId: terpetakan, status: "PENDING", payload: { sumber: "GRN", ref: grn.docNumber } },
    ]);
  });

  it("GRN ditolak pemilik: stok dibalik lalu diantrekan", async () => {
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-${tag}-TOLAK`,
        supplierId,
        receivedBy: userId,
        totalAmount: 2 * 40_000,
        requiresOwnerApproval: true,
        items: JSON.stringify([{ itemId: terpetakan, variantSku: null, qty: 2, unitCost: 40_000 }]),
      },
      select: { id: true },
    });
    grnIds.push(grn.id);

    sebagai(["*"]);
    await declineGRNByOwner(grn.id);

    expect(await antrean()).toEqual([
      { entityId: terpetakan, status: "PENDING", payload: { sumber: "GRN_DECLINE", ref: `GRN-${tag}-TOLAK` } },
    ]);
  });

  it("penerimaan barang jadi: barang jadi WO diantrekan", async () => {
    woId = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-${tag}`,
          vendorId: supplierId,
          finishedGoodId: terpetakan,
          plannedQty: 10,
          consumptionPlan: {},
          status: "IN_PRODUCTION",
          createdById: userId,
        },
      })
    ).id;

    sebagai(["work_orders:manage"]);
    const r = await receiveFG({ woId, qtyReceived: 4, qtyRejected: 0 }, userId);

    expect(await antrean()).toEqual([
      { entityId: terpetakan, status: "PENDING", payload: { sumber: "FG_RECEIPT", ref: r.docNumber } },
    ]);
  });

  it("retur marketplace diterima: barang yang kembali ke rak diantrekan", async () => {
    const ret = await prisma.salesReturn.create({
      data: {
        jubelioReturnId: acak(),
        channel: "SHOPEE",
        totalQty: 1,
        receivedAt: new Date(),
        rawIngestPayload: {},
        items: {
          create: {
            itemId: terpetakan,
            variantSku: null,
            externalSku: `${tag}-A`,
            productName: "Kaos terpetakan",
            qty: 1,
            unitPrice: 100_000,
            subtotal: 100_000,
          },
        },
      },
      include: { items: { select: { id: true } } },
    });
    returnId = ret.id;

    sebagai(["sales_returns:decide"]);
    const hasil = await acceptReturnItemAction(ret.items[0].id, "Barang kembali utuh");

    expect(hasil).toEqual({ ok: true });
    expect(await antrean()).toEqual([
      { entityId: terpetakan, status: "PENDING", payload: { sumber: "SALES_RETURN_ACCEPT", ref: ret.items[0].id } },
    ]);
  });

  it("dokumen kedua selagi antrean pertama menunggu tidak menggandakan baris", async () => {
    sebagai(["inventory:manage"]);
    await createStockAdjustment({ itemId: terpetakan, type: "POSITIVE", qty: 1, reason: "Hitung ulang rak" }, "1", userId);
    await createStockAdjustment({ itemId: terpetakan, type: "POSITIVE", qty: 1, reason: "Hitung ulang rak" }, "1", userId);
    expect(await antrean()).toHaveLength(1);
  });
});
