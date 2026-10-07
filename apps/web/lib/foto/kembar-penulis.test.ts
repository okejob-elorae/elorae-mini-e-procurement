import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { sidikFoto } from "./sidik";
import { buatKlaimPembayaran } from "@/lib/receivables/claim-writer";
import { buatKontrabon, pasangFotoKontrabon } from "@/lib/receivables/collection-writer";
import { catatReturToko } from "@/lib/receivables/return-writer";
import { catatBuktiTerima, koreksiBuktiTerima } from "@/lib/field-sales/delivery/bukti-terima-writer";

/**
 * Foto yang dicuci, di setiap penulis yang menerima foto laporan — basis data sungguhan.
 *
 * Skenario dasar: sales B memakai foto bukti transfernya di BKM. Sales A
 * mengunduh foto itu lalu mengunggahnya lagi (baris `Foto` baru milik A, isi
 * byte-identik). Pemeriksaan pemilik meloloskannya; pemeriksaan kembar menolaknya
 * dengan `FOTO_SUDAH_DIPAKAI`. Foto sendiri tetap boleh, dan koreksi dokumen yang
 * sama tidak menghitung dokumen itu sebagai "dokumen lain".
 *
 * Semua baris dibuat di sini dan dihapus lewat `seededId()`.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const JAM = 60 * 60_000;

d("foto kembar di penulis laporan (test bed only)", () => {
  const tag = `KMBP${Math.random().toString(36).slice(2, 8)}`;
  let salesA = "";
  let salesB = "";
  let kantor = "";
  let tokoId = "";
  let piutangIds: string[] = [];
  let klaimIds: string[] = [];
  let notaIds: string[] = [];
  let nrtIds: string[] = [];
  let fotoIds: string[] = [];
  let orderId = "";
  let deliveryId = "";
  /** Foto bukti transfer B, sudah dipakai BKM B. */
  let fotoB = "";
  let urut = 0;

  const isiBukti = () => Buffer.from(`bukti-transfer-${tag}`);
  const alamat = (id: string) => `/api/foto/${id}`;

  async function foto(isi: Buffer<ArrayBuffer>, olehId: string): Promise<string> {
    const f = await prisma.foto.create({
      data: { mime: "image/jpeg", bytes: isi, sizeBytes: isi.byteLength, caption: tag, uploadedById: olehId, sha256: sidikFoto(isi) },
      select: { id: true },
    });
    fotoIds.push(f.id);
    return f.id;
  }

  async function piutang(): Promise<string> {
    urut += 1;
    const p = await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV/${urut}`,
        storeId: tokoId,
        invoiceDate: new Date("2026-09-01T00:00:00+07:00"),
        dueDate: new Date("2026-10-01T00:00:00+07:00"),
        amount: 2_000_000,
        outstanding: 2_000_000,
        source: "MANUAL",
      },
      select: { id: true },
    });
    piutangIds.push(p.id);
    return p.id;
  }

  async function klaim(oleh: string, fotoId: string, receivableId: string) {
    const h = await buatKlaimPembayaran({
      storeId: tokoId,
      salesmanId: oleh,
      createdById: oleh,
      claimedTransferAt: new Date("2026-10-02T00:00:00+07:00"),
      method: "transfer",
      pelunasan: [{ receivableId, nilai: 500_000 }],
      transferPhotoUrl: alamat(fotoId),
    });
    if (h.ok) klaimIds.push(h.id);
    return h;
  }

  async function kontrabon(oleh: string, fotoId: string, receivableId: string, source: "FIELD" | "OFFICE" = "FIELD") {
    const h = await buatKontrabon({
      receivableIds: [receivableId],
      salesmanId: oleh,
      handoverDate: new Date("2026-10-02T00:00:00+07:00"),
      promisedDate: new Date("2026-10-15T00:00:00+07:00"),
      receivedBy: "Bu Ani",
      photoUrl: alamat(fotoId),
      source,
    });
    if (h.ok) notaIds.push(h.id);
    return h;
  }

  async function nrt(oleh: string, fotoId: string) {
    urut += 1;
    const h = await catatReturToko({
      noNrt: `${tag}-NRT-${urut}`,
      storeId: tokoId,
      olehUserId: oleh,
      salesmanId: oleh,
      claimDate: new Date("2026-10-02T00:00:00+07:00"),
      deliveryMethod: "SALES",
      claimedAmount: 150_000,
      photoUrl: alamat(fotoId),
    });
    if (h.ok) nrtIds.push(h.id);
    return h;
  }

  const pelakuSales = () => ({ userId: salesA, izin: ["pwa:access"] });
  const pelakuKantor = () => ({ userId: kantor, izin: ["field_sales_orders:view", "field_sales_orders:deliver"] });
  const bukti = (fotoId: string, over: Record<string, unknown> = {}) => ({
    deliveryId,
    receivedByName: "Bu Siti",
    receivedAt: new Date(Date.now() - JAM).toISOString(),
    podPhotoUrl: alamat(fotoId),
    idempotencyKey: `k-${Math.random().toString(36).slice(2)}`,
    jenisBukti: "FOTO",
    ...over,
  });

  beforeEach(async () => {
    salesA = "";
    salesB = "";
    kantor = "";
    tokoId = "";
    piutangIds = [];
    klaimIds = [];
    notaIds = [];
    nrtIds = [];
    fotoIds = [];
    orderId = "";
    deliveryId = "";
    fotoB = "";

    const orang = async (akhiran: string) =>
      (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-${akhiran}@uji.local`, name: `${tag} ${akhiran}` } })).id;
    salesA = await orang("a");
    salesB = await orang("b");
    kantor = await orang("k");
    tokoId = (
      await prisma.store.create({
        data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true },
      })
    ).id;

    // Dokumen lain yang sudah memakai bukti B: BKM-nya sendiri.
    fotoB = await foto(isiBukti(), salesB);
    const bkmB = await klaim(salesB, fotoB, await piutang());
    if (!bkmB.ok) throw new Error(`BKM B gagal: ${bkmB.alasan}`);

    orderId = (
      await prisma.fieldSalesOrder.create({
        data: { orderNo: `PUTUS/${tag}`, storeId: tokoId, salesmanId: salesA, status: "APPROVED", orderType: "PUTUS", subtotal: 10000, total: 10000 },
      })
    ).id;
    deliveryId = (
      await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `DLV/${tag}`,
          orderId,
          deliveredAt: new Date(Date.now() - 24 * JAM),
          deliveredById: kantor,
          invoiceDate: new Date(Date.now() - 48 * JAM),
          dueDate: new Date(Date.now() + 30 * 24 * JAM),
          subtotal: 10000,
          total: 10000,
        },
      })
    ).id;
  });

  afterEach(async () => {
    const entitas = [...klaimIds, ...notaIds, ...nrtIds, deliveryId].filter(Boolean);
    if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
    const pengguna = [salesA, salesB, kantor].filter(Boolean);
    if (pengguna.length) await prisma.auditLog.deleteMany({ where: { userId: { in: seededIds(pengguna) } } });
    if (klaimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
    if (notaIds.length) await prisma.collectionNote.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
    if (deliveryId) await prisma.fieldSalesDelivery.delete({ where: { id: seededId(deliveryId) } });
    if (orderId) await prisma.fieldSalesOrder.delete({ where: { id: seededId(orderId) } });
    if (piutangIds.length) await prisma.receivable.deleteMany({ where: { id: { in: seededIds(piutangIds) } } });
    if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
    if (fotoIds.length) await prisma.foto.deleteMany({ where: { id: { in: seededIds(fotoIds) } } });
    if (pengguna.length) await prisma.user.deleteMany({ where: { id: { in: seededIds(pengguna) } } });
  });

  describe("BKM", () => {
    it("menolak bukti transfer B yang diunggah ulang A, menerima foto sendiri", async () => {
      const cucian = await foto(isiBukti(), salesA);
      expect(await klaim(salesA, cucian, await piutang())).toEqual({ ok: false, alasan: "FOTO_SUDAH_DIPAKAI" });
      expect(klaimIds).toHaveLength(1);

      const sendiri = await foto(Buffer.from(`bukti-a-${tag}`), salesA);
      expect((await klaim(salesA, sendiri, await piutang())).ok).toBe(true);
    });

    it("B mengunggah ulang buktinya sendiri → boleh", async () => {
      const ulang = await foto(isiBukti(), salesB);
      expect((await klaim(salesB, ulang, await piutang())).ok).toBe(true);
    });
  });

  describe("kontrabon / janji bayar", () => {
    it("janji bayar lapangan menolak cucian, menerima foto sendiri", async () => {
      const cucian = await foto(isiBukti(), salesA);
      expect(await kontrabon(salesA, cucian, await piutang())).toEqual({ ok: false, alasan: "FOTO_SUDAH_DIPAKAI" });
      expect(notaIds).toHaveLength(0);

      const sendiri = await foto(Buffer.from(`lembar-a-${tag}`), salesA);
      expect((await kontrabon(salesA, sendiri, await piutang())).ok).toBe(true);
    });

    it("koreksi foto: kembaran yang hanya dipakai kontrabon ini sendiri boleh, di kontrabon lain ditolak", async () => {
      const isiLembar = Buffer.from(`lembar-b-${tag}`);
      const lembarB = await foto(isiLembar, salesB);
      const notaB = await kontrabon(salesB, lembarB, await piutang(), "OFFICE");
      if (!notaB.ok) throw new Error(`kontrabon B gagal: ${notaB.alasan}`);

      const salinanA = await foto(isiLembar, salesA);
      expect(await pasangFotoKontrabon({ collectionNoteId: notaB.id, photoUrl: alamat(salinanA), olehUserId: salesA })).toEqual({
        ok: true,
      });

      const notaLain = await kontrabon(salesA, await foto(Buffer.from(`lembar-lain-${tag}`), salesA), await piutang());
      if (!notaLain.ok) throw new Error(`kontrabon lain gagal: ${notaLain.alasan}`);
      // Salinan A kini dipakai kontrabon B — dokumen lain bagi kontrabon ini.
      const salinanB = await foto(isiLembar, salesB);
      expect(
        await pasangFotoKontrabon({ collectionNoteId: notaLain.id, photoUrl: alamat(salinanB), olehUserId: salesB }),
      ).toEqual({ ok: false, alasan: "FOTO_SUDAH_DIPAKAI" });
    });
  });

  describe("NRT", () => {
    it("menolak cucian, menerima foto sendiri", async () => {
      const cucian = await foto(isiBukti(), salesA);
      expect(await nrt(salesA, cucian)).toEqual({ ok: false, alasan: "FOTO_SUDAH_DIPAKAI" });
      expect(nrtIds).toHaveLength(0);

      const sendiri = await foto(Buffer.from(`nota-a-${tag}`), salesA);
      expect((await nrt(salesA, sendiri)).ok).toBe(true);
    });
  });

  describe("bukti terima pengiriman", () => {
    it("mencatat: cucian ditolak dan pengirimannya tetap kosong; foto sendiri diterima", async () => {
      const cucian = await foto(isiBukti(), salesA);
      expect(await catatBuktiTerima(pelakuSales(), bukti(cucian))).toEqual({ ok: false, kode: "FOTO_SUDAH_DIPAKAI" });
      expect((await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(deliveryId) } })).receivedAt).toBeNull();

      const sendiri = await foto(Buffer.from(`pod-a-${tag}`), salesA);
      expect(await catatBuktiTerima(pelakuSales(), bukti(sendiri))).toMatchObject({ ok: true, ulangan: false });
    });

    it("koreksi: salinan foto pengiriman ini sendiri boleh, salinan bukti yang dipakai dokumen lain ditolak", async () => {
      const isiPod = Buffer.from(`pod-asli-${tag}`);
      const podA = await foto(isiPod, salesA);
      const catat = bukti(podA);
      expect((await catatBuktiTerima(pelakuSales(), catat)).ok).toBe(true);
      const sebelum = { receivedByName: "Bu Siti", receivedAt: catat.receivedAt, podPhotoUrl: alamat(podA) };

      const cucian = await foto(isiBukti(), kantor);
      expect(
        await koreksiBuktiTerima(pelakuKantor(), { ...bukti(cucian, { receivedAt: catat.receivedAt }), reason: "foto buram", sebelum }),
      ).toEqual({ ok: false, kode: "FOTO_SUDAH_DIPAKAI" });

      const salinanKantor = await foto(isiPod, kantor);
      expect(
        await koreksiBuktiTerima(pelakuKantor(), {
          ...bukti(salinanKantor, { receivedAt: catat.receivedAt }),
          reason: "foto diperbesar",
          sebelum,
        }),
      ).toMatchObject({ ok: true, ulangan: false });
    });
  });
});
