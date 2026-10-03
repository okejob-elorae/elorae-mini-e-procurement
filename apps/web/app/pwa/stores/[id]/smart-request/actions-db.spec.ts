import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/*
 * Basis data sungguhan, dari aksi sampai penulis pesanan: hanya sesi, rasio
 * pack, dan revalidasi yang ditirukan. Dipasak untuk toko KONSINYASI — draf yang
 * keluar dari server tidak membawa harga apa pun (JSON terserialisasinya), dan
 * mengirimnya mencatat pesanan konsinyasi lewat `createFieldSalesOrder` biasa:
 * harga 0, tanpa minimum, menunggu persetujuan kantor, dan kiriman ulang dengan
 * kunci draf yang sama tidak membuat pesanan kedua.
 *
 * Teardown: semua lewat id seed tes ini; baris AdminNotification yang ditulis
 * penulis pesanan dihapus berdasarkan `metadata.orderId` pesanan tes (dicocokkan
 * di JS).
 */
const h = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: h.userId, permissions: ["pwa:access"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/settings/pack-ratio", () => ({
  getPackRatio: vi.fn(async () => [
    { size: "S", qty: 1 },
    { size: "M", qty: 2 },
  ]),
}));

import { prisma, seededId, seededIds } from "@elorae/db";
import { bangunRencanaKirimAction, kirimRencanaKirimAction } from "./actions";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("rencana kirim — toko konsinyasi (test bed only)", () => {
  const tag = `TEST-RKA-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let categoryId = "";
  let storeId = "";
  let itemId = "";
  let visitId = "";
  let mulai = new Date();

  beforeEach(async () => {
    uomId = categoryId = storeId = itemId = visitId = "";
    mulai = new Date();
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" }, select: { id: true, assignedStoreId: true } });
    // Salesman keliling, bukan SPG — kalau data dev berubah, tes ini tidak bermakna.
    expect(user?.assignedStoreId ?? null).toBeNull();
    h.userId = user!.id;

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    categoryId = (await prisma.itemCategory.create({ data: { code: `C-${tag}`, name: "Kategori uji", isActive: true } })).id;
    itemId = (
      await prisma.item.create({
        data: {
          sku: `${tag}-A`,
          nameId: "Kaos Uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          categoryId,
          // Harga jual SENGAJA ada: draf konsinyasi tetap tidak boleh membawanya.
          sellingPrice: 87_654,
          variants: [
            { sku: `${tag}-A-S`, size: "S", color: "Hitam" },
            { sku: `${tag}-A-M`, size: "M", color: "Hitam" },
          ],
        },
      })
    ).id;
    await prisma.inventoryValue.createMany({
      data: [
        { itemId, variantSku: `${tag}-A-S`, qtyOnHand: 20, reservedQty: 0 },
        { itemId, variantSku: `${tag}-A-M`, qtyOnHand: 20, reservedQty: 0 },
      ],
    });
    storeId = (
      await prisma.store.create({
        data: { code: `K-${tag}`, name: "Toko konsi uji", address: "-", termsType: "KONSI", marginPercent: 25, isActive: true, salesmanId: h.userId },
      })
    ).id;
    // Kunjungan yang sudah selesai: penulis menerima kunjungan milik salesman di toko ini
    // tanpa memeriksa apakah masih terbuka (antrean HP), dan kunjungan aktif sungguhan
    // salesman ini di data dev tidak tersentuh.
    visitId = (
      await prisma.storeVisit.create({
        data: { storeId, userId: h.userId, checkinLat: 0, checkinLng: 0, checkoutAt: new Date() },
      })
    ).id;
  });

  afterEach(async () => {
    const pesanan = await prisma.fieldSalesOrder.findMany({ where: { storeId: seededId(storeId) }, select: { id: true } });
    const orderIds = pesanan.map((p) => p.id);
    // Penulis pesanan menulis AdminNotification; hapus hanya milik pesanan tes ini.
    const kabar = await prisma.adminNotification.findMany({
      where: { category: { in: ["PENDING_ORDER_APPROVAL", "STOCK_OVERSELL_RISK"] }, createdAt: { gte: mulai } },
      select: { id: true, metadata: true },
    });
    const kabarTes = kabar
      .filter((k) => orderIds.includes(String((k.metadata as { orderId?: unknown } | null)?.orderId ?? "")))
      .map((k) => k.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(kabarTes) } } });
    const baris = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: { in: seededIds(orderIds) } }, select: { id: true } });
    await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(baris.map((b) => b.id)) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    if (visitId) await prisma.storeVisit.delete({ where: { id: seededId(visitId) } });
    if (storeId) await prisma.store.delete({ where: { id: seededId(storeId) } });
    if (itemId) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.delete({ where: { id: seededId(itemId) } });
    }
    if (categoryId) await prisma.itemCategory.delete({ where: { id: seededId(categoryId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  const kriteria = () => ({
    storeId,
    kategoriIds: [categoryId],
    sumber: ["BELUM_DIKIRIM"],
    jumlah: { mode: "PCS", pcs: 6 },
    hariBaru: 90,
    lewatiSisaMin: 6,
    maksArtikel: 10,
    // HP mengirim anggaran pun, konsinyasi tidak punya anggaran.
    anggaran: 1,
  });

  it("builds a consignment draft whose serialized JSON has no price, total or rupiah", async () => {
    const r = await bangunRencanaKirimAction(kriteria());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.konsi).toBe(true);
    expect(r.artikel).toHaveLength(1);
    expect(r.artikel[0]).toMatchObject({ itemId, nama: "Kaos Uji", alasan: [{ jenis: "BELUM_DIKIRIM" }] });
    expect(r.artikel[0].baris.map((b) => [b.label, b.qty])).toEqual([
      ["Hitam · S", 2],
      ["Hitam · M", 4],
    ]);

    const json = JSON.stringify(r);
    expect(json).not.toMatch(/harga|price|total|nilai|anggaran|budget|rupiah/i);
    expect(json).not.toContain("Rp");
    expect(json).not.toContain("87654");
    // 87654 / (1 − 25%) — harga konsinyasi naik — juga tidak ada.
    expect(json).not.toContain("116872");
  });

  it("sends the reviewed draft through the normal writer: konsi, price 0, pending approval, replay-safe", async () => {
    const r = await bangunRencanaKirimAction(kriteria());
    if (!r.ok) throw new Error(`build gagal: ${r.code}`);
    const lines = r.artikel.flatMap((a) =>
      // Salesman mengubah draf: M dikurangi jadi 3.
      a.baris.map((b) => ({ itemId: a.itemId, variantSku: b.variantSku, productName: b.namaProduk, qty: b.label?.endsWith("M") ? 3 : b.qty })),
    );
    const kunci = `${tag}-kunci`;
    const kirim = await kirimRencanaKirimAction({ storeId, visitId, idempotencyKey: kunci, lines });
    expect(kirim.ok).toBe(true);
    if (!kirim.ok) return;

    const order = await prisma.fieldSalesOrder.findFirstOrThrow({
      where: { storeId: seededId(storeId) },
      include: { lines: { orderBy: { variantSku: "asc" } } },
    });
    expect(order).toMatchObject({ orderType: "KONSI", status: "PENDING_APPROVAL", salesmanId: h.userId, visitId, idempotencyKey: kunci });
    expect(Number(order.total)).toBe(0);
    expect(order.lines.map((l) => [l.variantSku, l.qty, Number(l.unitPrice), l.productName])).toEqual([
      [`${tag}-A-M`, 3, 0, "Kaos Uji — Hitam · M"],
      [`${tag}-A-S`, 2, 0, "Kaos Uji — Hitam · S"],
    ]);

    // Jaringan putus sesudah server mencatat: kiriman ulang draf yang sama → pesanan yang sama.
    const ulang = await kirimRencanaKirimAction({ storeId, visitId, idempotencyKey: kunci, lines });
    expect(ulang).toEqual(kirim);
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(1);

    // Sesudah dipesan, barangnya "pernah dikirim" — rencana berikutnya tidak menawarkannya lagi.
    const lagi = await bangunRencanaKirimAction(kriteria());
    expect(lagi.ok && lagi.artikel).toEqual([]);
  });

  it("refuses to build or send for an inactive store", async () => {
    await prisma.store.update({ where: { id: seededId(storeId) }, data: { isActive: false } });
    expect(await bangunRencanaKirimAction(kriteria())).toEqual({ ok: false, code: "TOKO_TIDAK_AKTIF" });
    expect(
      await kirimRencanaKirimAction({
        storeId,
        visitId,
        idempotencyKey: `${tag}-mati`,
        lines: [{ itemId, variantSku: `${tag}-A-S`, productName: "Kaos Uji", qty: 1 }],
      }),
    ).toEqual({ ok: false, code: "TOKO_TIDAK_AKTIF" });
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(0);
  });
});
