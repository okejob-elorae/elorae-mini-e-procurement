import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Rilis jendela pre-order mencadangkan stok pesanan yang sudah disetujui —
 * `available` (onHand − reserved) barang itu turun. Tanpa push stok ke Jubelio
 * sesudah commit, marketplace terus menjual stok yang sudah dijanjikan ke toko
 * sampai ada dokumen lain yang kebetulan mendorong barang yang sama.
 *
 * Yang dibuktikan (basis data uji sungguhan, penolong push disadap):
 *  - rilis mengantrekan push untuk barang yang DICADANGKAN, sekali per rilis,
 *    dengan sumber "INDEN" — dipanggil sesudah commit (cadangannya sudah
 *    terbaca dari luar transaksi saat penolong dipanggil);
 *  - barang pesanan yang masih menunggu persetujuan tidak ikut;
 *  - rilis kedua, rilis yang ditolak, dan rilis tanpa cadangan tidak mendorong apa pun;
 *  - dua rilis serentak (klik ganda): satu push, bukan dua.
 */

type Panggilan = { itemIds: string[]; sumber: string; ref: string | null; userId: string | null; reservedA: number | null };
const sadap = vi.hoisted(() => ({ panggilan: [] as Panggilan[], itemA: "" }));

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({
  antrekanPushStok: vi.fn(
    async (itemIds: readonly (string | null | undefined)[], opsi: { sumber: string; ref?: string | null; userId?: string | null }) => {
      const { prisma: db } = await import("@elorae/db");
      // Dibaca dengan klien biasa (di luar transaksi): angka ini hanya terlihat sesudah commit.
      const inv = sadap.itemA ? await db.inventoryValue.findFirst({ where: { itemId: sadap.itemA, variantSku: "" } }) : null;
      sadap.panggilan.push({
        itemIds: itemIds.filter((i): i is string => typeof i === "string"),
        sumber: opsi.sumber,
        ref: opsi.ref ?? null,
        userId: opsi.userId ?? null,
        reservedA: inv ? Number(inv.reservedQty) : null,
      });
      return { diantrekan: [], sudahAntre: [], tanpaPemetaan: [], barisGabungan: [], gagal: false };
    },
  ),
}));

const { createFieldSalesOrder, approveFieldSalesOrder } = await import("./writer");
const { closeFieldSalesOrderRemainder } = await import("./delivery/writer");
const { rilisJendelaInden } = await import("./inden-writer");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const HARI = 24 * 60 * 60 * 1000;

