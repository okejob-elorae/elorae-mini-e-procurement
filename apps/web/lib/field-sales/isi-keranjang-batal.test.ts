import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Permintaan SPG dan rekomendasi toko yang sudah dibuatkan pesanan, lalu
 * pesanannya dibatalkan atau diganti salesman — terhadap basis data uji,
 * dengan penulis pesanan sungguhan (batal + ganti) supaya keadaan pesanannya
 * persis seperti di lapangan.
 *
 * Aturan pemilik (minimum, jarak jauh, kredit) dan catatan kantor DITIRUKAN:
 * tes tidak mengubah pengaturan bersama. Kabar ke HP ditirukan supaya bisa
 * diperiksa (yang asli tidak pernah mengirim dari proses tes). Teardown hanya
 * lewat id yang diseed (`seededId`/`seededIds`).
 */
const { mockMinimum, mockAturanJarakJauh, mockKredit, mockKabar } = vi.hoisted(() => ({
  mockMinimum: vi.fn(),
  mockAturanJarakJauh: vi.fn(),
  mockKredit: vi.fn(),
  mockKabar: vi.fn(),
}));
vi.mock("./minimum-toko", () => ({ muatMinimumToko: mockMinimum }));
vi.mock("./jarak-jauh-toko", () => ({ muatAturanJarakJauh: mockAturanJarakJauh }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: mockKredit }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: mockKabar,
}));

import { ATURAN_JARAK_JAUH_BAWAAN } from "./jarak-jauh";
import { bacaAturanMinimum } from "./minimum-pesanan";
import { cancelFieldSalesOrderBySalesman, createFieldSalesOrder } from "./writer";
import { muatIsiKeranjang, rapikanSumberPesananBatal, tautkanSumberPesanan, JEJAK_SUMBER_PESANAN } from "./isi-keranjang";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `ISB-${Math.random().toString(36).slice(2, 10)}`;

