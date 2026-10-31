import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Dasar nilai "harga toko terima" (HARGA_TERIMA) terhadap basis data uji:
 * harga bersih nota kiriman putus terakhir ke toko itu (varian persis dulu,
 * baris bonus dilewati, kiriman ke toko lain diabaikan), harga konsinyasi
 * terakhir yang berharga (kiriman konsinyasi atau pesanan konsi disetujui)
 * dibagi markup toko, dan cadangan harga jual Elorae — lalu
 * catatan manual yang membekukan nilainya dan menandai baris cadangan.
 *
 * Semua baris milik fixture buatan tes; teardown hanya lewat id yang diseed.
 */

vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(async () => {}),
}));

const { nilaiBarisHilang } = await import("./hilang-db");
const { buatBarangHilang } = await import("./hilang-writer");
const { rincianHilangKantor } = await import("./hilang-queries");
const { KATEGORI_NOTIF_HILANG } = await import("./hilang");
const { KUNCI_BARANG_HILANG } = await import("./pengaturan");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `HTR-${Math.random().toString(36).slice(2, 9)}`;

d("barang hilang — harga toko terima (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let celana = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let tokoLain = "";
  let kantor = "";
  const orderIds: string[] = [];
  const deliveryIds: string[] = [];
  const shipmentIds: string[] = [];
  let aturanAwal: string | null = null;
  let adaAturanAwal = false;

  const M = `${tag}-KAOS-M`;
  const L = `${tag}-KAOS-L`;
  const tokoIds = () => seededIds([tokoPutus, tokoKonsi, tokoLain].filter(Boolean));
  const tgl = (hari: number) => new Date(Date.UTC(2026, 8, hari, 3));

  async function pesanan(
    storeId: string,
    baris: { itemId: string; variantSku: string; unitPrice: number; isBonus?: boolean }[],
    konsi?: { status: "APPROVED" | "PENDING_APPROVAL"; approvedAt: Date | null },
  ) {
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-PO-${orderIds.length + 1}`,
        storeId,
        salesmanId: kantor,
        status: konsi?.status ?? "APPROVED",
        ...(konsi ? { orderType: "KONSI" as const, approvedAt: konsi.approvedAt } : {}),
        subtotal: 0,
        total: 0,
        lines: {
          create: baris.map((b) => ({
            itemId: b.itemId,
            variantSku: b.variantSku,
            productName: "uji",
            qty: 10,
            unitPrice: b.unitPrice,
            lineTotal: b.unitPrice * 10,
            isBonus: b.isBonus ?? false,
          })),
        },
      },
      select: { id: true, lines: { select: { id: true, itemId: true, variantSku: true, isBonus: true } } },
    });
    orderIds.push(order.id);
    return order;
  }

  async function kirim(
    order: { id: string; lines: { id: string; itemId: string; variantSku: string; isBonus: boolean }[] },
    pada: Date,
    baris: { itemId: string; variantSku: string; qty: number; unitPrice: number | null; discountAmount?: number; isBonus?: boolean }[],
  ) {
    const dlv = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${deliveryIds.length + 1}`,
        orderId: order.id,
        deliveredAt: pada,
        deliveredById: kantor,
        invoiceDate: pada,
        dueDate: pada,
        subtotal: 0,
        total: 0,
        lines: {
          create: baris.map((b) => {
            const ol = order.lines.find((l) => l.itemId === b.itemId && l.variantSku === b.variantSku && l.isBonus === (b.isBonus ?? false));
            if (!ol) throw new Error("baris pesanan uji tidak ada");
            return {
              orderLineId: ol.id,
              itemId: b.itemId,
              variantSku: b.variantSku,
              productName: "uji",
              qty: b.qty,
              unitPrice: b.unitPrice,
              discountAmount: b.discountAmount ?? 0,
            };
          }),
        },
      },
      select: { id: true },
    });
    deliveryIds.push(dlv.id);
  }

  async function kirimKonsi(pada: Date, baris: { itemId: string | null; price: number }[]) {
    const s = await prisma.consignmentShipment.create({
      data: {
        noKirim: `${tag}-KRM-${shipmentIds.length + 1}`,
        storeId: tokoKonsi,
        shippedAt: pada,
        items: { create: baris.map((b) => ({ itemId: b.itemId, itemName: "uji", qty: 5, price: b.price, amount: b.price * 5 })) },
      },
      select: { id: true },
    });
    shipmentIds.push(s.id);
  }

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_BARANG_HILANG }, select: { value: true } });
    adaAturanAwal = ada !== null;
    aturanAwal = ada?.value ?? null;
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_BARANG_HILANG },
      create: { key: KUNCI_BARANG_HILANG, value: JSON.stringify({ dasarNilai: "HARGA_TERIMA", maksPotongPersen: 50, dariOpname: true }) },
      update: { value: JSON.stringify({ dasarNilai: "HARGA_TERIMA", maksPotongPersen: 50, dariOpname: true }) },
    });

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = async (sku: string, nama: string, harga: number, variants?: { sku: string; size: string }[]) =>
      (await prisma.item.create({ data: { sku, nameId: nama, nameEn: nama, type: "FINISHED_GOOD", uomId, sellingPrice: harga, ...(variants ? { variants } : {}) } })).id;
    kaos = await barang(`${tag}-KAOS`, "Kaos Uji", 100_000, [
      { sku: M, size: "M" },
      { sku: L, size: "L" },
    ]);
    kemeja = await barang(`${tag}-KMJ`, "Kemeja Uji", 80_000);
    celana = await barang(`${tag}-CLN`, "Celana Uji", 90_000);
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`.toLowerCase(), name: `kantor ${tag}` } })).id;
    const toko = async (k: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType, markupPercent: termsType === "KONSI" ? 25 : null } })).id;
    tokoPutus = await toko("P", "PUTUS");
    tokoKonsi = await toko("K", "KONSI");
    tokoLain = await toko("L", "PUTUS");

    const o = await pesanan(tokoPutus, [
      { itemId: kaos, variantSku: M, unitPrice: 80_000 },
      { itemId: kaos, variantSku: L, unitPrice: 85_000 },
      { itemId: kemeja, variantSku: "", unitPrice: 70_000 },
      { itemId: kemeja, variantSku: "", unitPrice: 1_000, isBonus: true },
    ]);
    await kirim(o, tgl(1), [
      { itemId: kaos, variantSku: M, qty: 2, unitPrice: 80_000 },
      { itemId: kemeja, variantSku: "", qty: 3, unitPrice: 70_000, discountAmount: 3_000 },
    ]);
    // Contoh pemilik: harga toko terima 75.000 (80.000 dipotong 10.000 untuk 2 potong).
    await kirim(o, tgl(20), [{ itemId: kaos, variantSku: M, qty: 2, unitPrice: 80_000, discountAmount: 10_000 }]);
    // Varian lain yang LEBIH BARU — tidak boleh mengalahkan varian persis.
    await kirim(o, tgl(22), [{ itemId: kaos, variantSku: L, qty: 1, unitPrice: 85_000 }]);
    // Baris bonus terbaru — bukan harga terima.
    await kirim(o, tgl(25), [{ itemId: kemeja, variantSku: "", qty: 1, unitPrice: 1_000, isBonus: true }]);

    // Toko lain menerima lebih murah dan lebih baru — tidak boleh terbawa.
    const lain = await pesanan(tokoLain, [{ itemId: kaos, variantSku: M, unitPrice: 10_000 }]);
    await kirim(lain, tgl(28), [{ itemId: kaos, variantSku: M, qty: 1, unitPrice: 10_000 }]);

    await kirimKonsi(tgl(5), [{ itemId: kaos, price: 60_000 }]);
    await kirimKonsi(tgl(15), [
      { itemId: kaos, price: 62_000 },
      { itemId: celana, price: 80_000 },
      { itemId: null, price: 99_000 },
    ]);
    // Kiriman terbaru tanpa harga — dilewati.
    await kirimKonsi(tgl(25), [{ itemId: kaos, price: 0 }]);
    // Pesanan konsi salesman: harga di toko per varian. L disetujui paling
    // baru (100.000 → 80.000); yang belum disetujui dan bonus tidak dihitung.
    await pesanan(tokoKonsi, [{ itemId: kaos, variantSku: L, unitPrice: 100_000 }], { status: "APPROVED", approvedAt: tgl(18) });
    await pesanan(tokoKonsi, [{ itemId: kaos, variantSku: L, unitPrice: 1_000 }], { status: "PENDING_APPROVAL", approvedAt: null });
    await pesanan(tokoKonsi, [{ itemId: kaos, variantSku: L, unitPrice: 2_000, isBonus: true }], { status: "APPROVED", approvedAt: tgl(27) });
  });

  afterEach(async () => {
    const losses = await prisma.stockLoss.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const lossIds = losses.map((l) => l.id);
    const catatan = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { id: true, metadata: true } });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.lossId === "string" && lossIds.includes(m.lossId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(lossIds) } } });
    await prisma.stockLossLine.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(lossIds) } } });
  });

  afterAll(async () => {
    if (adaAturanAwal && aturanAwal !== null) {
      await prisma.systemSetting.update({ where: { key: KUNCI_BARANG_HILANG }, data: { value: aturanAwal } });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_BARANG_HILANG) } });
    }
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: { in: seededIds(shipmentIds) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(shipmentIds) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(kantor) } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.user.deleteMany({ where: { id: seededId(kantor) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, kemeja, celana].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const nilai = (
    toko: { id: string; termsType: "PUTUS" | "KONSI"; markupPercent: unknown; priceDiscountPercent: unknown } | null,
    baris: { itemId: string | null; variantSku: string }[],
  ) =>
    prisma.$transaction((tx) =>
      nilaiBarisHilang(
        tx,
        baris.map((b) => ({ ...b, productName: "uji", qty: 2 })),
        toko,
        "HARGA_TERIMA",
      ),
    );

  it("toko putus: harga bersih nota kiriman terakhir — varian persis dulu, bonus dan toko lain diabaikan, cadangan harga jual", async () => {
    const r = await nilai({ id: tokoPutus, termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, [
      { itemId: kaos, variantSku: M },
      { itemId: kaos, variantSku: L },
      { itemId: kaos, variantSku: `${tag}-KAOS-XL` },
      { itemId: kemeja, variantSku: "" },
      { itemId: celana, variantSku: "" },
      { itemId: null, variantSku: "" },
    ]);
    expect(r.map((b) => [b.unitSen / 100, b.amountSen / 100, b.sumberHarga])).toEqual([
      [75_000, 150_000, "KIRIMAN"],
      [85_000, 170_000, "KIRIMAN"],
      // Varian yang tidak pernah dikirim: kiriman terbaru barang yang sama (L, 22 Sept).
      [85_000, 170_000, "KIRIMAN"],
      // 70.000 − 3.000 ÷ 3; baris bonus 25 Sept dilewati.
      [69_000, 138_000, "KIRIMAN"],
      // Belum pernah diterima toko ini → harga jual Elorae.
      [90_000, 180_000, "HARGA_ELORAE"],
      [0, 0, null],
    ]);
  });

  it("toko konsinyasi: harga konsinyasi terakhir dibagi markup toko; tanpa kiriman → harga jual Elorae", async () => {
    const r = await nilai({ id: tokoKonsi, termsType: "KONSI", markupPercent: 25, priceDiscountPercent: null }, [
      { itemId: kaos, variantSku: M },
      { itemId: kaos, variantSku: L },
      { itemId: celana, variantSku: "" },
      { itemId: kemeja, variantSku: "" },
    ]);
    expect(r.map((b) => [b.unitSen / 100, b.sumberHarga])).toEqual([
      // Tidak ada pesanan varian M: yang terbaru adalah pesanan L 18 Sept
      // (100.000 ÷ 1,25), lebih baru dari kiriman konsinyasi 15 Sept.
      [80_000, "KIRIMAN"],
      // Harga di toko 100.000, markup 25% → Elorae terima 100.000 ÷ 1,25 = 80.000.
      [80_000, "KIRIMAN"],
      // Hanya kiriman konsinyasi (tanpa varian): 80.000 ÷ 1,25.
      [64_000, "KIRIMAN"],
      [80_000, "HARGA_ELORAE"],
    ]);
  });

  it("tanpa toko: semuanya harga jual Elorae", async () => {
    const r = await nilai(null, [{ itemId: kaos, variantSku: M }]);
    expect(r.map((b) => [b.unitSen / 100, b.sumberHarga])).toEqual([[100_000, "HARGA_ELORAE"]]);
  });

  it("dasar lain tidak membaca kiriman", async () => {
    const r = await prisma.$transaction((tx) =>
      nilaiBarisHilang(tx, [{ itemId: kaos, variantSku: M, productName: "uji", qty: 1 }], { id: tokoPutus, termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, "HARGA_ELORAE"),
    );
    expect(r.map((b) => [b.unitSen / 100, b.sumberHarga])).toEqual([[100_000, null]]);
  });

  it("catat manual: nilai dibekukan dengan harga toko terima, baris cadangan tercatat di jejak dan ditandai di rincian", async () => {
    const res = await buatBarangHilang({
      storeId: tokoPutus,
      baris: [
        { itemId: kaos, variantSku: M, qty: 1 },
        { itemId: celana, variantSku: "", qty: 1 },
      ],
      catatan: "uji harga terima",
      idempotencyKey: `${tag}-manual-1`,
      userId: kantor,
    });
    expect(res).toMatchObject({ ok: true, ulang: false });
    if (!res.ok) return;
    const loss = await prisma.stockLoss.findUniqueOrThrow({ where: { id: res.id }, include: { lines: { orderBy: { productName: "asc" } } } });
    expect(loss.valueBasis).toBe("HARGA_TERIMA");
    expect(Number(loss.totalAmount)).toBe(165_000);
    expect(loss.lines.map((l) => [l.itemId, Number(l.unitValue)])).toEqual(
      expect.arrayContaining([
        [kaos, 75_000],
        [celana, 90_000],
      ]),
    );
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: res.id, action: "STOCK_LOSS_OPENED" } });
    expect((jejak.metadata as Record<string, unknown>).hargaCadangan).toEqual([{ itemId: celana, variantSku: "" }]);
    expect((jejak.metadata as Record<string, unknown>).dasarNilai).toBe("HARGA_TERIMA");

    const rincian = await rincianHilangKantor(res.id);
    expect(rincian?.dasarNilai).toBe("HARGA_TERIMA");
    expect(rincian?.baris.map((b) => [b.nilaiSatuan, b.hargaCadangan]).sort()).toEqual(
      [
        [75_000, false],
        [90_000, true],
      ].sort(),
    );
  });
});
