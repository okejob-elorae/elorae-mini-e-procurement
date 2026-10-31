import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ATURAN_JARAK_JAUH_BAWAAN, JarakJauhDitolakError } from "./jarak-jauh";
import { bacaAturanMinimum } from "./minimum-pesanan";

/*
 * Penulis pesanan — minimum bertingkat, promo bonus, pesanan jarak jauh —
 * terhadap basis data uji. Aturan pemilik (`SystemSetting` bersama) DITIRUKAN:
 * tes tidak boleh mengubah pengaturan yang dipakai orang lain. Promo bonus yang
 * diseed dibatasi ke toko uji saja (`allStores: false`), jadi tidak pernah
 * menyentuh pesanan toko lain.
 */
const { mockMinimum, mockAturanJarakJauh } = vi.hoisted(() => ({ mockMinimum: vi.fn(), mockAturanJarakJauh: vi.fn() }));
vi.mock("./minimum-toko", () => ({ muatMinimumToko: mockMinimum }));
vi.mock("./jarak-jauh-toko", () => ({ muatAturanJarakJauh: mockAturanJarakJauh }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: vi.fn() }));

import { createFieldSalesOrder, approveFieldSalesOrder } from "./writer";
import { MinQtyViolationError, NoActiveVisitError } from "./errors";
import { recordFieldSalesDelivery } from "./delivery/writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const minimum = (min: number, jenis: "PERTAMA" | "ULANG" = "PERTAMA") => ({ min, jenis, aturan: bacaAturanMinimum(null, null) });