d("rilis inden mengantrekan push stok Jubelio (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemA = "";
  let itemB = "";
  let itemC = "";
  let itemTanpaStok = "";
  let storeId = "";
  let userId = "";
  let visitId = "";
  let windowId = "";
  let extraWindowIds: string[] = [];
  let orderNos: string[] = [];

  async function jendelaBaru(items: string[]) {
    const now = Date.now();
    const w = await prisma.preorderWindow.create({
      data: {
        name: `TEST-INDEN-PUSH-${token}`,
        opensAt: new Date(now - HARI),
        closesAt: new Date(now + 7 * HARI),
        shipFrom: new Date(now + 30 * HARI),
        shipTo: new Date(now + 40 * HARI),
        isActive: true,
        createdById: userId,
      },
    });
    await prisma.preorderWindowItem.createMany({ data: items.map((itemId) => ({ windowId: w.id, itemId, plannedQty: 100 })) });
    return w.id;
  }

  async function pesan(itemId: string, qty: number, wId = windowId) {
    const r = await createFieldSalesOrder({
      storeId,
      salesmanId: userId,
      visitId,
      lines: [{ itemId, variantSku: "", productName: "Barang inden", qty, unitPrice: 1 }],
      preorderWindowId: wId,
    });
    orderNos.push(r.orderNo);
    return r;
  }

  const dorongInden = () => sadap.panggilan.filter((p) => p.sumber === "INDEN");

  beforeEach(async () => {
    uomId = ""; itemA = ""; itemB = ""; itemC = ""; itemTanpaStok = ""; storeId = ""; userId = "";
    visitId = ""; windowId = ""; extraWindowIds = []; orderNos = [];
    sadap.panggilan = [];
    sadap.itemA = "";

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-INP-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = async (kode: string) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-INP-${kode}-${token}`, nameId: kode, nameEn: kode, type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50000 },
        })
      ).id;
    itemA = await barang("A");
    itemB = await barang("B");
    itemC = await barang("C");
    itemTanpaStok = await barang("X");
    sadap.itemA = itemA;
    for (const itemId of [itemA, itemB, itemC]) {
      await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 30, reservedQty: 0, avgCost: 20000, totalValue: 600000 } });
    }
    storeId = (
      await prisma.store.create({
        data: { code: `TEST-INP-S-${token}`, name: "Toko Inden Push", address: "x", termsType: "PUTUS", paymentTempo: 30, isActive: true },
      })
    ).id;
    userId = (await prisma.user.create({ data: { email: `test-inp-${token}@example.com`, name: "Sales Inden Push" } })).id;
    visitId = (await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: 0, checkinLng: 0 } })).id;
    windowId = await jendelaBaru([itemA, itemB, itemC]);
  });

  afterEach(async () => {
    const items = [itemA, itemB, itemC, itemTanpaStok].filter(Boolean);
    const windows = [windowId, ...extraWindowIds].filter(Boolean);
    for (const no of orderNos) {
      await prisma.adminNotification.deleteMany({ where: { metadata: { path: ["orderNo"], equals: seededId(no) } } });
    }
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { order: { storeId: seededId(storeId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.auditLog.deleteMany({ where: { entityType: "PreorderWindow", entityId: { in: seededIds(windows) } } });
    await prisma.preorderWindowItem.deleteMany({ where: { windowId: { in: seededIds(windows) } } });
    await prisma.preorderWindow.deleteMany({ where: { id: { in: seededIds(windows) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(items) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("rilis mendorong barang yang dicadangkan sekali, bersumber INDEN, sesudah commit; pesanan menunggu tidak ikut", async () => {
    const a = await pesan(itemA, 6);
    await approveFieldSalesOrder({ orderId: a.orderId, approvedById: userId });
    const b = await pesan(itemB, 8);
    await approveFieldSalesOrder({ orderId: b.orderId, approvedById: userId });
    await pesan(itemC, 6); // masih menunggu persetujuan
    sadap.panggilan = [];

    const r = await rilisJendelaInden({ id: windowId, userId });

    expect(r).toMatchObject({ ok: true, sudahDirilis: false, pesanan: 2, baris: 2 });
    const dorong = dorongInden();
    expect(dorong).toHaveLength(1);
    expect([...dorong[0].itemIds].sort()).toEqual([itemA, itemB].sort());
    expect(dorong[0].userId).toBe(userId);
    expect(dorong[0].ref).toContain(windowId);
    // Penolong dipanggil sesudah commit: cadangan 6 pcs sudah terlihat dari luar transaksi.
    expect(dorong[0].reservedA).toBe(6);
  });

  it("rilis kedua tidak mendorong lagi", async () => {
    const a = await pesan(itemA, 6);
    await approveFieldSalesOrder({ orderId: a.orderId, approvedById: userId });
    await rilisJendelaInden({ id: windowId, userId });
    sadap.panggilan = [];

    const kedua = await rilisJendelaInden({ id: windowId, userId });

    expect(kedua).toMatchObject({ ok: true, sudahDirilis: true });
    expect(dorongInden()).toHaveLength(0);
  });

  it("rilis tanpa cadangan (sisa pesanan sudah ditutup) tidak mendorong", async () => {
    const a = await pesan(itemA, 6);
    await approveFieldSalesOrder({ orderId: a.orderId, approvedById: userId });
    await closeFieldSalesOrderRemainder({ orderId: a.orderId, closedById: userId, reason: "batal produksi" });
    sadap.panggilan = [];

    const r = await rilisJendelaInden({ id: windowId, userId });

    expect(r).toMatchObject({ ok: true, sudahDirilis: false, baris: 0 });
    expect(dorongInden()).toHaveLength(0);
  });

  it("rilis yang DITOLAK (barang belum tercatat) tidak mendorong", async () => {
    const wId = await jendelaBaru([itemTanpaStok]);
    extraWindowIds.push(wId);
    const x = await pesan(itemTanpaStok, 6, wId);
    await approveFieldSalesOrder({ orderId: x.orderId, approvedById: userId });
    sadap.panggilan = [];

    const r = await rilisJendelaInden({ id: wId, userId });

    expect(r).toMatchObject({ ok: false, kode: "BARANG_BELUM_TERCATAT" });
    expect(dorongInden()).toHaveLength(0);
  });

  it("dua rilis serentak: satu yang mencadangkan, satu push", async () => {
    const a = await pesan(itemA, 6);
    await approveFieldSalesOrder({ orderId: a.orderId, approvedById: userId });
    sadap.panggilan = [];

    const hasil = await Promise.all([rilisJendelaInden({ id: windowId, userId }), rilisJendelaInden({ id: windowId, userId })]);

    expect(hasil.filter((h) => h.ok && !h.sudahDirilis)).toHaveLength(1);
    expect(hasil.filter((h) => h.ok && h.sudahDirilis)).toHaveLength(1);
    const dorong = dorongInden();
    expect(dorong).toHaveLength(1);
    expect(dorong[0].itemIds).toEqual([itemA]);
    expect(dorong[0].reservedA).toBe(6);
  });
});
