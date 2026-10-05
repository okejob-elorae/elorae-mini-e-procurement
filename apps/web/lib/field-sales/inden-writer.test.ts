import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { createFieldSalesOrder, approveFieldSalesOrder, rejectFieldSalesOrder } from "./writer";
import { recordFieldSalesDelivery, closeFieldSalesOrderRemainder } from "./delivery/writer";
import { rilisJendelaInden, simpanJendelaInden } from "./inden-writer";
import { IndenBelumRilisError, IndenDitolakError } from "./inden";
import { InsufficientStockError, MinQtyViolationError } from "./errors";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Mengubah stok — tidak pernah dijalankan terhadap basis data produksi. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const HARI = 24 * 60 * 60 * 1000;
const invoiceDate = new Date("2026-01-01T00:00:00.000+07:00");
const dueDate = new Date("2026-01-31T00:00:00.000+07:00");

d("pre-order (inden): pesanan, rilis, kirim (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemA = "";
  let itemB = "";
  let itemTanpaStok = "";
  let storeId = "";
  let konsiStoreId = "";
  let userId = "";
  let visitId = "";
  let konsiVisitId = "";
  let windowId = "";
  let extraWindowIds: string[] = [];
  let orderIds: string[] = [];
  let orderNos: string[] = [];

  async function jendelaBaru(o: { opensAt?: Date; closesAt?: Date; isActive?: boolean; releasedAt?: Date | null; items?: string[] } = {}) {
    const now = Date.now();
    const w = await prisma.preorderWindow.create({
      data: {
        name: `TEST-INDEN-${token}`,
        opensAt: o.opensAt ?? new Date(now - HARI),
        closesAt: o.closesAt ?? new Date(now + 7 * HARI),
        shipFrom: new Date(now + 30 * HARI),
        shipTo: new Date(now + 40 * HARI),
        isActive: o.isActive ?? true,
        releasedAt: o.releasedAt ?? null,
        createdById: userId,
      },
    });
    await prisma.preorderWindowItem.createMany({ data: (o.items ?? [itemA]).map((itemId) => ({ windowId: w.id, itemId, plannedQty: 100 })) });
    return w.id;
  }

  async function pesanInden(qty = 6, opsi: { itemId?: string; variantSku?: string; wId?: string } = {}) {
    const r = await createFieldSalesOrder({
      storeId,
      salesmanId: userId,
      visitId,
      lines: [{ itemId: opsi.itemId ?? itemA, variantSku: opsi.variantSku ?? "", productName: "Barang A", qty, unitPrice: 1 }],
      preorderWindowId: opsi.wId ?? windowId,
    });
    orderIds.push(r.orderId);
    orderNos.push(r.orderNo);
    return r;
  }

  async function stokA() {
    const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemA), variantSku: "" } });
    return { onHand: Number(inv.qtyOnHand), reserved: Number(inv.reservedQty) };
  }

  beforeEach(async () => {
    uomId = ""; itemA = ""; itemB = ""; itemTanpaStok = ""; storeId = ""; konsiStoreId = ""; userId = "";
    visitId = ""; konsiVisitId = ""; windowId = ""; extraWindowIds = []; orderIds = []; orderNos = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-IND-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemA = (await prisma.item.create({ data: { sku: `TEST-IND-A-${token}`, nameId: "A", nameEn: "A", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50000 } })).id;
    itemB = (await prisma.item.create({ data: { sku: `TEST-IND-B-${token}`, nameId: "B", nameEn: "B", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 } })).id;
    itemTanpaStok = (await prisma.item.create({ data: { sku: `TEST-IND-C-${token}`, nameId: "C", nameEn: "C", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 30000 } })).id;
    // Barang pre-order belum ada: baris persediaan ada tapi kosong (seperti barang baru yang sudah dicatat).
    await prisma.inventoryValue.create({ data: { itemId: itemA, variantSku: "", qtyOnHand: 0, reservedQty: 0, avgCost: 20000, totalValue: 0 } });
    await prisma.inventoryValue.create({ data: { itemId: itemB, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 20000, totalValue: 1000000 } });
    storeId = (await prisma.store.create({ data: { code: `TEST-IND-S-${token}`, name: "Toko Inden", address: "x", termsType: "PUTUS", paymentTempo: 30, isActive: true } })).id;
    konsiStoreId = (await prisma.store.create({ data: { code: `TEST-IND-K-${token}`, name: "Toko Konsi", address: "x", termsType: "KONSI", marginPercent: 20, isActive: true } })).id;
    userId = (await prisma.user.create({ data: { email: `test-ind-${token}@example.com`, name: "Sales Inden" } })).id;
    visitId = (await prisma.storeVisit.create({ data: { storeId, userId, checkinLat: 0, checkinLng: 0 } })).id;
    konsiVisitId = (await prisma.storeVisit.create({ data: { storeId: konsiStoreId, userId, checkinLat: 0, checkinLng: 0 } })).id;
    windowId = await jendelaBaru();
  });

  afterEach(async () => {
    // Daftar id seeded; setiap filter tetap memanggil seededIds() di tempat supaya penjaga teardown terlihat.
    const items = [itemA, itemB, itemTanpaStok].filter(Boolean);
    const windows = [windowId, ...extraWindowIds].filter(Boolean);
    const stores = [storeId, konsiStoreId].filter(Boolean);
    for (const no of orderNos) {
      await prisma.adminNotification.deleteMany({ where: { metadata: { path: ["orderNo"], equals: seededId(no) } } });
    }
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { order: { storeId: { in: seededIds(stores) } } } } });
    // Nota = piutang: hapus piutangnya SEBELUM notanya (emulasi relasi 1:1 Prisma gagal pada deleteMany banyak nota).
    await prisma.receivable.deleteMany({ where: { storeId: { in: seededIds(stores) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { order: { storeId: { in: seededIds(stores) } } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { order: { storeId: { in: seededIds(stores) } } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: { in: seededIds(stores) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "PreorderWindow", entityId: { in: seededIds(windows) } } });
    await prisma.preorderWindowItem.deleteMany({ where: { windowId: { in: seededIds(windows) } } });
    await prisma.preorderWindow.deleteMany({ where: { id: { in: seededIds(windows) } } });
    // Jendela yang dibuat lewat simpanJendelaInden dalam tes (id belum diketahui saat gagal) — namanya unik per token.
    const sisa = await prisma.preorderWindow.findMany({ where: { name: `TEST-INDEN-SIMPAN-${token}` }, select: { id: true } });
    if (sisa.length > 0) {
      const ids = sisa.map((s) => s.id);
      await prisma.auditLog.deleteMany({ where: { entityType: "PreorderWindow", entityId: { in: seededIds(ids) } } });
      await prisma.preorderWindowItem.deleteMany({ where: { windowId: { in: seededIds(ids) } } });
      await prisma.preorderWindow.deleteMany({ where: { id: { in: seededIds(ids) } } });
    }
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(items) } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds([visitId, konsiVisitId].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(stores) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(items) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  // ── Pembuatan ───────────────────────────────────────────────────────────

  it("pesanan pre-order tercatat dengan jendelanya, harga server, dan TANPA reservasi stok", async () => {
    const { orderId, oversell } = await pesanInden(6);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    expect(order.preorderWindowId).toBe(windowId);
    expect(order.status).toBe("PENDING_APPROVAL");
    expect(Number(order.lines[0].unitPrice)).toBe(50000);
    expect(Number(order.total)).toBe(300000);
    expect(oversell).toEqual([]);
    expect(await prisma.stockReservation.count({ where: { fieldSalesLineId: order.lines[0].id } })).toBe(0);
    expect((await stokA()).reserved).toBe(0);
  });

  it("minimum pesanan tetap berlaku untuk pre-order", async () => {
    await expect(pesanInden(3)).rejects.toBeInstanceOf(MinQtyViolationError);
  });

  it("menolak barang di luar jendela, tanpa mencatat apa pun", async () => {
    const err = await pesanInden(6, { itemId: itemB }).catch((e) => e);
    expect(err).toBeInstanceOf(IndenDitolakError);
    expect(err.alasan).toBe("BARANG_LUAR");
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(0);
  });

  it("menolak jendela yang tidak BUKA, dinilai di server", async () => {
    const now = Date.now();
    const tutup = await jendelaBaru({ opensAt: new Date(now - 10 * HARI), closesAt: new Date(now - HARI) });
    const belum = await jendelaBaru({ opensAt: new Date(now + HARI), closesAt: new Date(now + 5 * HARI) });
    const mati = await jendelaBaru({ isActive: false });
    const rilis = await jendelaBaru({ releasedAt: new Date(now - 1000) });
    extraWindowIds.push(tutup, belum, mati, rilis);
    for (const [wId, alasan] of [[tutup, "TUTUP"], [belum, "BELUM_BUKA"], [mati, "NONAKTIF"], [rilis, "DIRILIS"], ["tidak-ada-jendela", "TIDAK_ADA"]] as const) {
      const err = await pesanInden(6, { wId }).catch((e) => e);
      expect(err, alasan).toBeInstanceOf(IndenDitolakError);
      expect(err.alasan).toBe(alasan);
    }
  });

  it("menolak toko konsinyasi", async () => {
    const err = await createFieldSalesOrder({
      storeId: konsiStoreId,
      salesmanId: userId,
      visitId: konsiVisitId,
      lines: [{ itemId: itemA, variantSku: "", productName: "A", qty: 6, unitPrice: 0 }],
      preorderWindowId: windowId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IndenDitolakError);
    expect(err.alasan).toBe("KONSI");
  });

  // ── Persetujuan & kirim sebelum rilis ───────────────────────────────────

  it("disetujui sebelum rilis tetap tanpa reservasi, dan pengirimannya DITOLAK INDEN_BELUM_RILIS", async () => {
    const { orderId } = await pesanInden(6);
    await approveFieldSalesOrder({ orderId, approvedById: userId });
    expect((await stokA()).reserved).toBe(0);
    // Stok fisik sudah ada pun, sebelum rilis pengiriman tetap ditolak dengan alasan yang benar.
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemA) }, data: { qtyOnHand: 20 } });
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId } });
    const err = await recordFieldSalesDelivery({
      orderId,
      deliveredById: userId,
      lines: [{ orderLineId: line.id, qty: 6 }],
      invoiceDate,
      dueDate,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IndenBelumRilisError);
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId } })).toBe(0);
    expect((await stokA()).onHand).toBe(20);
  });

  it("sisa pesanan pre-order boleh ditutup sebelum rilis, dan rilis lalu melewatinya", async () => {
    const { orderId } = await pesanInden(6);
    await approveFieldSalesOrder({ orderId, approvedById: userId });
    await closeFieldSalesOrderRemainder({ orderId, closedById: userId, reason: "batal produksi" });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemA) }, data: { qtyOnHand: 20 } });
    const r = await rilisJendelaInden({ id: windowId, userId });
    expect(r).toMatchObject({ ok: true, sudahDirilis: false, pesanan: 0, baris: 0 });
    expect((await stokA()).reserved).toBe(0);
  });

  // ── Rilis ───────────────────────────────────────────────────────────────

  it("rilis mencadangkan pesanan yang sudah disetujui, bukan yang masih menunggu; jejak ditulis", async () => {
    const disetujui = await pesanInden(6);
    await approveFieldSalesOrder({ orderId: disetujui.orderId, approvedById: userId });
    const menunggu = await pesanInden(8);
    const ditolak = await pesanInden(7);
    await rejectFieldSalesOrder({ orderId: ditolak.orderId, rejectedById: userId, reason: "x" });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemA) }, data: { qtyOnHand: 30 } });

    const r = await rilisJendelaInden({ id: windowId, userId });
    expect(r).toMatchObject({ ok: true, sudahDirilis: false, pesanan: 1, baris: 1, oversell: [] });
    expect((await stokA()).reserved).toBe(6);
    const w = await prisma.preorderWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(w.releasedAt).not.toBeNull();
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "PreorderWindow", entityId: windowId, action: "PREORDER_WINDOW_RELEASED" } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].userId).toBe(userId);
    const lineMenunggu = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId: menunggu.orderId } });
    expect(await prisma.stockReservation.count({ where: { fieldSalesLineId: lineMenunggu.id } })).toBe(0);

    // Disetujui SESUDAH rilis: dicadangkan saat disetujui.
    await approveFieldSalesOrder({ orderId: menunggu.orderId, approvedById: userId });
    expect((await stokA()).reserved).toBe(14);
    expect(await prisma.stockReservation.count({ where: { fieldSalesLineId: lineMenunggu.id, state: "RESERVED" } })).toBe(1);
  });

  it("rilis idempoten: rilis kedua tidak mencadangkan lagi dan tidak menulis jejak kedua", async () => {
    const { orderId } = await pesanInden(6);
    await approveFieldSalesOrder({ orderId, approvedById: userId });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemA) }, data: { qtyOnHand: 30 } });
    const pertama = await rilisJendelaInden({ id: windowId, userId });
    expect(pertama).toMatchObject({ ok: true, sudahDirilis: false, baris: 1 });
    const releasedAt = (await prisma.preorderWindow.findUniqueOrThrow({ where: { id: windowId } })).releasedAt;

    const kedua = await rilisJendelaInden({ id: windowId, userId });
    expect(kedua).toEqual({ ok: true, sudahDirilis: true, pesanan: 0, baris: 0, oversell: [] });
    expect((await stokA()).reserved).toBe(6);
    expect((await prisma.preorderWindow.findUniqueOrThrow({ where: { id: windowId } })).releasedAt).toEqual(releasedAt);
    expect(await prisma.auditLog.count({ where: { entityType: "PreorderWindow", entityId: windowId, action: "PREORDER_WINDOW_RELEASED" } })).toBe(1);
  });

  it("rilis memperingatkan (tidak menolak) stok yang kurang dan mencatat risiko oversell", async () => {
    const { orderId, orderNo } = await pesanInden(10);
    await approveFieldSalesOrder({ orderId, approvedById: userId });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemA) }, data: { qtyOnHand: 4 } });
    const r = await rilisJendelaInden({ id: windowId, userId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.oversell).toEqual([{ itemId: itemA, variantSku: "", available: -6 }]);
    expect((await stokA()).reserved).toBe(10);
    const alarm = await prisma.adminNotification.count({ where: { category: "STOCK_OVERSELL_RISK", metadata: { path: ["orderNo"], equals: orderNo } } });
    expect(alarm).toBe(1);
  });

  it("rilis DITOLAK utuh kalau barang pesanan belum punya baris persediaan — tanda rilis ikut batal", async () => {
    extraWindowIds.push(await jendelaBaru({ items: [itemTanpaStok] }));
    const wId = extraWindowIds[0];
    const { orderId } = await pesanInden(6, { itemId: itemTanpaStok, wId });
    await approveFieldSalesOrder({ orderId, approvedById: userId });
    const r = await rilisJendelaInden({ id: wId, userId });
    expect(r).toEqual({ ok: false, kode: "BARANG_BELUM_TERCATAT", baris: [{ itemId: itemTanpaStok, variantSku: "", productName: "Barang A" }] });
    expect((await prisma.preorderWindow.findUniqueOrThrow({ where: { id: wId } })).releasedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityType: "PreorderWindow", entityId: wId } })).toBe(0);
  });

  it("disetujui sesudah rilis tanpa baris persediaan → kekurangan stok yang menyebut barangnya", async () => {
    extraWindowIds.push(await jendelaBaru({ items: [itemTanpaStok] }));
    const wId = extraWindowIds[0];
    const { orderId } = await pesanInden(6, { itemId: itemTanpaStok, wId });
    expect(await rilisJendelaInden({ id: wId, userId })).toMatchObject({ ok: true, pesanan: 0 });
    const err = await approveFieldSalesOrder({ orderId, approvedById: userId }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientStockError);
    expect(err.shortLines).toEqual([{ itemId: itemTanpaStok, variantSku: "", available: 0 }]);
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING_APPROVAL");
  });

  it("sesudah rilis pesanan pre-order dikirim seperti biasa", async () => {
    const { orderId } = await pesanInden(6);
    await approveFieldSalesOrder({ orderId, approvedById: userId });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemA) }, data: { qtyOnHand: 30 } });
    await rilisJendelaInden({ id: windowId, userId });
    const line = await prisma.fieldSalesOrderLine.findFirstOrThrow({ where: { orderId } });
    await recordFieldSalesDelivery({ orderId, deliveredById: userId, lines: [{ orderLineId: line.id, qty: 6 }], invoiceDate, dueDate });
    expect(await stokA()).toEqual({ onHand: 24, reserved: 0 });
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: orderId } })).deliveryStatus).toBe("DELIVERED");
  });

  it("rilis jendela yang tidak ada", async () => {
    expect(await rilisJendelaInden({ id: "tidak-ada", userId })).toEqual({ ok: false, kode: "TIDAK_ADA" });
  });

  // ── Simpan jendela ──────────────────────────────────────────────────────

  it("simpan: buat + ubah menulis jejak; barang yang sudah dipesan tidak bisa dikeluarkan; jendela dirilis terkunci", async () => {
    const isian = {
      name: `TEST-INDEN-SIMPAN-${token}`,
      opensOn: "2026-01-01",
      closesOn: "2099-12-31",
      shipFrom: "",
      shipTo: "",
      isActive: true,
      items: [{ itemId: itemA, plannedQty: 50 }, { itemId: itemB, plannedQty: null }],
    };
    const dibuat = await simpanJendelaInden({ isian, userId });
    expect(dibuat.ok).toBe(true);
    if (!dibuat.ok) return;
    extraWindowIds.push(dibuat.id);
    expect(await prisma.preorderWindowItem.count({ where: { windowId: dibuat.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityType: "PreorderWindow", entityId: dibuat.id, action: "CREATE" } })).toBe(1);

    await pesanInden(6, { itemId: itemA, wId: dibuat.id });
    const keluarkan = await simpanJendelaInden({ id: dibuat.id, isian: { ...isian, items: [{ itemId: itemB, plannedQty: 5 }] }, userId });
    expect(keluarkan).toEqual({ ok: false, kode: "BARANG_SUDAH_DIPESAN", itemIds: [itemA] });

    const ubah = await simpanJendelaInden({ id: dibuat.id, isian: { ...isian, items: [{ itemId: itemA, plannedQty: 80 }] }, userId });
    expect(ubah).toEqual({ ok: true, id: dibuat.id });
    const barang = await prisma.preorderWindowItem.findMany({ where: { windowId: dibuat.id } });
    expect(barang.map((b) => [b.itemId, b.plannedQty])).toEqual([[itemA, 80]]);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "PreorderWindow", entityId: dibuat.id, action: "UPDATE" } });
    expect((jejak.changes as { before: { items: unknown[] } }).before.items).toHaveLength(2);

    expect(await simpanJendelaInden({ isian: { ...isian, items: [{ itemId: uomId, plannedQty: 1 }] }, userId })).toEqual({
      ok: false,
      kode: "BARANG_TIDAK_SAH",
      itemIds: [uomId],
    });
    expect(await simpanJendelaInden({ isian: { ...isian, closesOn: "2025-12-01" }, userId })).toEqual({
      ok: false,
      kode: "TIDAK_SAH",
      galat: ["TUTUP_SEBELUM_BUKA"],
    });

    await rilisJendelaInden({ id: dibuat.id, userId });
    expect(await simpanJendelaInden({ id: dibuat.id, isian, userId })).toEqual({ ok: false, kode: "SUDAH_DIRILIS" });
  });
});
