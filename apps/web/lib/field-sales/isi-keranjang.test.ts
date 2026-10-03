import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { muatIsiKeranjang, tautkanSumberPesanan } from "./isi-keranjang";

/**
 * Keranjang terisi dari permintaan SPG / rekomendasi, terhadap basis data
 * sungguhan: hanya pemegang toko yang boleh memakai permintaannya, hanya
 * pengirim rekomendasi yang DITERIMA, dan penautan pesanan terjadi sekali
 * walau dua kiriman berbalapan. Penghapusan lewat `seededId()`.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("isi keranjang dari permintaan / rekomendasi (basis data)", () => {
  const tag = `ISI-${Math.random().toString(36).slice(2, 8)}`;
  const pemegang = `${tag}-sales`;
  let storeId = "";
  let uomId = "";
  let itemId = "";
  let requestId = "";
  let rekomId = "";

  beforeEach(async () => {
    storeId = "";
    uomId = "";
    itemId = "";
    requestId = "";
    rekomId = "";
    storeId = (
      await prisma.store.create({ data: { code: tag, name: `${tag} Toko`, address: "uji", termsType: "KONSI", isActive: true, salesmanId: pemegang } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (await prisma.item.create({ data: { sku: tag, nameId: "Kaos Uji", nameEn: "Test", type: "FINISHED_GOOD", uomId, isActive: true } })).id;
    requestId = (
      await prisma.stockRequest.create({
        data: {
          storeId,
          requestedById: `${tag}-spg`,
          lines: { create: [{ itemId, variantSku: "M", productName: "Kaos Uji M", qty: 6, alasan: "LAKU_DI_TOKO_LAIN" }] },
        },
      })
    ).id;
    rekomId = (
      await prisma.storeRecommendation.create({
        data: {
          storeId,
          salesmanId: pemegang,
          status: "DITERIMA",
          idempotencyKey: `${tag}-rk`,
          lines: { create: [{ itemId, variantSku: "", productName: "Kaos Uji", qty: 12 }] },
        },
      })
    ).id;
  });

  afterEach(async () => {
    if (requestId) await prisma.stockRequest.delete({ where: { id: requestId } });
    if (rekomId) await prisma.storeRecommendation.delete({ where: { id: rekomId } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [requestId, rekomId].filter(Boolean).map(seededId) } } });
    if (itemId) await prisma.item.delete({ where: { id: itemId } });
    if (uomId) await prisma.uOM.delete({ where: { id: uomId } });
    if (storeId) await prisma.store.delete({ where: { id: storeId } });
  });

  it("the holding salesman gets the request lines; anyone else gets nothing", async () => {
    expect(await muatIsiKeranjang({ jenis: "permintaan", id: requestId }, { userId: pemegang, storeId })).toEqual([
      { itemId, variantSku: "M", qty: 6 },
    ]);
    expect(await muatIsiKeranjang({ jenis: "permintaan", id: requestId }, { userId: `${tag}-lain`, storeId })).toBeNull();
    expect(await muatIsiKeranjang({ jenis: "permintaan", id: requestId }, { userId: pemegang, storeId: "toko-lain" })).toBeNull();
  });

  it("a request that already has an order no longer fills the cart", async () => {
    await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "DIPROSES", fieldSalesOrderId: "o-sudah" } });
    expect(await muatIsiKeranjang({ jenis: "permintaan", id: requestId }, { userId: pemegang, storeId })).toBeNull();
  });

  it("a recommendation fills the cart only once the store accepted it", async () => {
    expect(await muatIsiKeranjang({ jenis: "rekomendasi", id: rekomId }, { userId: pemegang, storeId })).toEqual([
      { itemId, variantSku: "", qty: 12 },
    ]);
    await prisma.storeRecommendation.update({ where: { id: rekomId }, data: { status: "TERKIRIM" } });
    expect(await muatIsiKeranjang({ jenis: "rekomendasi", id: rekomId }, { userId: pemegang, storeId })).toBeNull();
  });

  it("links the order once, even when two submissions race", async () => {
    for (let putaran = 0; putaran < 3; putaran++) {
      await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "BARU", fieldSalesOrderId: null } });
      await Promise.all([
        tautkanSumberPesanan({ jenis: "permintaan", id: requestId }, { orderId: "o-1", orderNo: "PUTUS/1", userId: pemegang, storeId }),
        new Promise((r) => setTimeout(r, putaran * 3)).then(() =>
          tautkanSumberPesanan({ jenis: "permintaan", id: requestId }, { orderId: "o-2", orderNo: "PUTUS/2", userId: pemegang, storeId }),
        ),
      ]);
      const r = await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(r.status).toBe("DIPROSES");
      expect(["o-1", "o-2"]).toContain(r.fieldSalesOrderId);
      expect(r.handleNote).toBe(r.fieldSalesOrderId === "o-1" ? "Dibuatkan pesanan PUTUS/1" : "Dibuatkan pesanan PUTUS/2");
    }
    // Satu jejak per penautan yang berhasil — yang kalah balapan tidak menulis apa-apa.
    expect(await prisma.auditLog.count({ where: { entityId: seededId(requestId), action: "STOCK_REQUEST_STATUS" } })).toBe(3);
  });

  it("a non-holder cannot link a request; an accepted recommendation becomes SELESAI", async () => {
    await tautkanSumberPesanan({ jenis: "permintaan", id: requestId }, { orderId: "o-x", orderNo: "X", userId: `${tag}-lain`, storeId });
    expect((await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } })).fieldSalesOrderId).toBeNull();

    await tautkanSumberPesanan({ jenis: "rekomendasi", id: rekomId }, { orderId: "o-r", orderNo: "PUTUS/3", userId: pemegang, storeId });
    const r = await prisma.storeRecommendation.findUniqueOrThrow({ where: { id: rekomId } });
    expect(r.status).toBe("SELESAI");
    expect(r.fieldSalesOrderId).toBe("o-r");
    const jejak = await prisma.auditLog.findMany({ where: { entityId: seededId(rekomId) }, select: { action: true } });
    expect(jejak.map((j) => j.action)).toEqual(["STORE_RECOMMENDATION_ORDERED"]);
  });
});
