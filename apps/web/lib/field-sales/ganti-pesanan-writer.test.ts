import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Batal dan ubah pesanan oleh salesman — penulis terhadap basis data uji.
 *
 * Semua baris milik fixture buatan tes (pengguna, toko, barang berkode acak);
 * teardown hanya lewat id yang diseed. Catatan kantor `PENDING_ORDER_APPROVAL`
 * (dan `STOCK_OVERSELL_RISK`) yang ditulis `createFieldSalesOrder` dicocokkan
 * di JS lewat `metadata.orderId`/`metadata.orderNo` pesanan tes ini lalu
 * dihapus per id — penyaringan jalur JSON tidak andal di semua adaptor.
 * Aturan pemilik (minimum, jarak jauh, kredit) DITIRUKAN: tes tidak mengubah
 * pengaturan bersama.
 */
const { mockMinimum, mockAturanJarakJauh, mockKredit } = vi.hoisted(() => ({
  mockMinimum: vi.fn(),
  mockAturanJarakJauh: vi.fn(),
  mockKredit: vi.fn(),
}));
vi.mock("./minimum-toko", () => ({ muatMinimumToko: mockMinimum }));
vi.mock("./jarak-jauh-toko", () => ({ muatAturanJarakJauh: mockAturanJarakJauh }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: mockKredit }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: vi.fn() }));

