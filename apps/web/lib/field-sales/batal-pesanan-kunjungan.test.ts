import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Keputusan pemilik 2026-10-06 (sementara): salesman membatalkan pesanannya
 * sesudah check-out → kunjungan yang tercatat `TRANSAKSI` HANYA karena pesanan
 * itu dibetulkan (hasilnya kosong) di transaksi pembatalan yang sama, dengan
 * jejak `STORE_VISIT_OUTCOME_CORRECTED`. Terhadap basis data uji; teardown
 * lewat id yang diseed.
 */
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: vi.fn() }));

import { cancelFieldSalesOrderBySalesman } from "./writer";
import { AKSI_HASIL_KUNJUNGAN_DIBETULKAN } from "@/lib/salesman/transaksi-kunjungan";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `BPK-${Math.random().toString(36).slice(2, 10)}`;

d("batal pesanan sesudah check-out membetulkan hasil kunjungan (test bed only)", () => {
  let sales = "";
  let toko = "";
  let visitId = "";
  let nomorKe = 0;
  const nomor = (awal: string) => `${tag}-${awal}-${nomorKe++}`;
  const dibuat = { pesanan: [] as string[], klaim: [] as string[] };

  beforeAll(async () => {
    sales = (await prisma.user.create({ data: { email: `${tag}-sales@test.local`.toLowerCase(), name: `sales ${tag}` } })).id;
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
    visitId = (
      await prisma.storeVisit.create({
        data: { storeId: toko, userId: sales, checkinLat: 0, checkinLng: 0, checkinAt: new Date(Date.now() - 3_600_000) },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesOrder", entityId: { in: seededIds(dibuat.pesanan) } } });
    if (visitId) await prisma.auditLog.deleteMany({ where: { entityType: "StoreVisit", entityId: seededId(visitId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(dibuat.pesanan) } } });
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(dibuat.klaim) } } });
    if (visitId) await prisma.storeVisit.delete({ where: { id: seededId(visitId) } });
  });

  afterAll(async () => {
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
    if (sales) await prisma.user.delete({ where: { id: seededId(sales) } });
  });

  // Pesanan tanpa baris: pembatalan tidak menyentuh stok, cukup untuk menguji hasil kunjungan.
  const pesanan = async () => {
    const o = await prisma.fieldSalesOrder.create({
      data: { orderNo: nomor("PO"), storeId: toko, salesmanId: sales, visitId, status: "PENDING_APPROVAL", subtotal: 50_000, total: 50_000 },
    });
    dibuat.pesanan.push(o.id);
    return o.id;
  };
  const checkOut = (outcome: string | null) =>
    prisma.storeVisit.update({ where: { id: visitId }, data: { checkoutAt: new Date(), outcome } });
  const kunjungan = () => prisma.storeVisit.findUniqueOrThrow({ where: { id: visitId } });
  const jejak = () => prisma.auditLog.findMany({ where: { entityType: "StoreVisit", entityId: visitId } });
  const batal = (orderId: string) => cancelFieldSalesOrderBySalesman({ orderId, salesmanId: sales, reason: "Toko batal pesan" });

  it("satu-satunya pesanan dibatalkan sesudah check-out: hasil TRANSAKSI dicabut + jejak dengan alasan dan nomor pesanan", async () => {
    const o = await pesanan();
    await checkOut("TRANSAKSI");

    await batal(o);

    const v = await kunjungan();
    expect(v.outcome).toBeNull();
    expect(v.outcomeNote).toBeNull();
    const j = await jejak();
    expect(j).toHaveLength(1);
    expect(j[0].action).toBe(AKSI_HASIL_KUNJUNGAN_DIBETULKAN);
    expect(j[0].userId).toBe(sales);
    expect(j[0].reason).toBe("Toko batal pesan");
    expect(j[0].changes).toMatchObject({ before: { outcome: "TRANSAKSI" }, after: { outcome: null } });
    const nomorPesanan = (await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: o } })).orderNo;
    expect(j[0].metadata).toMatchObject({ orderId: o, orderNo: nomorPesanan });
  });

  it("masih ada pesanan hidup lain di kunjungan itu: TRANSAKSI tetap, tanpa jejak", async () => {
    const a = await pesanan();
    await pesanan();
    await checkOut("TRANSAKSI");

    await batal(a);

    expect((await kunjungan()).outcome).toBe("TRANSAKSI");
    expect(await jejak()).toHaveLength(0);
  });

  it("masih ada BKM terkirim dari kunjungan itu: TRANSAKSI tetap", async () => {
    const a = await pesanan();
    const c = await prisma.paymentClaim.create({
      data: { docNo: nomor("BKM"), storeId: toko, salesmanId: sales, createdById: sales, claimedTransferAt: new Date(), status: "DIKIRIM" },
    });
    dibuat.klaim.push(c.id);
    await checkOut("TRANSAKSI");

    await batal(a);

    expect((await kunjungan()).outcome).toBe("TRANSAKSI");
  });

  it("BKM yang DITOLAK tidak menahan TRANSAKSI: hasilnya tetap dicabut", async () => {
    const a = await pesanan();
    const c = await prisma.paymentClaim.create({
      data: { docNo: nomor("BKM"), storeId: toko, salesmanId: sales, createdById: sales, claimedTransferAt: new Date(), status: "DITOLAK" },
    });
    dibuat.klaim.push(c.id);
    await checkOut("TRANSAKSI");

    await batal(a);

    expect((await kunjungan()).outcome).toBeNull();
  });

  it("kunjungan masih terbuka: tidak disentuh (check-out yang menilai)", async () => {
    const a = await pesanan();

    await batal(a);

    const v = await kunjungan();
    expect(v.checkoutAt).toBeNull();
    expect(v.outcome).toBeNull();
    expect(await jejak()).toHaveLength(0);
  });

  it("hasil selain TRANSAKSI (TRANSAKSI_TERTUNDA) dibiarkan", async () => {
    const a = await pesanan();
    await checkOut("TRANSAKSI_TERTUNDA");

    await batal(a);

    expect((await kunjungan()).outcome).toBe("TRANSAKSI_TERTUNDA");
    expect(await jejak()).toHaveLength(0);
  });

  it("pembatalan ulang (ketuk ganda) tidak menulis jejak kedua", async () => {
    const a = await pesanan();
    await checkOut("TRANSAKSI");

    await batal(a);
    await batal(a);

    expect(await jejak()).toHaveLength(1);
  });

  it("balapan: dua pesanan terakhir dibatalkan serentak → hasil tetap dicabut, tepat satu jejak", async () => {
    const a = await pesanan();
    const b = await pesanan();
    await checkOut("TRANSAKSI");

    await Promise.all([batal(a), batal(b)]);

    expect((await kunjungan()).outcome).toBeNull();
    expect(await jejak()).toHaveLength(1);
  });
});
