import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { AKSI_BUKTI_TERIMA, catatBuktiTerima, koreksiBuktiTerima } from "./bukti-terima-writer";
import { kirimanPesananSaya } from "./bukti-terima-queries";

/**
 * Penulis bukti terima terhadap basis data sungguhan. Semua baris dibuat di
 * sini dan dihapus lewat `seededId()` — tidak ada fungsi selebar-tabel yang
 * dipanggil. Jangan dijalankan ke basis data produksi.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const JAM = 60 * 60_000;

d("bukti terima — penulis (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let salesmanId = "";
  let salesmanLainId = "";
  let kantorId = "";
  let storeId = "";
  let orderId = "";
  let deliveryId = "";
  let fotoSalesman = "";
  let fotoSalesman2 = "";
  let fotoLain = "";
  let fotoKantor = "";
  let fotoIds: string[] = [];
  let sekarang = new Date();

  const salesman = () => ({ userId: salesmanId, izin: ["pwa:access"] });
  const salesmanLain = () => ({ userId: salesmanLainId, izin: ["pwa:access"] });
  const kantor = () => ({ userId: kantorId, izin: ["field_sales_orders:view", "field_sales_orders:deliver"] });
  const fotoUrl = (id: string) => `/api/foto/${id}`;

  async function buatFoto(uploadedById: string): Promise<string> {
    const f = await prisma.foto.create({
      data: { mime: "image/png", bytes: Buffer.from([137, 80, 78, 71]), sizeBytes: 4, uploadedById },
      select: { id: true },
    });
    fotoIds.push(f.id);
    return f.id;
  }

  const masukan = (over: Record<string, unknown> = {}) => ({
    deliveryId,
    receivedByName: "Bu Siti",
    receivedAt: new Date(sekarang.getTime() - JAM).toISOString(),
    podPhotoUrl: fotoUrl(fotoSalesman),
    idempotencyKey: `k-${Math.random().toString(36).slice(2)}`,
    jenisBukti: "FOTO",
    reason: undefined as unknown,
    ...over,
  });

  const jejak = () =>
    prisma.auditLog.findMany({
      where: { entityType: "FieldSalesDelivery", entityId: seededId(deliveryId) },
      orderBy: { createdAt: "asc" },
    });

  const baris = () =>
    prisma.fieldSalesDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: { receivedByName: true, receivedAt: true, podPhotoUrl: true },
    });

  beforeEach(async () => {
    salesmanId = ""; salesmanLainId = ""; kantorId = ""; storeId = ""; orderId = ""; deliveryId = "";
    fotoSalesman = ""; fotoSalesman2 = ""; fotoLain = ""; fotoKantor = ""; fotoIds = [];
    sekarang = new Date();

    salesmanId = (await prisma.user.create({ data: { email: `test-bt-s-${token}@example.com`, name: "Test BT Salesman" } })).id;
    salesmanLainId = (await prisma.user.create({ data: { email: `test-bt-l-${token}@example.com`, name: "Test BT Lain" } })).id;
    kantorId = (await prisma.user.create({ data: { email: `test-bt-k-${token}@example.com`, name: "Test BT Kantor" } })).id;
    storeId = (
      await prisma.store.create({
        data: { code: `TEST-BT-${token}`, name: "Toko Test BT", address: "Jl. Test", termsType: "PUTUS", isActive: true },
      })
    ).id;
    orderId = (
      await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `PUTUS/TEST-BT-${token}`,
          storeId,
          salesmanId,
          status: "APPROVED",
          orderType: "PUTUS",
          subtotal: 10000,
          total: 10000,
        },
      })
    ).id;
    deliveryId = (
      await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `DLV/TEST-BT-${token}`,
          orderId,
          deliveredAt: new Date(sekarang.getTime() - 24 * JAM),
          deliveredById: kantorId,
          invoiceDate: new Date(sekarang.getTime() - 48 * JAM),
          dueDate: new Date(sekarang.getTime() + 30 * 24 * JAM),
          subtotal: 10000,
          total: 10000,
        },
      })
    ).id;
    fotoSalesman = await buatFoto(salesmanId);
    fotoSalesman2 = await buatFoto(salesmanId);
    fotoLain = await buatFoto(salesmanLainId);
    fotoKantor = await buatFoto(kantorId);
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesDelivery", entityId: seededId(deliveryId) } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: seededId(deliveryId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.foto.deleteMany({ where: { id: { in: seededIds(fotoIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesmanId, salesmanLainId, kantorId].filter(Boolean)) } } });
  });

  describe("mencatat", () => {
    it("lets the order's salesman record it from the phone, with an audit row carrying before/after and the key", async () => {
      const m = masukan({ receivedByName: "  Bu   Siti " });
      const h = await catatBuktiTerima(salesman(), m);
      expect(h).toEqual({ ok: true, ulangan: false, orderId, deliveryId });

      const b = await baris();
      expect(b.receivedByName).toBe("Bu Siti");
      expect(b.receivedAt?.toISOString()).toBe(m.receivedAt);
      expect(b.podPhotoUrl).toBe(fotoUrl(fotoSalesman));

      const j = await jejak();
      expect(j).toHaveLength(1);
      expect(j[0].action).toBe(AKSI_BUKTI_TERIMA.CATAT);
      expect(j[0].userId).toBe(salesmanId);
      expect(j[0].changes).toEqual({
        before: { receivedByName: null, receivedAt: null, podPhotoUrl: null },
        after: { receivedByName: "Bu Siti", receivedAt: m.receivedAt, podPhotoUrl: fotoUrl(fotoSalesman) },
      });
      expect(j[0].metadata).toMatchObject({ idempotencyKey: m.idempotencyKey, sumber: "SALESMAN", jenisBukti: "FOTO", orderId });
    });

    it("refuses another salesman and writes nothing", async () => {
      const h = await catatBuktiTerima(salesmanLain(), masukan({ podPhotoUrl: fotoUrl(fotoLain) }));
      expect(h).toEqual({ ok: false, kode: "TANPA_AKSES" });
      expect((await baris()).receivedAt).toBeNull();
      expect(await jejak()).toHaveLength(0);
    });

    it("lets the office record it", async () => {
      const h = await catatBuktiTerima(kantor(), masukan({ podPhotoUrl: fotoUrl(fotoKantor) }));
      expect(h.ok).toBe(true);
      const j = await jejak();
      expect(j[0].metadata).toMatchObject({ sumber: "KANTOR" });
    });

    it("refuses an image someone else uploaded, or one that does not exist", async () => {
      expect(await catatBuktiTerima(salesman(), masukan({ podPhotoUrl: fotoUrl(fotoLain) }))).toEqual({
        ok: false,
        kode: "FOTO_TIDAK_DITEMUKAN",
      });
      expect(await catatBuktiTerima(salesman(), masukan({ podPhotoUrl: "/api/foto/tidak-ada-sama-sekali" }))).toEqual({
        ok: false,
        kode: "FOTO_TIDAK_DITEMUKAN",
      });
      expect(await jejak()).toHaveLength(0);
    });

    it("refuses a receipt time before the delivery or in the future", async () => {
      const sebelum = new Date(sekarang.getTime() - 72 * JAM).toISOString();
      expect(await catatBuktiTerima(salesman(), masukan({ receivedAt: sebelum }))).toEqual({ ok: false, kode: "WAKTU_SEBELUM_KIRIM" });
      const nanti = new Date(sekarang.getTime() + 60 * 60_000).toISOString();
      expect(await catatBuktiTerima(salesman(), masukan({ receivedAt: nanti }))).toEqual({ ok: false, kode: "WAKTU_DI_MASA_DEPAN" });
      expect((await baris()).receivedAt).toBeNull();
    });

    it("returns NOT FOUND for an unknown delivery", async () => {
      expect(await catatBuktiTerima(kantor(), masukan({ deliveryId: "tidak-ada" }))).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
    });

    it("replays the same key as the same record — no second audit row", async () => {
      const m = masukan();
      await catatBuktiTerima(salesman(), m);
      const ulang = await catatBuktiTerima(salesman(), m);
      expect(ulang).toEqual({ ok: true, ulangan: true, orderId, deliveryId });
      expect(await jejak()).toHaveLength(1);
    });

    it("treats an identical payload under another key as a replay, but a different one as already received", async () => {
      const m = masukan();
      await catatBuktiTerima(salesman(), m);
      expect(await catatBuktiTerima(salesman(), { ...m, idempotencyKey: "kunci-lain" })).toMatchObject({ ok: true, ulangan: true });
      expect(
        await catatBuktiTerima(salesman(), masukan({ receivedByName: "Pak Budi", podPhotoUrl: fotoUrl(fotoSalesman2) })),
      ).toEqual({ ok: false, kode: "SUDAH_DITERIMA" });
      expect((await baris()).receivedByName).toBe("Bu Siti");
      expect(await jejak()).toHaveLength(1);
    });

    it("lets exactly one of two simultaneous first records win", async () => {
      const [a, b] = await Promise.all([
        catatBuktiTerima(salesman(), masukan({ receivedByName: "Penerima A" })),
        catatBuktiTerima(kantor(), masukan({ receivedByName: "Penerima B", podPhotoUrl: fotoUrl(fotoKantor) })),
      ]);
      const menang = [a, b].filter((h) => h.ok && !h.ulangan);
      const kalah = [a, b].filter((h) => !h.ok);
      expect(menang).toHaveLength(1);
      expect(kalah).toEqual([{ ok: false, kode: "SUDAH_DITERIMA" }]);

      const j = await jejak();
      expect(j).toHaveLength(1);
      const tersimpan = (await baris()).receivedByName;
      expect((j[0].changes as { after: { receivedByName: string } }).after.receivedByName).toBe(tersimpan);
    });
  });

  describe("kirimanPesananSaya", () => {
    it("shows the owner each delivery with its proof state, and nobody else anything", async () => {
      const awal = await kirimanPesananSaya(orderId, salesmanId);
      expect(awal).toHaveLength(1);
      expect(awal[0]).toMatchObject({ id: deliveryId, keadaan: "BELUM_DITERIMA", receivedByName: null, pcs: 0 });
      expect(awal[0].batasAwal.getTime()).toBe(sekarang.getTime() - 48 * JAM);

      await catatBuktiTerima(salesman(), masukan());
      const sesudah = await kirimanPesananSaya(orderId, salesmanId);
      expect(sesudah[0]).toMatchObject({ keadaan: "DITERIMA", receivedByName: "Bu Siti", podPhotoUrl: fotoUrl(fotoSalesman) });

      expect(await kirimanPesananSaya(orderId, salesmanLainId)).toEqual([]);
    });
  });

  describe("mengoreksi", () => {
    async function sudahTercatat() {
      const m = masukan();
      await catatBuktiTerima(salesman(), m);
      return m;
    }

    it("is refused before anything was recorded", async () => {
      expect(await koreksiBuktiTerima(kantor(), masukan({ reason: "Salah nama", podPhotoUrl: fotoUrl(fotoKantor) }))).toEqual({
        ok: false,
        kode: "BELUM_DITERIMA",
      });
    });

    it("requires a reason", async () => {
      await sudahTercatat();
      expect(await koreksiBuktiTerima(kantor(), masukan({ reason: "  " }))).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    });

    it("is the office's — the salesman who recorded it cannot rewrite it", async () => {
      await sudahTercatat();
      expect(await koreksiBuktiTerima(salesman(), masukan({ receivedByName: "Bu Sinta", reason: "Salah ketik" }))).toEqual({
        ok: false,
        kode: "TANPA_AKSES",
      });
    });

    it("writes the change and an audit row with the superseded values and the reason", async () => {
      const awal = await sudahTercatat();
      const m = masukan({ receivedByName: "Bu Sinta", receivedAt: awal.receivedAt, reason: "Salah ketik nama" });
      const h = await koreksiBuktiTerima(kantor(), m);
      expect(h).toEqual({ ok: true, ulangan: false, orderId, deliveryId });
      expect((await baris()).receivedByName).toBe("Bu Sinta");

      const j = await jejak();
      expect(j.map((x) => x.action)).toEqual([AKSI_BUKTI_TERIMA.CATAT, AKSI_BUKTI_TERIMA.KOREKSI]);
      expect(j[1].userId).toBe(kantorId);
      expect(j[1].reason).toBe("Salah ketik nama");
      expect(j[1].changes).toEqual({
        before: { receivedByName: "Bu Siti", receivedAt: awal.receivedAt, podPhotoUrl: fotoUrl(fotoSalesman) },
        after: { receivedByName: "Bu Sinta", receivedAt: awal.receivedAt, podPhotoUrl: fotoUrl(fotoSalesman) },
      });

      // Kiriman ulang dengan kunci yang sama tidak menulis jejak kedua.
      expect(await koreksiBuktiTerima(kantor(), m)).toMatchObject({ ok: true, ulangan: true });
      expect(await jejak()).toHaveLength(2);
    });

    it("keeps the salesman's photo without re-checking its uploader, but checks a NEW photo", async () => {
      const awal = await sudahTercatat();
      expect(
        await koreksiBuktiTerima(kantor(), masukan({ receivedAt: awal.receivedAt, podPhotoUrl: fotoUrl(fotoLain), reason: "Ganti foto" })),
      ).toEqual({ ok: false, kode: "FOTO_TIDAK_DITEMUKAN" });
      expect(
        await koreksiBuktiTerima(kantor(), masukan({ receivedAt: awal.receivedAt, podPhotoUrl: fotoUrl(fotoKantor), reason: "Ganti foto" })),
      ).toMatchObject({ ok: true, ulangan: false });
    });

    it("says so when nothing would change", async () => {
      const awal = await sudahTercatat();
      expect(await koreksiBuktiTerima(kantor(), { ...awal, idempotencyKey: "k-sama", reason: "Tidak ada" })).toEqual({
        ok: false,
        kode: "TIDAK_BERUBAH",
      });
      expect(await jejak()).toHaveLength(1);
    });

    it("refuses a correction made against values that changed meanwhile", async () => {
      const awal = await sudahTercatat();
      const dilihat = { receivedByName: "Bu Siti", receivedAt: awal.receivedAt, podPhotoUrl: fotoUrl(fotoSalesman) };
      await koreksiBuktiTerima(kantor(), masukan({ receivedByName: "Bu Sinta", receivedAt: awal.receivedAt, reason: "Pertama" }));
      const basi = await koreksiBuktiTerima(
        kantor(),
        masukan({ receivedByName: "Bu Santi", receivedAt: awal.receivedAt, reason: "Kedua", sebelum: dilihat }),
      );
      expect(basi).toEqual({ ok: false, kode: "KONFLIK" });
      expect((await baris()).receivedByName).toBe("Bu Sinta");
      expect(await jejak()).toHaveLength(2);
    });
  });
});