d("permintaan SPG / rekomendasi saat pesanannya dibatalkan atau diganti (basis data)", () => {
  let uomId = "";
  let sales = "";
  let salesLain = "";
  let spg = "";
  let kaos = "";
  let toko = "";
  let tokoLain = "";
  let visitId = "";
  let visitLainId = "";
  let requestId = "";
  let rekomId = "";
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const pengguna = async (n: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}` } })).id;
    sales = await pengguna("sales");
    salesLain = await pengguna("sales2");
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
      })
    ).id;
    const buatToko = async (kode: string, pemegang: string) =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "x", termsType: "PUTUS", isActive: true, salesmanId: pemegang },
        })
      ).id;
    toko = await buatToko("A", sales);
    tokoLain = await buatToko("B", salesLain);
    spg = (
      await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `spg ${tag}`, assignedStoreId: toko } })
    ).id;
  });

  beforeEach(async () => {
    visitId = "";
    visitLainId = "";
    requestId = "";
    rekomId = "";
    mockMinimum.mockReset().mockResolvedValue({ min: 1, jenis: "PERTAMA", aturan: bacaAturanMinimum(null, null) });
    mockAturanJarakJauh.mockReset().mockResolvedValue({ ...ATURAN_JARAK_JAUH_BAWAAN });
    mockKredit.mockReset().mockResolvedValue(null);
    mockKabar.mockReset();
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.inventoryValue.create({ data: { itemId: kaos, variantSku: "", qtyOnHand: 500, reservedQty: 0, avgCost: 1000, totalValue: 500000 } });
    visitId = (await prisma.storeVisit.create({ data: { storeId: toko, userId: sales, checkinLat: 0, checkinLng: 0 } })).id;
    visitLainId = (await prisma.storeVisit.create({ data: { storeId: tokoLain, userId: salesLain, checkinLat: 0, checkinLng: 0 } })).id;
    requestId = (
      await prisma.stockRequest.create({
        data: {
          storeId: toko,
          requestedById: spg,
          lines: { create: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 6, alasan: "SERING_DIKIRIM" }] },
        },
      })
    ).id;
    rekomId = (
      await prisma.storeRecommendation.create({
        data: {
          storeId: toko,
          salesmanId: sales,
          status: "DITERIMA",
          idempotencyKey: `${tag}-rk-${kunciKe++}`,
          lines: { create: [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty: 12 }] },
        },
      })
    ).id;
  });

  afterEach(async () => {
    const tokoIds = seededIds([toko, tokoLain].filter(Boolean));
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
    const entitas = [...orderIds, requestId, rekomId].filter(Boolean);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
    const lineIds = (await prisma.fieldSalesOrderLine.findMany({ where: { orderId: { in: seededIds(orderIds) } }, select: { id: true } })).map((l) => l.id);
    await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(lineIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    if (requestId) await prisma.stockRequest.delete({ where: { id: requestId } });
    if (rekomId) await prisma.storeRecommendation.delete({ where: { id: rekomId } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds([visitId, visitLainId].filter(Boolean)) } } });
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    // Urutan: SPG (menunjuk toko) → toko (menunjuk salesman) → salesman.
    if (spg) await prisma.user.delete({ where: { id: spg } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([toko, tokoLain].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain].filter(Boolean)) } } });
  });

  const baris = (qty: number) => [{ itemId: kaos, variantSku: "", productName: "Kaos Uji", qty, unitPrice: 1 }];
  const pesan = (extra: Partial<Parameters<typeof createFieldSalesOrder>[0]> = {}) =>
    createFieldSalesOrder({ storeId: toko, salesmanId: sales, visitId, lines: baris(6), idempotencyKey: kunci(), ...extra });
  const tautkan = (jenis: "permintaan" | "rekomendasi", o: { orderId: string; orderNo: string }) =>
    tautkanSumberPesanan({ jenis, id: jenis === "permintaan" ? requestId : rekomId }, { ...o, userId: sales, storeId: toko });
  const batal = (orderId: string, reason = "Toko batal pesan") => cancelFieldSalesOrderBySalesman({ orderId, salesmanId: sales, reason });
  const permintaan = () => prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } });
  const rekomendasi = () => prisma.storeRecommendation.findUniqueOrThrow({ where: { id: rekomId } });
  const jejak = (entityId: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityId: seededId(entityId), action }, orderBy: { createdAt: "asc" } });

  describe("pesanan dibatalkan salesman", () => {
    it("the request goes back to BARU with no order, the SPG is told, and the holder can fill the cart again", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      expect((await permintaan()).status).toBe("DIPROSES");
      mockKabar.mockReset();

      await batal(a.orderId);
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 1, dipindah: 0 });

      const r = await permintaan();
      expect(r.status).toBe("BARU");
      expect(r.fieldSalesOrderId).toBeNull();
      expect(r.handledById).toBeNull();
      expect(r.handledAt).toBeNull();
      expect(r.handleNote).toBeNull();

      const j = await jejak(requestId, JEJAK_SUMBER_PESANAN.PERMINTAAN_PESANAN_BATAL);
      expect(j).toHaveLength(1);
      expect(j[0].userId).toBe(sales);
      expect(j[0].reason).toBe("Toko batal pesan");
      expect(j[0].changes).toMatchObject({
        before: { status: "DIPROSES", fieldSalesOrderId: a.orderId, orderNo: a.orderNo, handledById: sales, handleNote: `Dibuatkan pesanan ${a.orderNo}` },
        after: { status: "BARU", fieldSalesOrderId: null },
      });

      expect(mockKabar).toHaveBeenCalledTimes(1);
      expect(mockKabar).toHaveBeenCalledWith(
        spg,
        expect.objectContaining({ jenis: "PERMINTAAN_STOK_DIPROSES", data: { requestId, status: "BARU" }, isi: expect.stringContaining(a.orderNo) }),
      );

      // Permintaan yang dibuka lagi mengisi keranjang pemegang toko lagi.
      expect(await muatIsiKeranjang({ jenis: "permintaan", id: requestId }, { userId: sales, storeId: toko })).toEqual([
        { itemId: kaos, variantSku: "", qty: 6 },
      ]);
    });

    it("an accepted recommendation that became the order goes back to DITERIMA, and the store's SPG is told", async () => {
      const a = await pesan();
      await tautkan("rekomendasi", a);
      expect((await rekomendasi()).status).toBe("SELESAI");

      await batal(a.orderId, "Salah barang");
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 1, dipindah: 0 });

      const r = await rekomendasi();
      expect(r.status).toBe("DITERIMA");
      expect(r.fieldSalesOrderId).toBeNull();
      const j = await jejak(rekomId, JEJAK_SUMBER_PESANAN.REKOMENDASI_PESANAN_BATAL);
      expect(j).toHaveLength(1);
      expect(j[0].reason).toBe("Salah barang");
      expect(j[0].changes).toMatchObject({
        before: { status: "SELESAI", fieldSalesOrderId: a.orderId, orderNo: a.orderNo },
        after: { status: "DITERIMA", fieldSalesOrderId: null },
      });
      expect(mockKabar).toHaveBeenCalledWith(
        spg,
        expect.objectContaining({ jenis: "REKOMENDASI_MASUK", data: { recommendationId: rekomId }, isi: expect.stringContaining(a.orderNo) }),
      );
      expect(await muatIsiKeranjang({ jenis: "rekomendasi", id: rekomId }, { userId: sales, storeId: toko })).toEqual([
        { itemId: kaos, variantSku: "", qty: 12 },
      ]);
    });

    it("a request already marked SELESAI or DITOLAK by hand keeps its decision", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "SELESAI" } });
      await batal(a.orderId);
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 0, dipindah: 0 });
      const r = await permintaan();
      expect(r.status).toBe("SELESAI");
      expect(r.fieldSalesOrderId).toBe(a.orderId);
      expect(mockKabar).not.toHaveBeenCalledWith(spg, expect.objectContaining({ data: { requestId, status: "BARU" } }));
    });

    it("does nothing for an order that is still waiting, one the office rejected, or an unknown id", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 0, dipindah: 0 });
      // Ditolak kantor (bukan dibatalkan salesman): di luar aturan ini.
      await prisma.fieldSalesOrder.update({ where: { id: a.orderId }, data: { status: "REJECTED", rejectedById: salesLain, rejectedAt: new Date() } });
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 0, dipindah: 0 });
      expect(await rapikanSumberPesananBatal(`${tag}-tidak-ada`)).toEqual({ dibuka: 0, dipindah: 0 });
      const r = await permintaan();
      expect(r.status).toBe("DIPROSES");
      expect(r.fieldSalesOrderId).toBe(a.orderId);
    });

    it("running it again, or twice at once, reopens once: one audit row per document and one kabar", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      await tautkan("rekomendasi", a);
      // Pesanan lain yang masih hidup — tidak boleh ikut tersentuh.
      const b = await pesan();
      mockKabar.mockReset();
      await batal(a.orderId);

      const hasil = await Promise.all([rapikanSumberPesananBatal(a.orderId), rapikanSumberPesananBatal(a.orderId)]);
      expect(hasil.reduce((n, h) => n + h.dibuka, 0)).toBe(2);
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 0, dipindah: 0 });

      expect(await jejak(requestId, JEJAK_SUMBER_PESANAN.PERMINTAAN_PESANAN_BATAL)).toHaveLength(1);
      expect(await jejak(rekomId, JEJAK_SUMBER_PESANAN.REKOMENDASI_PESANAN_BATAL)).toHaveLength(1);
      expect(mockKabar).toHaveBeenCalledTimes(2);
      expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe("PENDING_APPROVAL");
    });

    it("linking and cancelling at the same time always end with the request open and unlinked", async () => {
      // Jeda [penautan, pembatalan] ms: berbarengan, penautan lebih dulu, dan penautan yang datang sesudah pembatalan selesai.
      const jadwal: Array<[number, number]> = [[0, 0], [0, 8], [8, 0], [60, 0]];
      for (const [jedaTaut, jedaBatal] of jadwal) {
        await prisma.stockRequest.update({
          where: { id: requestId },
          data: { status: "BARU", fieldSalesOrderId: null, handledById: null, handledAt: null, handleNote: null },
        });
        const a = await pesan();
        await Promise.all([
          new Promise((r) => setTimeout(r, jedaTaut)).then(() => tautkan("permintaan", a)),
          new Promise((r) => setTimeout(r, jedaBatal)).then(async () => {
            await batal(a.orderId);
            await rapikanSumberPesananBatal(a.orderId);
          }),
        ]);
        const r = await permintaan();
        expect(r.status).toBe("BARU");
        expect(r.fieldSalesOrderId).toBeNull();
      }
    });
  });

  describe("pesanan diganti salesman (ubah pesanan)", () => {
    it("moves both links to the replacement: statuses unchanged, the automatic note names the new number, no kabar", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      await tautkan("rekomendasi", a);
      mockKabar.mockReset();

      const b = await pesan({ replacesOrderId: a.orderId, lines: baris(8) });
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 0, dipindah: 2 });

      const r = await permintaan();
      expect(r.status).toBe("DIPROSES");
      expect(r.fieldSalesOrderId).toBe(b.orderId);
      expect(r.handleNote).toBe(`Dibuatkan pesanan ${b.orderNo}`);
      const k = await rekomendasi();
      expect(k.status).toBe("SELESAI");
      expect(k.fieldSalesOrderId).toBe(b.orderId);

      const jp = await jejak(requestId, JEJAK_SUMBER_PESANAN.PERMINTAAN_PESANAN_DIGANTI);
      expect(jp).toHaveLength(1);
      expect(jp[0].changes).toMatchObject({
        before: { fieldSalesOrderId: a.orderId, orderNo: a.orderNo },
        after: { fieldSalesOrderId: b.orderId, orderNo: b.orderNo },
      });
      expect(await jejak(rekomId, JEJAK_SUMBER_PESANAN.REKOMENDASI_PESANAN_DIGANTI)).toHaveLength(1);
      expect(mockKabar).not.toHaveBeenCalled();

      // Ulang: tidak ada yang tersisa di pesanan lama.
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 0, dipindah: 0 });
      // Permintaan yang sudah punya pesanan (pengganti) tetap tidak mengisi keranjang lagi.
      expect(await muatIsiKeranjang({ jenis: "permintaan", id: requestId }, { userId: sales, storeId: toko })).toBeNull();
    });

    it("a note the salesman wrote himself is kept when the link moves", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      await prisma.stockRequest.update({ where: { id: requestId }, data: { handleNote: "Kirim minggu depan" } });
      const b = await pesan({ replacesOrderId: a.orderId });
      await rapikanSumberPesananBatal(a.orderId);
      const r = await permintaan();
      expect(r.fieldSalesOrderId).toBe(b.orderId);
      expect(r.handleNote).toBe("Kirim minggu depan");
    });

    it("follows a chain of edits to the order that is still alive", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      const b = await pesan({ replacesOrderId: a.orderId });
      // Penautan ke B tidak sempat jalan (mis. proses mati); B lalu diubah lagi menjadi C.
      const c = await pesan({ replacesOrderId: b.orderId });
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 0, dipindah: 1 });
      const r = await permintaan();
      expect(r.fieldSalesOrderId).toBe(c.orderId);
      expect(r.handleNote).toBe(`Dibuatkan pesanan ${c.orderNo}`);
    });

    it("an edit whose replacement is then cancelled reopens the request", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      const b = await pesan({ replacesOrderId: a.orderId });
      await batal(b.orderId, "Toko tidak jadi");
      mockKabar.mockReset();
      expect(await rapikanSumberPesananBatal(a.orderId)).toEqual({ dibuka: 1, dipindah: 0 });
      const r = await permintaan();
      expect(r.status).toBe("BARU");
      expect(r.fieldSalesOrderId).toBeNull();
      const j = await jejak(requestId, JEJAK_SUMBER_PESANAN.PERMINTAAN_PESANAN_BATAL);
      expect(j).toHaveLength(1);
      // Alasan yang dicatat: alasan pembatalan pesanan terakhir, bukan "Diganti dengan …".
      expect(j[0].reason).toBe("Toko tidak jadi");
      expect(mockKabar).toHaveBeenCalledWith(spg, expect.objectContaining({ isi: expect.stringContaining(b.orderNo) }));
      expect(await rapikanSumberPesananBatal(b.orderId)).toEqual({ dibuka: 0, dipindah: 0 });
    });

    it("a link left on an earlier order (the move never ran) is repaired when the replacement is cancelled", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      await tautkan("rekomendasi", a);
      // Proses mati sesudah B tercatat, sebelum tautannya dipindah: keduanya masih menunjuk A.
      const b = await pesan({ replacesOrderId: a.orderId });
      await batal(b.orderId, "Toko tidak jadi");
      expect(await rapikanSumberPesananBatal(b.orderId)).toEqual({ dibuka: 2, dipindah: 0 });
      const r = await permintaan();
      expect(r.status).toBe("BARU");
      expect(r.fieldSalesOrderId).toBeNull();
      const k = await rekomendasi();
      expect(k.status).toBe("DITERIMA");
      expect(k.fieldSalesOrderId).toBeNull();
    });

    it("a link left on an earlier order follows a later edit of the replacement", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      const b = await pesan({ replacesOrderId: a.orderId });
      const c = await pesan({ replacesOrderId: b.orderId });
      // Yang dipanggil aksi ubah pesanan untuk C: pesanan lamanya, B.
      expect(await rapikanSumberPesananBatal(b.orderId)).toEqual({ dibuka: 0, dipindah: 1 });
      const r = await permintaan();
      expect(r.status).toBe("DIPROSES");
      expect(r.fieldSalesOrderId).toBe(c.orderId);
      expect(r.handleNote).toBe(`Dibuatkan pesanan ${c.orderNo}`);
    });

    it("an edit replayed twice at once moves each document once", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      await tautkan("rekomendasi", a);
      const b = await pesan({ replacesOrderId: a.orderId });
      const hasil = await Promise.all([rapikanSumberPesananBatal(a.orderId), rapikanSumberPesananBatal(a.orderId)]);
      expect(hasil.reduce((n, h) => n + h.dipindah, 0)).toBe(2);
      expect((await permintaan()).fieldSalesOrderId).toBe(b.orderId);
      expect((await rekomendasi()).fieldSalesOrderId).toBe(b.orderId);
      expect(await jejak(requestId, JEJAK_SUMBER_PESANAN.PERMINTAAN_PESANAN_DIGANTI)).toHaveLength(1);
      expect(await jejak(rekomId, JEJAK_SUMBER_PESANAN.REKOMENDASI_PESANAN_DIGANTI)).toHaveLength(1);
    });

    it("moving to the replacement while the replacement is being cancelled always ends with both documents open", async () => {
      // Jeda [pindah ke B, batal B + rapikan B] ms.
      const jadwal: Array<[number, number]> = [[0, 0], [0, 8], [8, 0], [60, 0], [0, 60]];
      for (const [jedaPindah, jedaBatal] of jadwal) {
        await prisma.stockRequest.update({
          where: { id: requestId },
          data: { status: "BARU", fieldSalesOrderId: null, handledById: null, handledAt: null, handleNote: null },
        });
        await prisma.storeRecommendation.update({ where: { id: rekomId }, data: { status: "DITERIMA", fieldSalesOrderId: null } });
        const a = await pesan();
        await tautkan("permintaan", a);
        await tautkan("rekomendasi", a);
        const b = await pesan({ replacesOrderId: a.orderId });
        await Promise.all([
          new Promise((r) => setTimeout(r, jedaPindah)).then(() => rapikanSumberPesananBatal(a.orderId)),
          new Promise((r) => setTimeout(r, jedaBatal)).then(async () => {
            await batal(b.orderId);
            await rapikanSumberPesananBatal(b.orderId);
          }),
        ]);
        const r = await permintaan();
        expect([r.status, r.fieldSalesOrderId]).toEqual(["BARU", null]);
        const k = await rekomendasi();
        expect([k.status, k.fieldSalesOrderId]).toEqual(["DITERIMA", null]);
      }
    });

    it("never releases a document whose order is still alive, even if a cancelled order claims to replace it", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      // Data janggal: pesanan batal yang `replacesOrderId`-nya menunjuk A yang masih menunggu.
      const janggal = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `${tag}-JGL`,
          storeId: toko,
          salesmanId: sales,
          status: "REJECTED",
          cancelledById: sales,
          cancelledAt: new Date(),
          rejectReason: "uji",
          replacesOrderId: a.orderId,
          subtotal: 0,
          total: 0,
        },
      });
      expect(await rapikanSumberPesananBatal(janggal.id)).toEqual({ dibuka: 0, dipindah: 0 });
      const r = await permintaan();
      expect(r.status).toBe("DIPROSES");
      expect(r.fieldSalesOrderId).toBe(a.orderId);
    });

    it("from the edit path, only the order's own salesman moves anything", async () => {
      const a = await pesan();
      await tautkan("permintaan", a);
      const b = await pesan({ replacesOrderId: a.orderId });
      // Kiriman ulang dengan kunci idempotensi yang sama tidak memeriksa pemilik pesanan lama — aksi membatasinya.
      expect(await rapikanSumberPesananBatal(a.orderId, { salesmanId: salesLain })).toEqual({ dibuka: 0, dipindah: 0 });
      expect((await permintaan()).fieldSalesOrderId).toBe(a.orderId);
      expect(await rapikanSumberPesananBatal(a.orderId, { salesmanId: sales })).toEqual({ dibuka: 0, dipindah: 1 });
      expect((await permintaan()).fieldSalesOrderId).toBe(b.orderId);
    });
  });

  describe("tautkanSumberPesanan — hanya ke pesanan yang hidup", () => {
    it("refuses a cancelled order, another salesman's order and another store's order", async () => {
      const a = await pesan();
      await batal(a.orderId);
      await tautkan("permintaan", a);
      await tautkan("rekomendasi", a);
      expect((await permintaan()).fieldSalesOrderId).toBeNull();
      expect((await rekomendasi()).fieldSalesOrderId).toBeNull();

      const lain = await createFieldSalesOrder({ storeId: tokoLain, salesmanId: salesLain, visitId: visitLainId, lines: baris(6), idempotencyKey: kunci() });
      // Pesanan toko lain yang diaku di toko ini.
      await tautkanSumberPesanan({ jenis: "permintaan", id: requestId }, { ...lain, userId: sales, storeId: toko });
      expect((await permintaan()).fieldSalesOrderId).toBeNull();
      expect(await jejak(requestId, "STOCK_REQUEST_STATUS")).toHaveLength(0);
    });

    it("checks the order's salesman and store separately: neither alone is enough", async () => {
      // Baris pesanan polos (tanpa penulis): yang diuji hanya penjaga penautan.
      const polos = async (no: string, storeId: string, salesmanId: string) => {
        const o = await prisma.fieldSalesOrder.create({
          data: { orderNo: `${tag}-${no}`, storeId, salesmanId, status: "PENDING_APPROVAL", subtotal: 0, total: 0 },
        });
        return { orderId: o.id, orderNo: o.orderNo };
      };
      // Pesanan salesman lain DI TOKO INI, diaku pemegang toko.
      const milikLain = await polos("P1", toko, salesLain);
      await tautkan("permintaan", milikLain);
      await tautkan("rekomendasi", milikLain);
      // Pesanan salesman ini sendiri, tapi DI TOKO LAIN.
      const tokoBeda = await polos("P2", tokoLain, sales);
      await tautkan("permintaan", tokoBeda);
      await tautkan("rekomendasi", tokoBeda);
      expect((await permintaan()).fieldSalesOrderId).toBeNull();
      expect((await rekomendasi()).fieldSalesOrderId).toBeNull();
      expect((await rekomendasi()).status).toBe("DITERIMA");
    });

    it("an order synced later from the phone queue links once, even when the queue replays it", async () => {
      const a = await pesan();
      // Kiriman dari antrean HP: aksi yang sama dipanggil ulang dengan pesanan yang sudah tercatat.
      await Promise.all([tautkan("permintaan", a), tautkan("permintaan", a)]);
      await tautkan("permintaan", a);
      const r = await permintaan();
      expect(r.status).toBe("DIPROSES");
      expect(r.fieldSalesOrderId).toBe(a.orderId);
      expect(await jejak(requestId, "STOCK_REQUEST_STATUS")).toHaveLength(1);
    });
  });
});
