import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Keputusan pemilik 2026-10-06 (sementara): pesanan yang DITOLAK KANTOR
 * membuka lagi permintaan SPG / rekomendasi yang tertaut — sesudah commit,
 * best-effort, idempoten. Terhadap basis data uji; teardown lewat id yang diseed.
 */
const { mockKabar } = vi.hoisted(() => ({ mockKabar: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: mockKabar,
}));

import { rejectFieldSalesOrder } from "./writer";
import { bukaSumberPesananDitolak, JEJAK_SUMBER_PESANAN_DITOLAK } from "./isi-keranjang-tolak";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `IST-${Math.random().toString(36).slice(2, 10)}`;

d("pesanan ditolak kantor membuka lagi permintaan SPG / rekomendasi (basis data)", () => {
  let uomId = "";
  let sales = "";
  let kantor = "";
  let spg = "";
  let kaos = "";
  let toko = "";
  let requestId = "";
  let rekomId = "";
  let nomorKe = 0;
  const nomor = () => `${tag}-PO-${nomorKe++}`;
  const pesananDibuat: string[] = [];

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const pengguna = async (n: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}` } })).id;
    sales = await pengguna("sales");
    kantor = await pengguna("kantor");
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
      })
    ).id;
    toko = (
      await prisma.store.create({
        data: { code: `${tag}-A`, name: `Toko ${tag}`, address: "x", termsType: "PUTUS", isActive: true, salesmanId: sales },
      })
    ).id;
    spg = (
      await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `spg ${tag}`, assignedStoreId: toko } })
    ).id;
  });

  beforeEach(() => {
    requestId = "";
    rekomId = "";
    pesananDibuat.length = 0;
    mockKabar.mockReset();
  });

  afterEach(async () => {
    const entitas = [...pesananDibuat, requestId, rekomId].filter(Boolean);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
    if (requestId) await prisma.stockRequest.delete({ where: { id: seededId(requestId) } });
    if (rekomId) await prisma.storeRecommendation.delete({ where: { id: seededId(rekomId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(pesananDibuat) } } });
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    if (spg) await prisma.user.delete({ where: { id: seededId(spg) } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, kantor].filter(Boolean)) } } });
  });

  const pesanan = async (extra: { status?: "PENDING_APPROVAL" | "REJECTED"; cancelledById?: string; replacesOrderId?: string } = {}) => {
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: nomor(),
        storeId: toko,
        salesmanId: sales,
        status: extra.status ?? "PENDING_APPROVAL",
        subtotal: 210_000,
        total: 210_000,
        cancelledById: extra.cancelledById ?? null,
        cancelledAt: extra.cancelledById ? new Date() : null,
        rejectedAt: extra.status === "REJECTED" ? new Date() : null,
        replacesOrderId: extra.replacesOrderId ?? null,
      },
    });
    pesananDibuat.push(o.id);
    return o;
  };
  const permintaanDiproses = async (orderId: string, status: "DIPROSES" | "SELESAI" = "DIPROSES") => {
    requestId = (
      await prisma.stockRequest.create({
        data: {
          storeId: toko,
          requestedById: spg,
          status,
          fieldSalesOrderId: orderId,
          handledById: sales,
          handledAt: new Date(),
          handleNote: "Dibuatkan pesanan",
          lines: { create: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 6, alasan: "SERING_DIKIRIM" }] },
        },
      })
    ).id;
  };
  const rekomendasiSelesai = async (orderId: string) => {
    rekomId = (
      await prisma.storeRecommendation.create({
        data: {
          storeId: toko,
          salesmanId: sales,
          status: "SELESAI",
          fieldSalesOrderId: orderId,
          idempotencyKey: `${tag}-rk-${nomorKe++}`,
          lines: { create: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 12 }] },
        },
      })
    ).id;
  };

  it("kantor menolak: permintaan DIPROSES → BARU tanpa tautan, rekomendasi SELESAI → DITERIMA, jejak + kabar ke SPG", async () => {
    const o = await pesanan();
    await permintaanDiproses(o.id);
    await rekomendasiSelesai(o.id);

    await rejectFieldSalesOrder({ orderId: o.id, rejectedById: kantor, reason: "Stok kosong" });

    const r = await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(r.status).toBe("BARU");
    expect(r.fieldSalesOrderId).toBeNull();
    expect(r.handledById).toBeNull();
    expect(r.handleNote).toBeNull();
    const k = await prisma.storeRecommendation.findUniqueOrThrow({ where: { id: rekomId } });
    expect(k.status).toBe("DITERIMA");
    expect(k.fieldSalesOrderId).toBeNull();

    const jejakPermintaan = await prisma.auditLog.findMany({ where: { entityId: requestId } });
    expect(jejakPermintaan.map((j) => j.action)).toEqual([JEJAK_SUMBER_PESANAN_DITOLAK.PERMINTAAN_PESANAN_DITOLAK]);
    expect(jejakPermintaan[0].userId).toBe(kantor);
    expect(jejakPermintaan[0].reason).toBe("Stok kosong");
    const jejakRekom = await prisma.auditLog.findMany({ where: { entityId: rekomId } });
    expect(jejakRekom.map((j) => j.action)).toEqual([JEJAK_SUMBER_PESANAN_DITOLAK.REKOMENDASI_PESANAN_DITOLAK]);

    const penerima = mockKabar.mock.calls.map((c) => c[0]);
    expect(penerima).toEqual([spg, spg]);
    expect(mockKabar.mock.calls[0][1].isi).toContain(o.orderNo);
  });

  it("idempoten: dipanggil ulang tidak membuka atau menjejak dua kali", async () => {
    const o = await pesanan();
    await permintaanDiproses(o.id);
    await rejectFieldSalesOrder({ orderId: o.id, rejectedById: kantor, reason: "Stok kosong" });

    expect(await bukaSumberPesananDitolak(o.id)).toEqual({ dibuka: 0 });
    expect(await prisma.auditLog.count({ where: { entityId: requestId } })).toBe(1);
  });

  it("permintaan yang sudah ditandai SELESAI dengan tangan tidak dibuka", async () => {
    const o = await pesanan();
    await permintaanDiproses(o.id, "SELESAI");

    await rejectFieldSalesOrder({ orderId: o.id, rejectedById: kantor, reason: "x" });

    const r = await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(r.status).toBe("SELESAI");
    expect(r.fieldSalesOrderId).toBe(o.id);
  });

  it("pesanan yang masih menunggu atau DIBATALKAN salesman tidak disentuh di sini", async () => {
    const menunggu = await pesanan();
    await permintaanDiproses(menunggu.id);
    expect(await bukaSumberPesananDitolak(menunggu.id)).toEqual({ dibuka: 0 });
    await prisma.stockRequest.delete({ where: { id: requestId } });

    const batal = await pesanan({ status: "REJECTED", cancelledById: sales });
    await permintaanDiproses(batal.id);
    expect(await bukaSumberPesananDitolak(batal.id)).toEqual({ dibuka: 0 });
    expect((await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("DIPROSES");
  });

  it("tautan yang tertinggal di pesanan lama dalam rantai ubah pesanan ikut dibuka", async () => {
    const lama = await pesanan({ status: "REJECTED", cancelledById: sales });
    const baru = await pesanan({ replacesOrderId: lama.id });
    await permintaanDiproses(lama.id);

    await rejectFieldSalesOrder({ orderId: baru.id, rejectedById: kantor, reason: "x" });

    expect((await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("BARU");
  });

  it("balapan: dua pemanggilan serentak membuka sekali, satu jejak", async () => {
    const o = await pesanan({ status: "REJECTED" });
    await permintaanDiproses(o.id);

    const hasil = await Promise.all([bukaSumberPesananDitolak(o.id), bukaSumberPesananDitolak(o.id)]);

    expect(hasil.reduce((s, h) => s + h.dibuka, 0)).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: requestId } })).toBe(1);
    expect(mockKabar).toHaveBeenCalledTimes(1);
  });
});