import { ATURAN_JARAK_JAUH_BAWAAN } from "./jarak-jauh";
import { bacaAturanMinimum } from "./minimum-pesanan";
import { approveFieldSalesOrder, cancelFieldSalesOrderBySalesman, createFieldSalesOrder } from "./writer";
import { BatalPesananError, PesananLamaTidakBisaDigantiError } from "./ganti-pesanan";
import { KreditDiblokirError } from "./kredit-pesanan";
import { MinQtyViolationError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `GNT-${Math.random().toString(36).slice(2, 10)}`;

d("batal & ganti pesanan sendiri — penulis (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let salesLain = "";
  let kantor = "";
  let kaos = "";
  let tokoPutus = "";
  let tokoLain = "";
  let tokoKonsi = "";
  let visitId = "";
  let visitKonsiId = "";
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const pengguna = async (n: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}` } })).id;
    sales = await pengguna("sales");
    salesLain = await pengguna("sales2");
    kantor = await pengguna("kantor");
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
      })
    ).id;
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "x", termsType, isActive: true, salesmanId: sales, markupPercent: termsType === "KONSI" ? 20 : null },
        })
      ).id;
    tokoPutus = await toko("PUTUS", "PUTUS");
    tokoLain = await toko("LAIN", "PUTUS");
    tokoKonsi = await toko("KONSI", "KONSI");
  });

  beforeEach(async () => {
    visitId = "";
    visitKonsiId = "";
    mockMinimum.mockReset().mockResolvedValue({ min: 1, jenis: "PERTAMA", aturan: bacaAturanMinimum(null, null) });
    mockAturanJarakJauh.mockReset().mockResolvedValue({ ...ATURAN_JARAK_JAUH_BAWAAN });
    mockKredit.mockReset().mockResolvedValue(null);
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.inventoryValue.create({ data: { itemId: kaos, variantSku: "", qtyOnHand: 20, reservedQty: 0, avgCost: 1000, totalValue: 20000 } });
    visitId = (await prisma.storeVisit.create({ data: { storeId: tokoPutus, userId: sales, checkinLat: 0, checkinLng: 0 } })).id;
    visitKonsiId = (await prisma.storeVisit.create({ data: { storeId: tokoKonsi, userId: sales, checkinLat: 0, checkinLng: 0 } })).id;
  });

  afterEach(async () => {
    const tokoIds = seededIds([tokoPutus, tokoLain, tokoKonsi].filter(Boolean));
    const pesanan = await prisma.fieldSalesOrder.findMany({ where: { storeId: { in: tokoIds } }, select: { id: true, orderNo: true } });
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
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds([visitId, visitKonsiId].filter(Boolean)) } } });
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoLain, tokoKonsi].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain, kantor].filter(Boolean)) } } });
  });

  const baris = (qty: number) => [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty, unitPrice: 1 }];
  const reservedQty = async () => Number((await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: kaos } })).reservedQty);
  const pesanPutus = (qty: number, extra: Partial<Parameters<typeof createFieldSalesOrder>[0]> = {}) =>
    createFieldSalesOrder({ storeId: tokoPutus, salesmanId: sales, visitId, lines: baris(qty), idempotencyKey: kunci(), ...extra });
  const order = (id: string) => prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id } });
  const jejak = (id: string) => prisma.auditLog.findMany({ where: { entityType: "FieldSalesOrder", entityId: id } });
  const keadaanCadangan = async (orderId: string) => {
    const lineIds = (await prisma.fieldSalesOrderLine.findMany({ where: { orderId }, select: { id: true } })).map((l) => l.id);
    const rows = await prisma.stockReservation.findMany({ where: { fieldSalesLineId: { in: seededIds(lineIds) } } });
    return rows.map((r) => r.state);
  };

  describe("cancelFieldSalesOrderBySalesman", () => {
    it("cancels a pending putus order: REJECTED + canceller, reservation released, audit row in the same step", async () => {
      const o = await pesanPutus(8);
      expect(await reservedQty()).toBe(8);

      const r = await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "  Toko batal  " });
      expect(r).toEqual({ ok: true, orderNo: o.orderNo, sudahDibatalkan: false });

      const s = await order(o.orderId);
      expect(s.status).toBe("REJECTED");
      expect(s.cancelledById).toBe(sales);
      expect(s.cancelledAt).not.toBeNull();
      expect(s.rejectedById).toBe(sales);
      expect(s.rejectReason).toBe("Toko batal");
      expect(await reservedQty()).toBe(0);
      expect(await keadaanCadangan(o.orderId)).toEqual(["RELEASED"]);

      const j = await jejak(o.orderId);
      expect(j).toHaveLength(1);
      expect(j[0]).toMatchObject({ action: "FIELD_SALES_ORDER_CANCELLED", userId: sales, reason: "Toko batal" });
      expect(j[0].changes).toMatchObject({ before: { status: "PENDING_APPROVAL" }, after: { status: "REJECTED", cancelledById: sales } });
    });

    it("cancels a pending konsi order (nothing reserved yet)", async () => {
      const o = await createFieldSalesOrder({ storeId: tokoKonsi, salesmanId: sales, visitId: visitKonsiId, lines: baris(3), idempotencyKey: kunci() });
      await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "salah toko" });
      expect((await order(o.orderId)).status).toBe("REJECTED");
      expect(await reservedQty()).toBe(0);
    });

    it("requires a reason and writes nothing without one", async () => {
      const o = await pesanPutus(2);
      const err = await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "   " }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BatalPesananError);
      expect((err as BatalPesananError).kode).toBe("ALASAN_WAJIB");
      const tooLong = await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "x".repeat(501) }).catch((e: unknown) => e);
      expect((tooLong as BatalPesananError).kode).toBe("ALASAN_TERLALU_PANJANG");
      expect((await order(o.orderId)).status).toBe("PENDING_APPROVAL");
      expect(await reservedQty()).toBe(2);
    });

    it("another salesman cannot cancel it — reads as not found, order untouched", async () => {
      const o = await pesanPutus(4);
      const err = await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: salesLain, reason: "iseng" }).catch((e: unknown) => e);
      expect((err as BatalPesananError).kode).toBe("TIDAK_DITEMUKAN");
      expect((await order(o.orderId)).status).toBe("PENDING_APPROVAL");
      expect(await reservedQty()).toBe(4);
      expect(await jejak(o.orderId)).toHaveLength(0);
    });

    it("never an approved or office-rejected order", async () => {
      const a = await pesanPutus(2);
      await approveFieldSalesOrder({ orderId: a.orderId, approvedById: kantor });
      const errA = await cancelFieldSalesOrderBySalesman({ orderId: a.orderId, salesmanId: sales, reason: "telat" }).catch((e: unknown) => e);
      expect((errA as BatalPesananError).kode).toBe("SUDAH_DIPUTUSKAN");
      expect((await order(a.orderId)).status).toBe("APPROVED");
    });

    it("cancelling twice is a no-op the second time, with one audit row", async () => {
      const o = await pesanPutus(2);
      await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "dobel" });
      const kedua = await cancelFieldSalesOrderBySalesman({ orderId: o.orderId, salesmanId: sales, reason: "dobel" });
      expect(kedua.sudahDibatalkan).toBe(true);
      expect(await jejak(o.orderId)).toHaveLength(1);
    });
  });

  describe("createFieldSalesOrder({ replacesOrderId })", () => {
    it("replaces atomically: old cancelled with 'Diganti dengan <new>', its stock released before the new lines reserve", async () => {
      const lama = await pesanPutus(8);
      // Stok rak 10: pesanan lama memegang 8. Pengganti 9 hanya muat kalau yang 8 dilepas DULU.
      await prisma.inventoryValue.updateMany({ where: { itemId: seededId(kaos) }, data: { qtyOnHand: 10 } });
      const baru = await pesanPutus(9, { replacesOrderId: lama.orderId });
      expect(baru.oversell).toEqual([]);

      const sLama = await order(lama.orderId);
      expect(sLama.status).toBe("REJECTED");
      expect(sLama.cancelledById).toBe(sales);
      expect(sLama.rejectReason).toBe(`Diganti dengan ${baru.orderNo}`);
      const sBaru = await order(baru.orderId);
      expect(sBaru.status).toBe("PENDING_APPROVAL");
      expect(sBaru.replacesOrderId).toBe(lama.orderId);
      // 9, bukan 17: cadangan pesanan lama sudah dilepas.
      expect(await reservedQty()).toBe(9);
      const j = await jejak(lama.orderId);
      expect(j).toHaveLength(1);
      expect(j[0].metadata).toMatchObject({ digantiDengan: baru.orderNo });
    });

    it("runs every rule again: below the minimum the replacement is refused and the old order stays pending", async () => {
      const lama = await pesanPutus(6);
      mockMinimum.mockResolvedValue({ min: 6, jenis: "PERTAMA", aturan: bacaAturanMinimum(null, null) });
      const err = await pesanPutus(2, { replacesOrderId: lama.orderId }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MinQtyViolationError);
      expect((await order(lama.orderId)).status).toBe("PENDING_APPROVAL");
      expect(await reservedQty()).toBe(6);
    });

    it("is atomic: a refusal AFTER the old order was cancelled (credit BLOKIR) rolls the cancellation back", async () => {
      const lama = await pesanPutus(2);
      mockKredit.mockResolvedValue({
        aturan: { mode: "BLOKIR", batasNilai: 100000, batasFaktur: null, hariToleransi: 0 },
        batas: { creditLimit: null, maxOpenInvoices: null },
        keadaan: { sisa: 0, fakturTerbuka: 0, lewatJanji: 0, fakturLewatJanji: 0 },
        baris: [],
      });
      const err = await pesanPutus(6, { replacesOrderId: lama.orderId }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KreditDiblokirError);

      const s = await order(lama.orderId);
      expect(s.status).toBe("PENDING_APPROVAL");
      expect(s.cancelledById).toBeNull();
      expect(await reservedQty()).toBe(2);
      expect(await keadaanCadangan(lama.orderId)).toEqual(["RESERVED"]);
      expect(await jejak(lama.orderId)).toHaveLength(0);
      expect(await prisma.fieldSalesOrder.count({ where: { replacesOrderId: lama.orderId } })).toBe(0);
    });

    it("refuses to replace an approved order", async () => {
      const lama = await pesanPutus(2);
      await approveFieldSalesOrder({ orderId: lama.orderId, approvedById: kantor });
      const err = await pesanPutus(3, { replacesOrderId: lama.orderId }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PesananLamaTidakBisaDigantiError);
      expect((await order(lama.orderId)).status).toBe("APPROVED");
      expect(await prisma.fieldSalesOrder.count({ where: { replacesOrderId: lama.orderId } })).toBe(0);
    });

    it("refuses to replace an order that was already replaced (no second replacement of the same order)", async () => {
      const lama = await pesanPutus(2);
      await pesanPutus(3, { replacesOrderId: lama.orderId });
      const err = await pesanPutus(4, { replacesOrderId: lama.orderId }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PesananLamaTidakBisaDigantiError);
      expect(await prisma.fieldSalesOrder.count({ where: { replacesOrderId: lama.orderId } })).toBe(1);
    });

    it("another salesman cannot replace it; the old order stays pending", async () => {
      const lama = await pesanPutus(2);
      const vLain = await prisma.storeVisit.create({ data: { storeId: tokoPutus, userId: salesLain, checkinLat: 0, checkinLng: 0 } });
      try {
        const err = await createFieldSalesOrder({
          storeId: tokoPutus,
          salesmanId: salesLain,
          visitId: vLain.id,
          lines: baris(3),
          idempotencyKey: kunci(),
          replacesOrderId: lama.orderId,
        }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(PesananLamaTidakBisaDigantiError);
        expect((await order(lama.orderId)).status).toBe("PENDING_APPROVAL");
        expect(await reservedQty()).toBe(2);
      } finally {
        await prisma.storeVisit.delete({ where: { id: vLain.id } });
      }
    });

    it("refuses a replacement for a different store", async () => {
      const lama = await pesanPutus(2);
      const err = await createFieldSalesOrder({
        storeId: tokoLain,
        salesmanId: sales,
        remoteChannel: "WA",
        lines: baris(3),
        idempotencyKey: kunci(),
        replacesOrderId: lama.orderId,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PesananLamaTidakBisaDigantiError);
      expect((await order(lama.orderId)).status).toBe("PENDING_APPROVAL");
    });

    it("carries the old order's visit, so an edit after check-out still lands on that visit", async () => {
      const lama = await pesanPutus(2);
      await prisma.storeVisit.update({ where: { id: visitId }, data: { checkoutAt: new Date() } });
      // Pemanggil tidak mengirim kunjungan apa pun.
      const baru = await createFieldSalesOrder({ storeId: tokoPutus, salesmanId: sales, lines: baris(3), idempotencyKey: kunci(), replacesOrderId: lama.orderId });
      const s = await order(baru.orderId);
      expect(s.visitId).toBe(visitId);
      expect(s.remoteChannel).toBeNull();
    });

    it("carries a remote channel (and ignores the caller's)", async () => {
      const lama = await createFieldSalesOrder({ storeId: tokoPutus, salesmanId: sales, remoteChannel: "TELEPON", lines: baris(2), idempotencyKey: kunci() });
      const baru = await createFieldSalesOrder({
        storeId: tokoPutus,
        salesmanId: sales,
        remoteChannel: "WA",
        lines: baris(3),
        idempotencyKey: kunci(),
        replacesOrderId: lama.orderId,
      });
      const s = await order(baru.orderId);
      expect(s.remoteChannel).toBe("TELEPON");
      expect(s.visitId).toBeNull();
    });

    it("a replayed replacement (same idempotency key) returns the same new order and cancels nothing twice", async () => {
      const lama = await pesanPutus(2);
      const k = kunci();
      const a = await createFieldSalesOrder({ storeId: tokoPutus, salesmanId: sales, visitId, lines: baris(3), idempotencyKey: k, replacesOrderId: lama.orderId });
      const b = await createFieldSalesOrder({ storeId: tokoPutus, salesmanId: sales, visitId, lines: baris(3), idempotencyKey: k, replacesOrderId: lama.orderId });
      expect(b.orderId).toBe(a.orderId);
      expect(await jejak(lama.orderId)).toHaveLength(1);
      expect(await reservedQty()).toBe(3);
    });
  });
});
