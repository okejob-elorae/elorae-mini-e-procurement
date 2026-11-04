import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Kueri HP untuk batal/ubah pesanan dan salinan WA — terhadap basis data uji.
 * Fixture buatan tes (pengguna, toko, barang berkode acak), teardown lewat
 * `seededId()`; catatan kantor yang ditulis `createFieldSalesOrder` dicocokkan
 * di JS lewat `metadata.orderId` lalu dihapus per id.
 */
const { mockMinimum } = vi.hoisted(() => ({ mockMinimum: vi.fn() }));
vi.mock("./minimum-toko", () => ({ muatMinimumToko: mockMinimum }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: vi.fn() }));

import { bacaAturanMinimum } from "./minimum-pesanan";
import { cancelFieldSalesOrderBySalesman, createFieldSalesOrder } from "./writer";
import { pesananSaya, pesananSayaById, pesananUntukDiganti, salinanPesananSaya, susunLinimasa } from "./pwa-queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

describe("susunLinimasa — dibatalkan salesman", () => {
  const dasar = {
    createdAt: new Date("2026-10-01T01:00:00Z"),
    approvedAt: null,
    rejectedAt: new Date("2026-10-01T02:00:00Z"),
    rejectReason: "Toko batal",
    closedAt: null,
    closeReason: null,
    pengiriman: [],
  };

  it("a cancelled order shows DIBATALKAN instead of DITOLAK, with the reason", () => {
    const l = susunLinimasa({ ...dasar, cancelledAt: new Date("2026-10-01T02:00:00Z") });
    expect(l.map((x) => x.jenis)).toEqual(["DIBUAT", "DIBATALKAN"]);
    expect(l[1]).toMatchObject({ alasan: "Toko batal" });
  });

  it("an office rejection is unchanged", () => {
    expect(susunLinimasa(dasar).map((x) => x.jenis)).toEqual(["DIBUAT", "DITOLAK"]);
  });
});

const tag = `GNQ-${Math.random().toString(36).slice(2, 10)}`;

