import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Check-out tanpa alasan TIDAK boleh lolos karena pesanan yang sudah dibatalkan.
 * Terhadap basis data uji dengan penulis pesanan yang asli (buat, batal, ganti);
 * hanya sesi, aturan pemilik (minimum, jarak jauh, kredit, alasan wajib) dan
 * pengiriman notifikasi yang ditiru — tes tidak mengubah pengaturan bersama.
 * Catatan kantor yang ditulis `createFieldSalesOrder` dicocokkan di JS lewat
 * `metadata.orderId`/`metadata.orderNo` pesanan tes ini lalu dihapus per id.
 */
const sesi = vi.hoisted(() => ({ userId: "" }));
const { mockMinimum, mockAturanJarakJauh, mockKredit } = vi.hoisted(() => ({
  mockMinimum: vi.fn(),
  mockAturanJarakJauh: vi.fn(),
  mockKredit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: sesi.userId } })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/minimum-toko", () => ({ muatMinimumToko: mockMinimum }));
vi.mock("@/lib/field-sales/jarak-jauh-toko", () => ({ muatAturanJarakJauh: mockAturanJarakJauh }));
vi.mock("@/lib/field-sales/kredit-toko", () => ({ muatKreditToko: mockKredit }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: vi.fn() }));
// Alasan wajib = aturan bawaan; ditiru supaya setelan di basis data bersama tidak ikut menentukan.
vi.mock("@/lib/salesman/aturan-kunjungan", async (asli) => ({
  ...(await asli<typeof import("@/lib/salesman/aturan-kunjungan")>()),
  bacaAturanHasilKunjungan: () => ({ alasanWajib: true, fotoWajib: false }),
}));

import { ATURAN_JARAK_JAUH_BAWAAN } from "@/lib/field-sales/jarak-jauh";
import { bacaAturanMinimum } from "@/lib/field-sales/minimum-pesanan";
import { cancelFieldSalesOrderBySalesman, createFieldSalesOrder } from "@/lib/field-sales/writer";
import { bacaSyaratCheckOut, checkIn, checkOut, checkOutLuringAction } from "./actions";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `COB-${Math.random().toString(36).slice(2, 10)}`;