d("createFieldSalesOrder — minimum, bonus, jarak jauh (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const sku = `TEST-FSL-${token}`;
  const mulai = new Date();
  let uomId = "";
  let itemId = "";
  let hadiahId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let promoIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    hadiahId = "";
    storeId = "";
    salesmanId = "";
    visitId = "";
    promoIds = [];
    mockMinimum.mockReset();
    mockMinimum.mockResolvedValue(minimum(6));
    mockAturanJarakJauh.mockReset();
    mockAturanJarakJauh.mockResolvedValue({ ...ATURAN_JARAK_JAUH_BAWAAN });

    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const store = await prisma.store.create({
      data: { code: `S-${sku}`, name: "Toko Uji", address: "Uji", termsType: "PUTUS", isActive: true, salesmanId },
    });
    storeId = store.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;
  });

  afterEach(async () => {
    const pesanan = await prisma.fieldSalesOrder.findMany({ where: { storeId: seededId(storeId) }, select: { id: true, orderNo: true } });
    const orderIds = pesanan.map((p) => p.id);
    const itemIds = [itemId, hadiahId].filter((x) => x !== "");
    for (const p of pesanan) {
      await prisma.adminNotification.deleteMany({
        where: { category: "PENDING_ORDER_APPROVAL", createdAt: { gte: new Date(mulai) }, message: { contains: seededId(p.orderNo) } },
      });
    }
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.taxInvoice.deleteMany({ where: { delivery: { orderId: { in: seededIds(orderIds) } } } });
    // Nota = piutang: hapus piutangnya SEBELUM notanya (emulasi relasi 1:1 Prisma gagal pada deleteMany banyak nota).
    await prisma.receivable.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.promo.deleteMany({ where: { id: { in: seededIds(promoIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(itemIds) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const baris = (qty: number) => [{ itemId, variantSku: "", productName: "Kaos Uji", qty, unitPrice: 1 }];

  async function promoBonus(data: { bonusBuyQty: number; bonusFreeQty: number; bonusItemId?: string | null; name?: string }) {
    const p = await prisma.promo.create({
      data: {
        name: data.name ?? `Bonus ${token}`,
        type: "BONUS",
        level: "LINE",
        termsType: "PUTUS",
        allStores: false,
        bonusBuyQty: data.bonusBuyQty,
        bonusFreeQty: data.bonusFreeQty,
        bonusItemId: data.bonusItemId ?? null,
        items: { create: [{ itemId }] },
        stores: { create: [{ storeId }] },
      },
    });
    promoIds.push(p.id);
    return p;
  }

  describe("tiered minimum", () => {
    it("uses the store's minimum (reorder tier) for items without their own", async () => {
      mockMinimum.mockResolvedValue(minimum(3, "ULANG"));
      const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(3) });
      expect(res.orderNo).toMatch(/^PUTUS\//);
      expect(mockMinimum).toHaveBeenCalledWith(storeId, expect.anything());
    });

    it("refuses below the store's minimum", async () => {
      mockMinimum.mockResolvedValue(minimum(8, "PERTAMA"));
      const err = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(6) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MinQtyViolationError);
      expect((err as MinQtyViolationError).violations).toEqual([{ itemId, requiredMin: 8, actualQty: 6 }]);
    });

    it("an item's own minimum still wins over the store tier", async () => {
      mockMinimum.mockResolvedValue(minimum(8, "ULANG"));
      await prisma.item.update({ where: { id: itemId }, data: { minOrderQty: 2 } });
      const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(2) });
      expect(res.orderId).toBeTruthy();
    });
  });

  describe("bonus promo", () => {
    it("adds a free line of the same item, reserves it, and leaves the total alone", async () => {
      const promo = await promoBonus({ bonusBuyQty: 6, bonusFreeQty: 1 });
      const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(13) });
      const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
      const gratis = order.lines.filter((l) => l.isBonus);
      expect(gratis).toHaveLength(1);
      expect(gratis[0]).toMatchObject({ itemId, variantSku: "", qty: 2, bonusPromoId: promo.id, productName: "Kaos Uji (bonus)" });
      expect(Number(gratis[0].unitPrice)).toBe(0);
      expect(Number(gratis[0].lineTotal)).toBe(0);
      expect(Number(order.total)).toBe(13 * 35000);
      expect(Number(order.subtotal)).toBe(13 * 35000);
      const inv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
      expect(Number(inv.reservedQty)).toBe(15);
      const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: gratis[0].id } });
      expect(Number(rsv?.qty)).toBe(2);
      expect(order.note).toBeNull();
    });

    it("gives only what is in stock and notes the shortfall, never blocking the order", async () => {
      await promoBonus({ bonusBuyQty: 6, bonusFreeQty: 1, name: `Beli 6 ${token}` });
      await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemId) }, data: { qtyOnHand: 13 } });
      const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(12), note: "Kirim pagi" });
      const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
      expect(order.lines.filter((l) => l.isBonus).map((l) => l.qty)).toEqual([1]);
      expect(order.note).toBe(`Kirim pagi\n[Bonus] Kurang 1 pcs Kaos Uji (promo Beli 6 ${token}) — stok tidak cukup.`);
    });

    it("no stock at all → no bonus line, order still created with the shortfall noted", async () => {
      await promoBonus({ bonusBuyQty: 6, bonusFreeQty: 2 });
      await prisma.inventoryValue.updateMany({ where: { itemId: seededId(itemId) }, data: { qtyOnHand: 6 } });
      const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(6) });
      const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
      expect(order.lines.some((l) => l.isBonus)).toBe(false);
      expect(order.note).toContain("[Bonus] Kurang 2 pcs");
    });

    it("a gift item not on the order goes out as its best-stocked variant", async () => {
      const hadiah = await prisma.item.create({
        data: {
          sku: `${sku}-G`,
          nameId: "Topi Uji",
          nameEn: "Test Cap",
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          sellingPrice: 10000,
          variants: [{ sku: `${sku}-G-S`, size: "S" }, { sku: `${sku}-G-L`, size: "L" }],
        },
      });
      hadiahId = hadiah.id;
      await prisma.inventoryValue.create({ data: { itemId: hadiahId, variantSku: `${sku}-G-S`, qtyOnHand: 2, reservedQty: 0, avgCost: 1, totalValue: 2 } });
      await prisma.inventoryValue.create({ data: { itemId: hadiahId, variantSku: `${sku}-G-L`, qtyOnHand: 9, reservedQty: 0, avgCost: 1, totalValue: 9 } });
      await promoBonus({ bonusBuyQty: 6, bonusFreeQty: 1, bonusItemId: hadiahId });
      const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(6) });
      const gratis = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: seededId(res.orderId), isBonus: true } });
      expect(gratis).toHaveLength(1);
      expect(gratis[0]).toMatchObject({ itemId: hadiahId, variantSku: `${sku}-G-L`, qty: 1 });
      expect(gratis[0].productName).toBe(`Topi Uji — L (${sku}-G-L) (bonus)`);
    });

    it("the bonus line delivers at price 0 and the deliveries still sum to the order total", async () => {
      await promoBonus({ bonusBuyQty: 6, bonusFreeQty: 1 });
      const res = await createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(12) });
      await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId });
      const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
      const dlv = await recordFieldSalesDelivery({
        orderId: order.id,
        deliveredById: salesmanId,
        lines: order.lines.map((l) => ({ orderLineId: l.id, qty: l.qty })),
        invoiceDate: new Date("2026-09-30T00:00:00+07:00"),
        dueDate: new Date("2026-10-30T00:00:00+07:00"),
      });
      const delivery = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: dlv.deliveryId }, include: { lines: true } });
      expect(Number(delivery.total)).toBe(Number(order.total));
      const bonusLine = order.lines.find((l) => l.isBonus)!;
      const terkirim = delivery.lines.find((l) => l.orderLineId === bonusLine.id)!;
      expect(terkirim.qty).toBe(2);
      expect(Number(terkirim.lineTotal)).toBe(0);
      const selesai = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(selesai.deliveryStatus).toBe("DELIVERED");
    });
  });

  describe("remote order", () => {
    it("records without a visit when the salesman holds the store", async () => {
      await prisma.storeVisit.update({ where: { id: visitId }, data: { checkoutAt: new Date() } });
      const res = await createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "WA", lines: baris(6) });
      const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
      expect(order.visitId).toBeNull();
      expect(order.remoteChannel).toBe("WA");
      expect(Number(order.total)).toBe(6 * 35000);
      const notif = await prisma.adminNotification.findFirst({
        where: { category: "PENDING_ORDER_APPROVAL", createdAt: { gte: new Date(mulai) }, message: { contains: seededId(order.orderNo) } },
      });
      expect(notif?.message).toContain("Remote order (WA)");
    });

    it("without remoteChannel a missing visit is still refused", async () => {
      await prisma.storeVisit.update({ where: { id: visitId }, data: { checkoutAt: new Date() } });
      await expect(createFieldSalesOrder({ storeId, salesmanId, lines: baris(6) })).rejects.toBeInstanceOf(NoActiveVisitError);
    });

    it("refused when the owner turned remote orders off", async () => {
      mockAturanJarakJauh.mockResolvedValue({ aktif: false, hanyaTokoSendiri: true });
      const err = await createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "TELEPON", lines: baris(6) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(JarakJauhDitolakError);
      expect((err as JarakJauhDitolakError).code).toBe("JARAK_JAUH_NONAKTIF");
      expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(0);
    });

    it("refused for a store someone else holds, allowed once own-stores-only is off", async () => {
      await prisma.store.update({ where: { id: storeId }, data: { salesmanId: null } });
      const err = await createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "LAINNYA", lines: baris(6) }).catch((e: unknown) => e);
      expect((err as JarakJauhDitolakError).code).toBe("BUKAN_TOKO_SENDIRI");

      mockAturanJarakJauh.mockResolvedValue({ aktif: true, hanyaTokoSendiri: false });
      const res = await createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "LAINNYA", lines: baris(6) });
      expect(res.orderId).toBeTruthy();
    });

    it("minimums and bonus apply to remote orders exactly as to visit orders", async () => {
      await promoBonus({ bonusBuyQty: 6, bonusFreeQty: 1 });
      mockMinimum.mockResolvedValue(minimum(8));
      await expect(createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "WA", lines: baris(6) })).rejects.toBeInstanceOf(
        MinQtyViolationError,
      );
      mockMinimum.mockResolvedValue(minimum(6));
      const res = await createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "WA", lines: baris(6) });
      const gratis = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: seededId(res.orderId), isBonus: true } });
      expect(gratis.map((l) => l.qty)).toEqual([1]);
    });

    it("an idempotent replay returns the existing order even if remote orders were switched off since", async () => {
      const pertama = await createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "WA", lines: baris(6), idempotencyKey: `k-${token}` });
      mockAturanJarakJauh.mockResolvedValue({ aktif: false, hanyaTokoSendiri: true });
      const ulang = await createFieldSalesOrder({ storeId, salesmanId, remoteChannel: "WA", lines: baris(6), idempotencyKey: `k-${token}` });
      expect(ulang.orderId).toBe(pertama.orderId);
    });
  });
});