d("kueri ubah pesanan + salinan WA (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let salesLain = "";
  let kaos = "";
  let hadiah = "";
  let promoId = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let visitPutus = "";
  let visitKonsi = "";
  let n = 0;
  const kunci = () => `${tag}-${n++}`;

  beforeAll(async () => {
    mockMinimum.mockResolvedValue({ min: 1, jenis: "PERTAMA", aturan: bacaAturanMinimum(null, null) });
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const pengguna = async (x: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${x}@test.local`.toLowerCase(), name: `Budi ${x}` } })).id;
    sales = await pengguna("sales");
    salesLain = await pengguna("lain");
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50000 },
      })
    ).id;
    hadiah = (
      await prisma.item.create({
        data: { sku: `${tag}-TOPI`, nameId: "Topi Uji", nameEn: "Test Cap", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
      })
    ).id;
    await prisma.inventoryValue.createMany({
      data: [
        { itemId: kaos, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 1000, totalValue: 50000 },
        { itemId: hadiah, variantSku: "", qtyOnHand: 50, reservedQty: 0, avgCost: 1000, totalValue: 50000 },
      ],
    });
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (
        await prisma.store.create({
          data: {
            code: `${tag}-${kode}`,
            name: `Toko ${kode} ${tag}`,
            address: "x",
            phone: "0812-1111-2222",
            termsType,
            isActive: true,
            salesmanId: sales,
            markupPercent: termsType === "KONSI" ? 25 : null,
          },
        })
      ).id;
    tokoPutus = await toko("PUTUS", "PUTUS");
    tokoKonsi = await toko("KONSI", "KONSI");
    // Beli 6 kaos gratis 1 topi — hanya untuk toko uji ini.
    promoId = (
      await prisma.promo.create({
        data: {
          name: `Bonus ${tag}`,
          type: "BONUS",
          level: "LINE",
          termsType: "PUTUS",
          allStores: false,
          bonusBuyQty: 6,
          bonusFreeQty: 1,
          bonusItemId: hadiah,
          items: { create: [{ itemId: kaos }] },
          stores: { create: [{ storeId: tokoPutus }] },
        },
      })
    ).id;
    visitPutus = (await prisma.storeVisit.create({ data: { storeId: tokoPutus, userId: sales, checkinLat: 0, checkinLng: 0 } })).id;
    visitKonsi = (await prisma.storeVisit.create({ data: { storeId: tokoKonsi, userId: sales, checkinLat: 0, checkinLng: 0 } })).id;
  });

  afterAll(async () => {
    const tokoIds = seededIds([tokoPutus, tokoKonsi].filter(Boolean));
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
        return (typeof m?.orderId === "string" && orderIds.includes(m.orderId)) || (typeof m?.orderNo === "string" && orderNos.includes(m.orderNo));
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesOrder", entityId: { in: seededIds(orderIds) } } });
    const lineIds = (await prisma.fieldSalesOrderLine.findMany({ where: { orderId: { in: seededIds(orderIds) } }, select: { id: true } })).map((l) => l.id);
    await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(lineIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.promo.deleteMany({ where: { id: seededId(promoId) } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds([visitPutus, visitKonsi].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoKonsi].filter(Boolean)) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([kaos, hadiah].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, hadiah].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain].filter(Boolean)) } } });
  });

  it("pesananUntukDiganti: own pending order with its appeal, bonus lines left out, held stock per line key", async () => {
    const o = await createFieldSalesOrder({
      storeId: tokoPutus,
      salesmanId: sales,
      visitId: visitPutus,
      note: "Kirim Jumat",
      idempotencyKey: kunci(),
      lines: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 6, unitPrice: 0, requestedUnitPrice: 45000, appealReason: "langganan" }],
    });
    const g = await pesananUntukDiganti(o.orderId, sales, tokoPutus);
    expect(g).not.toBeNull();
    expect(g!.status).toBe("PENDING_APPROVAL");
    expect(g!.note).toBe("Kirim Jumat");
    expect(g!.baris).toEqual([{ itemId: kaos, variantSku: "", qty: 6, requestedUnitPrice: 45000, appealReason: "langganan" }]);
    // Kaos 6 + topi bonus 1 dipegang pesanan ini.
    expect(g!.cadangan).toEqual({ [`${kaos}::`]: 6, [`${hadiah}::`]: 1 });

    // Pesanan orang lain / toko lain = tidak ada.
    expect(await pesananUntukDiganti(o.orderId, salesLain, tokoPutus)).toBeNull();
    expect(await pesananUntukDiganti(o.orderId, sales, tokoKonsi)).toBeNull();
  });

  it("salinanPesananSaya: PUTUS carries server prices, the bonus line and the store's wa.me number", async () => {
    const o = await createFieldSalesOrder({
      storeId: tokoPutus,
      salesmanId: sales,
      visitId: visitPutus,
      idempotencyKey: kunci(),
      lines: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 6, unitPrice: 1 }],
    });
    const s = await salinanPesananSaya(o.orderId, sales);
    expect(s).not.toBeNull();
    expect(s!.adaNomor).toBe(true);
    expect(s!.tautan.startsWith("https://wa.me/6281211112222?text=")).toBe(true);
    // Harga server (50.000), bukan harga kiriman HP (1).
    expect(s!.teks).toMatch(/Kaos Uji × 6 @ Rp.50\.000 = Rp.300\.000/);
    expect(s!.teks).toContain("Topi Uji × 1 (bonus)");
    expect(s!.teks).toContain("Harga final setelah disetujui kantor.");
    expect(s!.teks).toContain(`Budi sales`);
    // Pemilik lain tidak bisa mengambilnya.
    expect(await salinanPesananSaya(o.orderId, salesLain)).toBeNull();
  });

  it("salinanPesananSaya: KONSI has no Rp anywhere in the real text", async () => {
    const o = await createFieldSalesOrder({
      storeId: tokoKonsi,
      salesmanId: sales,
      visitId: visitKonsi,
      idempotencyKey: kunci(),
      lines: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 4, unitPrice: 0 }],
    });
    const s = await salinanPesananSaya(o.orderId, sales);
    expect(s).not.toBeNull();
    expect(s!.teks).not.toMatch(/Rp\s?\d/);
    expect(s!.teks).toContain("Kaos Uji × 4");
    expect(s!.teks).toContain("Jumlah: 4 pcs");
    expect(decodeURIComponent(s!.tautan)).not.toMatch(/Rp\s?\d/);
  });

  it("a cancelled order has no WA copy; lists and detail flag it and link the replacement both ways", async () => {
    const lama = await createFieldSalesOrder({
      storeId: tokoPutus,
      salesmanId: sales,
      visitId: visitPutus,
      idempotencyKey: kunci(),
      lines: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 2, unitPrice: 0 }],
    });
    const baru = await createFieldSalesOrder({
      storeId: tokoPutus,
      salesmanId: sales,
      idempotencyKey: kunci(),
      replacesOrderId: lama.orderId,
      lines: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 3, unitPrice: 0 }],
    });
    const batal = await createFieldSalesOrder({
      storeId: tokoPutus,
      salesmanId: sales,
      visitId: visitPutus,
      idempotencyKey: kunci(),
      lines: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 1, unitPrice: 0 }],
    });
    await cancelFieldSalesOrderBySalesman({ orderId: batal.orderId, salesmanId: sales, reason: "toko tutup" });

    expect(await salinanPesananSaya(lama.orderId, sales)).toBeNull();
    expect(await salinanPesananSaya(batal.orderId, sales)).toBeNull();

    const dLama = await pesananSayaById(lama.orderId, sales);
    expect(dLama).toMatchObject({ dibatalkan: true, digantiDengan: { id: baru.orderId, orderNo: baru.orderNo }, menggantikan: null });
    expect(dLama!.linimasa.map((l) => l.jenis)).toEqual(["DIBUAT", "DIBATALKAN"]);
    const dBaru = await pesananSayaById(baru.orderId, sales);
    expect(dBaru).toMatchObject({ dibatalkan: false, menggantikan: { id: lama.orderId, orderNo: lama.orderNo }, digantiDengan: null });

    const daftar = await pesananSaya(sales, { status: "semua", batas: 300 });
    const baris = (id: string) => daftar.baris.find((b) => b.id === id)!;
    expect(baris(lama.orderId)).toMatchObject({ dibatalkan: true, digantiDengan: { orderNo: baru.orderNo } });
    expect(baris(baru.orderId)).toMatchObject({ dibatalkan: false, menggantikan: { orderNo: lama.orderNo } });
    expect(baris(batal.orderId)).toMatchObject({ dibatalkan: true, digantiDengan: null, rejectReason: "toko tutup" });
  });
});