d("checkOut — pesanan yang dibatalkan bukan transaksi (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let kaos = "";
  let toko = "";
  let tokoLain = "";
  let visitId = "";
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    sales = (await prisma.user.create({ data: { email: `${tag}-sales@test.local`.toLowerCase(), name: `sales ${tag}` } })).id;
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
      })
    ).id;
    toko = (
      await prisma.store.create({
        data: { code: `${tag}-PUTUS`, name: `Toko ${tag}`, address: "x", termsType: "PUTUS", isActive: true, salesmanId: sales },
      })
    ).id;
    tokoLain = (
      await prisma.store.create({
        data: { code: `${tag}-LAIN`, name: `Toko lain ${tag}`, address: "y", termsType: "PUTUS", isActive: true, salesmanId: sales },
      })
    ).id;
  });

  beforeEach(async () => {
    visitId = "";
    sesi.userId = sales;
    mockMinimum.mockReset().mockResolvedValue({ min: 1, jenis: "PERTAMA", aturan: bacaAturanMinimum(null, null) });
    mockAturanJarakJauh.mockReset().mockResolvedValue({ ...ATURAN_JARAK_JAUH_BAWAAN });
    mockKredit.mockReset().mockResolvedValue(null);
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.inventoryValue.create({ data: { itemId: kaos, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });
    visitId = (
      await prisma.storeVisit.create({
        data: { storeId: toko, userId: sales, checkinLat: 0, checkinLng: 0, checkinAt: new Date(Date.now() - 3_600_000) },
      })
    ).id;
  });

  afterEach(async () => {
    const pesanan = await prisma.fieldSalesOrder.findMany({ where: { storeId: seededId(toko) }, select: { id: true, orderNo: true } });
    const orderIds = pesanan.map((p) => p.id);
    const orderNos = pesanan.map((p) => p.orderNo);
    const catatan = await prisma.adminNotification.findMany({
      where: { category: { in: ["PENDING_ORDER_APPROVAL", "STOCK_OVERSELL_RISK"] } },
      select: { id: true, metadata: true },
    });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return (
          (typeof m?.orderId === "string" && orderIds.includes(m.orderId)) ||
          (typeof m?.orderNo === "string" && orderNos.includes(m.orderNo))
        );
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesOrder", entityId: { in: seededIds(orderIds) } } });
    const lineIds = (await prisma.fieldSalesOrderLine.findMany({ where: { orderId: { in: seededIds(orderIds) } }, select: { id: true } })).map((l) => l.id);
    await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(lineIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    if (visitId) await prisma.storeVisit.delete({ where: { id: seededId(visitId) } });
    // Kunjungan yang dibuka `checkIn` di toko kedua (tes tutup otomatis).
    await prisma.storeVisit.deleteMany({ where: { storeId: seededId(tokoLain) } });
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    if (kaos) await prisma.item.delete({ where: { id: seededId(kaos) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
    if (tokoLain) await prisma.store.delete({ where: { id: seededId(tokoLain) } });
    if (sales) await prisma.user.delete({ where: { id: seededId(sales) } });
  });

  const pesan = (extra: Partial<Parameters<typeof createFieldSalesOrder>[0]> = {}) =>
    createFieldSalesOrder({
      storeId: toko,
      salesmanId: sales,
      visitId,
      lines: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 3, unitPrice: 1 }],
      idempotencyKey: kunci(),
      ...extra,
    });
  const keluarTanpaAlasan = () => checkOut({ visitId, lat: 0, lng: 0 });
  const kunjungan = () => prisma.storeVisit.findUniqueOrThrow({ where: { id: visitId } });

  it("pesanan yang dibuat lalu DIBATALKAN: check-out tanpa alasan ditolak HASIL_WAJIB, kunjungan tetap terbuka", async () => {
    const o = await pesan();
    await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "Toko batal" });

    const syarat = await bacaSyaratCheckOut(visitId);
    expect(syarat).toMatchObject({ ok: true, selesai: false, perluAlasan: true, alasanWajib: true });

    expect(await keluarTanpaAlasan()).toEqual({ ok: false, code: "HASIL_WAJIB" });
    expect((await kunjungan()).checkoutAt).toBeNull();
  });

  it("pesanan yang DIGANTI: penggantinya membawa kunjungan ini, check-out tercatat TRANSAKSI", async () => {
    const lama = await pesan();
    const baru = await pesan({ replacesOrderId: lama.orderId });

    const pengganti = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: baru.orderId } });
    expect(pengganti).toMatchObject({ visitId, replacesOrderId: lama.orderId, status: "PENDING_APPROVAL" });
    expect(await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: lama.orderId } })).toMatchObject({
      status: "REJECTED",
      cancelledById: sales,
    });

    expect(await bacaSyaratCheckOut(visitId)).toMatchObject({ ok: true, perluAlasan: false });
    expect(await keluarTanpaAlasan()).toEqual({ alreadyClosed: false, storeId: toko });
    const v = await kunjungan();
    expect(v.checkoutAt).not.toBeNull();
    expect(v.outcome).toBe("TRANSAKSI");
  });

  it("pengganti yang dibatalkan juga: tidak ada transaksi lagi, HASIL_WAJIB", async () => {
    const lama = await pesan();
    const baru = await pesan({ replacesOrderId: lama.orderId });
    await cancelFieldSalesOrderBySalesman({ orderId: baru.orderId, salesmanId: sales, reason: "Toko batal" });

    expect(await keluarTanpaAlasan()).toEqual({ ok: false, code: "HASIL_WAJIB" });
  });

  it("pesanan yang masih menunggu persetujuan: check-out tanpa alasan lolos sebagai TRANSAKSI", async () => {
    await pesan();
    expect(await keluarTanpaAlasan()).toEqual({ alreadyClosed: false, storeId: toko });
    expect((await kunjungan()).outcome).toBe("TRANSAKSI");
  });

  it("pesanan dibatalkan tapi salesman memberi alasan: check-out lolos dengan alasannya", async () => {
    const o = await pesan();
    await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "Toko batal" });
    expect(await checkOut({ visitId, lat: 0, lng: 0, outcome: "STOK_MASIH_BANYAK" })).toEqual({ alreadyClosed: false, storeId: toko });
    expect((await kunjungan()).outcome).toBe("STOK_MASIH_BANYAK");
  });

  describe("jalur lain yang memakai penentuan yang sama", () => {
    const keluarLuring = () =>
      checkOutLuringAction({ visitId, waktu: new Date().toISOString(), lat: 0, lng: 0 });

    it("check-out tanpa sinyal (antrean HP): pesanan dibatalkan → HASIL_WAJIB, kunjungan tetap terbuka", async () => {
      const o = await pesan();
      await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "Toko batal" });
      expect(await keluarLuring()).toEqual({ ok: false, code: "HASIL_WAJIB" });
      expect((await kunjungan()).checkoutAt).toBeNull();
    });

    it("check-out tanpa sinyal dengan pesanan yang masih hidup: tercatat TRANSAKSI", async () => {
      await pesan();
      expect(await keluarLuring()).toEqual({ ok: true, storeId: toko, sudahTertutup: false });
      expect((await kunjungan()).outcome).toBe("TRANSAKSI");
    });

    const masukTokoLain = () =>
      expect(checkIn({ storeId: tokoLain, lat: -6.2, lng: 106.8, accuracy: 10 })).rejects.toThrow(`__REDIRECT__:/pwa/stores/${tokoLain}`);

    it("ditutup otomatis oleh check-in di toko lain: pesanan yang dibatalkan tidak membuat hasilnya TRANSAKSI", async () => {
      const o = await pesan();
      await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "Toko batal" });
      await masukTokoLain();
      const v = await kunjungan();
      expect(v.checkoutAt).not.toBeNull();
      expect(v.autoClosed).toBe(true);
      expect(v.outcome).toBeNull();
    });

    it("ditutup otomatis dengan pesanan yang masih hidup: hasilnya TRANSAKSI", async () => {
      await pesan();
      await masukTokoLain();
      const v = await kunjungan();
      expect(v.autoClosed).toBe(true);
      expect(v.outcome).toBe("TRANSAKSI");
    });
  });
});
