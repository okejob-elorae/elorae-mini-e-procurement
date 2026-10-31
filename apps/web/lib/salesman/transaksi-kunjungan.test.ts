import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { adaTransaksiKunjungan } from "./transaksi-kunjungan";

/*
 * "Ada transaksi" sebuah kunjungan — dasar check-out tanpa alasan. Terhadap
 * basis data uji: semua baris milik fixture tes ini (pengguna, toko, kunjungan
 * berkode acak) dan teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `TRK-${Math.random().toString(36).slice(2, 10)}`;

d("adaTransaksiKunjungan (test bed only)", () => {
  let sales = "";
  let salesLain = "";
  let toko = "";
  let visitId = "";
  let checkinAt = new Date();
  let nomorKe = 0;
  const nomor = (awal: string) => `${tag}-${awal}-${nomorKe++}`;

  const dibuat = {
    pesanan: [] as string[],
    klaim: [] as string[],
    retur: [] as string[],
    tukarFaktur: [] as string[],
    van: [] as string[],
  };

  beforeAll(async () => {
    const pengguna = async (n: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}` } })).id;
    sales = await pengguna("sales");
    salesLain = await pengguna("sales2");
    toko = (
      await prisma.store.create({
        data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "x", termsType: "PUTUS", isActive: true, salesmanId: sales },
      })
    ).id;
  });

  beforeEach(async () => {
    visitId = "";
    dibuat.pesanan = [];
    dibuat.klaim = [];
    dibuat.retur = [];
    dibuat.tukarFaktur = [];
    dibuat.van = [];
    checkinAt = new Date(Date.now() - 3_600_000);
    visitId = (await prisma.storeVisit.create({ data: { storeId: toko, userId: sales, checkinLat: 0, checkinLng: 0, checkinAt } })).id;
  });

  afterEach(async () => {
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(dibuat.pesanan) } } });
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(dibuat.klaim) } } });
    await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(dibuat.retur) } } });
    await prisma.collectionNote.deleteMany({ where: { id: { in: seededIds(dibuat.tukarFaktur) } } });
    await prisma.vanSale.deleteMany({ where: { id: { in: seededIds(dibuat.van) } } });
    if (visitId) await prisma.storeVisit.delete({ where: { id: seededId(visitId) } });
  });

  afterAll(async () => {
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain].filter(Boolean)) } } });
  });

  const cek = () => adaTransaksiKunjungan({ visitId, userId: sales, storeId: toko, sejak: checkinAt });

  type StatusPesanan = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  const pesanan = async (status: StatusPesanan, extra: { cancelledById?: string; replacesOrderId?: string; visitId?: string | null } = {}) => {
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: nomor("PO"),
        storeId: toko,
        salesmanId: sales,
        visitId: extra.visitId === undefined ? visitId : extra.visitId,
        status,
        subtotal: 10_000,
        total: 10_000,
        cancelledById: extra.cancelledById ?? null,
        cancelledAt: extra.cancelledById ? new Date() : null,
        replacesOrderId: extra.replacesOrderId ?? null,
        rejectedAt: status === "REJECTED" ? new Date() : null,
      },
    });
    dibuat.pesanan.push(o.id);
    return o.id;
  };

  const klaim = async (status: "DIKIRIM" | "TERVERIFIKASI" | "DITOLAK" | "DIBATALKAN") => {
    const c = await prisma.paymentClaim.create({
      data: { docNo: nomor("BKM"), storeId: toko, salesmanId: sales, createdById: sales, claimedTransferAt: new Date(), status },
    });
    dibuat.klaim.push(c.id);
  };

  const retur = async (status: "MENUNGGU" | "COCOK" | "SELISIH" | "BATAL") => {
    const r = await prisma.storeReturn.create({
      data: { noNrt: nomor("NRT"), storeId: toko, salesmanId: sales, claimDate: new Date(), claimedAmount: 5_000, status },
    });
    dibuat.retur.push(r.id);
  };

  const tukarFaktur = async (status: "BERJALAN" | "SELESAI" | "BATAL") => {
    const n = await prisma.collectionNote.create({
      data: { docNo: nomor("TF"), storeId: toko, salesmanId: sales, handoverDate: new Date(), promisedDate: new Date(), status, source: "FIELD" },
    });
    dibuat.tukarFaktur.push(n.id);
  };

  describe("pesanan", () => {
    it("kunjungan tanpa dokumen apa pun: tidak ada transaksi", async () => {
      expect(await cek()).toBe(false);
    });

    it("pesanan yang masih menunggu dihitung", async () => {
      await pesanan("PENDING_APPROVAL");
      expect(await cek()).toBe(true);
    });

    it("pesanan yang disetujui dihitung", async () => {
      await pesanan("APPROVED");
      expect(await cek()).toBe(true);
    });

    it("pesanan yang DIBATALKAN salesman tidak dihitung — membuat lalu membatalkan tidak menggantikan alasan", async () => {
      await pesanan("REJECTED", { cancelledById: sales });
      expect(await cek()).toBe(false);
    });

    it("pesanan yang DITOLAK kantor tidak dihitung", async () => {
      await pesanan("REJECTED");
      expect(await cek()).toBe(false);
    });

    it("pesanan yang DIGANTI dihitung lewat penggantinya yang hidup (pengganti membawa kunjungan lama)", async () => {
      const lama = await pesanan("REJECTED", { cancelledById: sales });
      await pesanan("PENDING_APPROVAL", { replacesOrderId: lama });
      expect(await cek()).toBe(true);
    });

    it("pengganti yang kemudian dibatalkan juga: tidak ada transaksi lagi", async () => {
      const lama = await pesanan("REJECTED", { cancelledById: sales });
      await pesanan("REJECTED", { cancelledById: sales, replacesOrderId: lama });
      expect(await cek()).toBe(false);
    });

    it("pesanan hidup dari kunjungan LAIN tidak dihitung untuk kunjungan ini", async () => {
      await pesanan("PENDING_APPROVAL", { visitId: null });
      expect(await cek()).toBe(false);
    });
  });

  describe("laporan lain: yang ditarik atau dibatalkan tidak dihitung", () => {
    it("BKM terkirim dihitung, BKM yang dibatalkan tidak", async () => {
      await klaim("DIBATALKAN");
      expect(await cek()).toBe(false);
      await klaim("DIKIRIM");
      expect(await cek()).toBe(true);
    });

    it("BKM yang DITOLAK keuangan tidak dihitung — uangnya tidak pernah diakui", async () => {
      await klaim("DITOLAK");
      expect(await cek()).toBe(false);
      await klaim("TERVERIFIKASI");
      expect(await cek()).toBe(true);
    });

    it("NRT menunggu dihitung, NRT yang batal tidak", async () => {
      await retur("BATAL");
      expect(await cek()).toBe(false);
      await retur("MENUNGGU");
      expect(await cek()).toBe(true);
    });

    it("tukar faktur berjalan dihitung, yang batal tidak", async () => {
      await tukarFaktur("BATAL");
      expect(await cek()).toBe(false);
      await tukarFaktur("BERJALAN");
      expect(await cek()).toBe(true);
    });

    it("penjualan kanvas di toko ini dihitung (tidak punya pembatalan)", async () => {
      const v = await prisma.vanSale.create({
        data: { docNo: nomor("VS"), salesmanId: sales, storeId: toko, subtotal: 1_000, total: 1_000, amountPaid: 1_000, changeAmount: 0 },
      });
      dibuat.van.push(v.id);
      expect(await cek()).toBe(true);
    });

    it("laporan orang lain di toko yang sama tidak dihitung", async () => {
      const c = await prisma.paymentClaim.create({
        data: { docNo: nomor("BKM"), storeId: toko, salesmanId: salesLain, createdById: salesLain, claimedTransferAt: new Date() },
      });
      dibuat.klaim.push(c.id);
      expect(await cek()).toBe(false);
    });
  });
});
