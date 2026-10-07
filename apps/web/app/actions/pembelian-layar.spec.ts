import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Aksi baru untuk layar pembelian & inventori (sesi ditiru, basis data uji):
 * - `getPemasokPilihan`: saringan dan dokumen lama dulu memakai `approvedOnly`,
 *   jadi pemasok PO yang belum dibayar tidak bisa dipilih dan formulir ubah
 *   retur kehilangan pemasoknya sendiri.
 * - `getRincianGRN`: GRN dulu tidak punya rincian barang/qty/harga.
 * - `putuskanGRNPemilik`, `hapusReturPemasok`: penolakan sebagai kode, bukan
 *   lemparan (disamarkan di produksi).
 * - `batalkanPO` menolak tanpa alasan; `setPOPaidAt` menolak tanggal besok.
 * - `getVendorReturns` membawa nomor PO yang dikredit dan kredit sebagai angka.
 */

const sesi = vi.hoisted(() => ({ ada: true, id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.ada ? { user: { id: sesi.id, email: null, permissions: sesi.permissions } } : null)),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const po = await import("./purchase-orders");
const grn = await import("./grn");
const retur = await import("./vendor-returns");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("aksi layar pembelian (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let disetujuiId = "";
  let berdokumenId = "";
  let tanpaDokumenId = "";
  let hanyaPoId = "";
  let poLainId = "";
  const mulai = new Date();
  let uomId = "";
  let itemId = "";
  let poId = "";
  let grnId = "";
  let grnDitolakId = "";
  let returDrafId = "";
  let returProsesId = "";

  beforeAll(async () => {
    userId = "";
    typeId = "";
    disetujuiId = "";
    berdokumenId = "";
    tanpaDokumenId = "";
    hanyaPoId = "";
    poLainId = "";
    uomId = "";
    itemId = "";
    poId = "";
    grnId = "";
    grnDitolakId = "";
    returDrafId = "";
    returProsesId = "";
    userId = (await prisma.user.create({ data: { email: `layar-beli-${token}@uji.local`, name: "Penerima Uji" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TLB-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    disetujuiId = (
      await prisma.supplier.create({
        data: { code: `SUP-A-${token}`, name: `Pemasok disetujui ${token}`, typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    berdokumenId = (
      await prisma.supplier.create({
        data: { code: `SUP-B-${token}`, name: `Pemasok berdokumen ${token}`, typeId, status: "PENDING_APPROVAL" },
        select: { id: true },
      })
    ).id;
    tanpaDokumenId = (
      await prisma.supplier.create({
        data: { code: `SUP-C-${token}`, name: `Pemasok kosong ${token}`, typeId, status: "PENDING_APPROVAL" },
        select: { id: true },
      })
    ).id;
    hanyaPoId = (
      await prisma.supplier.create({
        data: { code: `SUP-D-${token}`, name: `Pemasok hanya PO ${token}`, typeId, status: "PENDING_APPROVAL" },
        select: { id: true },
      })
    ).id;
    poLainId = (
      await prisma.purchaseOrder.create({
        data: { docNumber: `PO-LB2-${token}`, supplierId: hanyaPoId, createdById: userId },
        select: { id: true },
      })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `L${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `LB-${token}`, nameId: "Kancing Eloraé", nameEn: "Button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    poId = (
      await prisma.purchaseOrder.create({
        data: { docNumber: `PO-LB-${token}`, supplierId: berdokumenId, createdById: userId, status: "SUBMITTED", grandTotal: 1_700_000 },
        select: { id: true },
      })
    ).id;
    grnId = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-LB-${token}`,
          poId,
          supplierId: berdokumenId,
          receivedBy: userId,
          totalAmount: 850_000,
          photoUrls: JSON.stringify(["/api/foto/uji-1"]),
          items: JSON.stringify([{ itemId, variantSku: null, qty: 50, unitCost: 17_000, totalCost: 850_000 }]),
        },
        select: { id: true },
      })
    ).id;
    grnDitolakId = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-LB-X-${token}`,
          poId,
          supplierId: berdokumenId,
          receivedBy: userId,
          totalAmount: 170_000,
          items: JSON.stringify([{ itemId, variantSku: null, qty: 10, unitCost: 17_000, totalCost: 170_000 }]),
          requiresOwnerApproval: true,
          ownerDeclinedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
    returDrafId = (
      await prisma.vendorReturn.create({
        data: { docNumber: `RET-LB-D-${token}`, vendorId: berdokumenId, lines: [], totalItems: 0, totalValue: 0, createdById: userId },
        select: { id: true },
      })
    ).id;
    returProsesId = (
      await prisma.vendorReturn.create({
        data: {
          docNumber: `RET-LB-P-${token}`,
          vendorId: berdokumenId,
          lines: [],
          totalItems: 0,
          totalValue: 125_000,
          status: "PROCESSED",
          poId,
          poCreditAmount: 125_000,
          createdById: userId,
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.vendorReturn.deleteMany({ where: { id: { in: [seededId(returDrafId), seededId(returProsesId)] } } });
    await prisma.gRN.deleteMany({ where: { id: { in: [seededId(grnId), seededId(grnDitolakId)] } } });
    await prisma.pOStatusHistory.deleteMany({ where: { poId: seededId(poId) } });
    // Bila penjaga tanggal bayar pernah gagal, toggle sempat menulis kabar — bersihkan (cocokkan di JS).
    const kabar = await prisma.adminNotification.findMany({
      where: { createdAt: { gte: mulai }, category: "JOURNAL_PENDING" },
      select: { id: true, metadata: true },
    });
    const kabarPo = kabar.filter((k) => (k.metadata as { docId?: string } | null)?.docId === poId).map((k) => k.id);
    if (kabarPo.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(kabarPo) } } });
    const antre = await prisma.notificationQueue.findMany({
      where: { createdAt: { gte: mulai }, type: "PO_PAYMENT_TOGGLED" },
      select: { id: true, data: true },
    });
    const antrePo = antre.filter((k) => (k.data as { poId?: string } | null)?.poId === poId).map((k) => k.id);
    if (antrePo.length) await prisma.notificationQueue.deleteMany({ where: { id: { in: seededIds(antrePo) } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: [seededId(poId), seededId(poLainId)] } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({
      where: {
        id: { in: [seededId(disetujuiId), seededId(berdokumenId), seededId(tanpaDokumenId), seededId(hanyaPoId)] },
      },
    });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  beforeEach(() => {
    sesi.ada = true;
    sesi.id = userId;
    sesi.permissions = [];
  });

  describe("getPemasokPilihan", () => {
    it("menolak tanpa izin baca dokumen pembelian", async () => {
      sesi.permissions = ["pwa:access"];
      await expect(po.getPemasokPilihan()).rejects.toThrow(/Forbidden/);
    });

    it("pemasok disetujui + pemasok yang punya dokumen (ditandai belum disetujui); tanpa dokumen tidak", async () => {
      sesi.permissions = ["supplier_payments:view"];
      const daftar = await po.getPemasokPilihan();
      const per = new Map(daftar.map((p) => [p.id, p]));
      expect(per.get(disetujuiId)).toMatchObject({ code: `SUP-A-${token}`, disetujui: true });
      expect(per.get(berdokumenId)).toMatchObject({ code: `SUP-B-${token}`, disetujui: false });
      expect(per.get(hanyaPoId)).toMatchObject({ disetujui: false });
      expect(per.has(tanpaDokumenId)).toBe(false);
    });

    it("pemasok dokumen yang sedang diubah ikut walau belum punya dokumen lain", async () => {
      sesi.permissions = ["vendor_returns:view"];
      const daftar = await po.getPemasokPilihan([tanpaDokumenId]);
      expect(daftar.find((p) => p.id === tanpaDokumenId)).toMatchObject({ disetujui: false });
    });
  });

  describe("getRincianGRN", () => {
    it("barang, qty, harga, total, foto, PO, penerima", async () => {
      sesi.permissions = ["inventory:view"];
      const r = await grn.getRincianGRN(grnId);
      expect(r).toMatchObject({
        docNumber: `GRN-LB-${token}`,
        totalAmount: 850_000,
        foto: ["/api/foto/uji-1"],
        po: { id: poId, docNumber: `PO-LB-${token}` },
        supplier: { id: berdokumenId },
        penerima: "Penerima Uji",
        pemilik: { keadaan: null },
      });
      expect(r?.baris).toEqual([
        expect.objectContaining({ sku: `LB-${token}`, nama: "Kancing Eloraé", qty: 50, hargaSatuan: 17_000, total: 850_000 }),
      ]);
      expect(r?.returPemasok).toEqual([]);
    });

    it("tanpa izin inventori ditolak; GRN tidak ada → null", async () => {
      sesi.permissions = ["purchase_orders:view"];
      await expect(grn.getRincianGRN(grnId)).rejects.toThrow(/Forbidden/);
      sesi.permissions = ["inventory:view"];
      await expect(grn.getRincianGRN("grn-tidak-ada")).resolves.toBeNull();
    });
  });

  describe("putuskanGRNPemilik", () => {
    it("bukan pemilik (tanpa *) → TANPA_AKSES", async () => {
      sesi.permissions = ["inventory:manage"];
      expect(await grn.putuskanGRNPemilik(grnId, "setuju")).toEqual({ ok: false, code: "TANPA_AKSES" });
    });

    it("GRN yang tidak menunggu pemilik → TIDAK_MENUNGGU; tidak ada → TIDAK_DITEMUKAN", async () => {
      sesi.permissions = ["*"];
      expect(await grn.putuskanGRNPemilik(grnId, "setuju")).toEqual({ ok: false, code: "TIDAK_MENUNGGU" });
      expect(await grn.putuskanGRNPemilik(grnId, "tolak")).toEqual({ ok: false, code: "TIDAK_MENUNGGU" });
      expect(await grn.putuskanGRNPemilik("grn-tidak-ada", "setuju")).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    });
  });

  describe("retur pemasok", () => {
    it("daftar membawa nomor PO yang dikredit dan kredit sebagai angka", async () => {
      sesi.permissions = ["vendor_returns:view"];
      const hasil = await retur.getVendorReturns({ vendorId: berdokumenId }, { page: 1, pageSize: 10 });
      const proses = (hasil as { items: Array<{ id: string; po: unknown; poCreditAmount: unknown }> }).items.find(
        (r) => r.id === returProsesId,
      );
      expect(proses?.po).toEqual({ id: poId, docNumber: `PO-LB-${token}` });
      expect(proses?.poCreditAmount).toBe(125_000);
      const satu = await retur.getVendorReturnById(returProsesId);
      expect(satu?.po?.docNumber).toBe(`PO-LB-${token}`);
    });

    it("hapus: tanpa izin kelola / bukan draf / tidak ada / draf terhapus", async () => {
      sesi.permissions = ["vendor_returns:view"];
      expect(await retur.hapusReturPemasok(returDrafId)).toEqual({ ok: false, code: "TANPA_AKSES" });
      sesi.permissions = ["vendor_returns:manage"];
      expect(await retur.hapusReturPemasok(returProsesId)).toEqual({ ok: false, code: "BUKAN_DRAF" });
      expect(await retur.hapusReturPemasok("retur-tidak-ada")).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
      expect(await retur.hapusReturPemasok(returDrafId)).toEqual({ ok: true });
      expect(await prisma.vendorReturn.count({ where: { id: seededId(returDrafId) } })).toBe(0);
      expect(await prisma.vendorReturn.count({ where: { id: seededId(returProsesId) } })).toBe(1);
    });
  });

  describe("PO", () => {
    it("getPOById: GRN membawa keadaan terima-lebih (yang ditolak pemilik tidak tampil seperti penerimaan biasa)", async () => {
      sesi.permissions = ["purchase_orders:view"];
      const p = await po.getPOById(poId);
      const per = new Map((p?.grns ?? []).map((g) => [g.id, g.keadaanPemilik]));
      expect(per.get(grnId)).toBeNull();
      expect(per.get(grnDitolakId)).toBe("ditolak");
    });

    it("batalkanPO tanpa alasan → ALASAN_WAJIB, PO tidak berubah", async () => {
      sesi.permissions = ["purchase_orders:edit"];
      expect(await po.batalkanPO(poId, "   ", "123456")).toEqual({ ok: false, code: "ALASAN_WAJIB" });
      expect((await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true } }))?.status).toBe("SUBMITTED");
    });

    it("setPOPaidAt dengan tanggal besok ditolak tanpa menulis apa pun", async () => {
      sesi.permissions = ["purchase_orders:edit"];
      const besok = new Date(Date.now() + 36 * 3600 * 1000);
      expect(await po.setPOPaidAt(poId, besok)).toEqual({ changed: false, refusal: "TANGGAL_TIDAK_SAH", journalFailure: null });
      expect((await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { paidAt: true } }))?.paidAt).toBeNull();
      expect(await prisma.pOStatusHistory.count({ where: { poId: seededId(poId) } })).toBe(0);
    });
  });
});
