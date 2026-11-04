import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Ringkasan harian terhadap basis data uji. `kirimRingkasanHarian` menyapu
 * SEMUA sales bila tidak dibatasi — di sini selalu dipanggil dengan
 * `salesmanIds` berisi pengguna buatan tes, pada tanggal lampau yang acak.
 * Kabar dan sebaran lonceng dipalsukan: tes tidak boleh menulis antrean kabar
 * atau mengirim push ke HP sungguhan.
 */
const { mockKabar, mockSebar } = vi.hoisted(() => ({ mockKabar: vi.fn(), mockSebar: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: mockKabar,
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: mockSebar }));
// Modul kabar asli ikut dimuat (untuk `JENIS_KABAR`); Firebase Admin-nya tidak perlu hidup.
vi.mock("@/lib/firebase/admin", () => ({ messaging: null }));

import { KATEGORI_RINGKASAN_SALES, kirimRingkasanHarian } from "./ringkasan-harian";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const tahun = acak(2001, 2019);
const bulan = String(acak(1, 11)).padStart(2, "0");
const HARI = `${tahun}-${bulan}-${String(acak(10, 20)).padStart(2, "0")}`;
/** Hari lain di bulan sesudahnya — tidak ada kegiatan sama sekali. */
const HARI_SEPI = `${tahun}-${String(Number(bulan) + 1).padStart(2, "0")}-05`;
const jam = (hhmm: string) => new Date(`${HARI}T${hhmm}:00+07:00`);
const rapi = (s: unknown) => String(s).replace(/\u00a0/g, " ");

d("kirimRingkasanHarian (test bed only)", () => {
  let aktif = "";
  let diam = "";
  let storeId = "";
  let visitIds: string[] = [];
  let orderId = "";
  let notifIds: string[] = [];

  beforeAll(async () => {
    aktif = "";
    diam = "";
    storeId = "";
    visitIds = [];
    orderId = "";
    notifIds = [];

    aktif = (await prisma.user.create({ data: { email: `ringkasan-a-${token}@test.local`, name: "Aktif" } })).id;
    diam = (await prisma.user.create({ data: { email: `ringkasan-b-${token}@test.local`, name: "Diam" } })).id;
    storeId = (
      await prisma.store.create({ data: { code: `T-RH-${token}`, name: "Toko RH", address: "x", termsType: "PUTUS" } })
    ).id;
    const v1 = await prisma.storeVisit.create({
      data: { storeId, userId: aktif, checkinAt: jam("09:00"), checkoutAt: jam("09:30"), checkinLat: 0, checkinLng: 0 },
    });
    const v2 = await prisma.storeVisit.create({
      data: {
        storeId,
        userId: aktif,
        checkinAt: jam("14:00"),
        checkoutAt: jam("14:10"),
        checkinLat: 0,
        checkinLng: 0,
        outcome: "TOKO_TUTUP",
      },
    });
    visitIds = [v1.id, v2.id];
    orderId = (
      await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `T-RH-${token}`,
          storeId,
          salesmanId: aktif,
          visitId: v1.id,
          subtotal: 1_500_000,
          total: 1_500_000,
          createdAt: jam("09:10"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([aktif, diam].filter(Boolean)) } } });
  });

  it("satu kabar per sales yang berkegiatan, satu ringkasan tim untuk atasan", async () => {
    const hasil = await kirimRingkasanHarian(HARI, { salesmanIds: [aktif, diam], sekarang: jam("18:30") });
    if (hasil.status === "TERKIRIM") notifIds.push(hasil.adminNotificationId);
    expect(hasil).toMatchObject({ status: "TERKIRIM", tanggal: HARI, salesDikabari: [aktif] });

    expect(mockKabar).toHaveBeenCalledTimes(1);
    const [penerima, kabar] = mockKabar.mock.calls[0];
    expect(penerima).toBe(aktif);
    expect(kabar.jenis).toBe("RINGKASAN_HARIAN");
    // Pesanan itu transaksi PERTAMA toko tersebut, jadi tokonya terhitung toko baru.
    expect(rapi(kabar.isi)).toBe("2 kunjungan · 1 pesanan Rp 1,5 jt · 1 toko baru");
    expect(kabar.data).toEqual({ tanggal: HARI });

    const baris = await prisma.adminNotification.findUniqueOrThrow({
      where: { id: hasil.status === "TERKIRIM" ? hasil.adminNotificationId : "" },
    });
    expect(baris.category).toBe(KATEGORI_RINGKASAN_SALES);
    expect(rapi(baris.message)).toBe(
      "1 sales aktif · 2 kunjungan (efektif 50%) · 1 pesanan Rp 1,5 jt · 1 toko baru",
    );
    expect(baris.metadata).toMatchObject({
      tanggal: HARI,
      href: `/backoffice/sales-lapangan?rentang=kustom&dari=${HARI}&sampai=${HARI}`,
      salesAktif: 1,
    });
    expect(mockSebar).toHaveBeenCalledTimes(1);
    expect(mockSebar.mock.calls[0][0].id).toBe(baris.id);
  });

  it("dijalankan lagi untuk tanggal yang sama: tidak mengirim apa pun", async () => {
    const hasil = await kirimRingkasanHarian(HARI, { salesmanIds: [aktif, diam], sekarang: jam("19:00") });
    expect(hasil).toEqual({ status: "SUDAH_TERKIRIM", tanggal: HARI, adminNotificationId: notifIds[0] });
    expect(mockKabar).toHaveBeenCalledTimes(1);
    expect(mockSebar).toHaveBeenCalledTimes(1);
    const baris = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_RINGKASAN_SALES, id: { in: seededIds(notifIds) } },
    });
    expect(baris).toHaveLength(1);
  });

  it("instan dibaca sebagai hari WIB-nya", async () => {
    // Instan 23.30 WIB dibaca sebagai hari WIB-nya, jadi penandanya sama dengan panggilan pertama.
    const hasil = await kirimRingkasanHarian(jam("23:30"), { salesmanIds: [aktif] });
    expect(hasil.status).toBe("SUDAH_TERKIRIM");
  });

  it("hari tanpa kegiatan: tidak menulis penanda dan tidak mengabari siapa pun", async () => {
    const sebelum = await prisma.adminNotification.count({ where: { category: KATEGORI_RINGKASAN_SALES } });
    const hasil = await kirimRingkasanHarian(HARI_SEPI, { salesmanIds: [aktif, diam] });
    expect(hasil).toEqual({ status: "SEPI", tanggal: HARI_SEPI });
    expect(await prisma.adminNotification.count({ where: { category: KATEGORI_RINGKASAN_SALES } })).toBe(sebelum);
    expect(mockKabar).toHaveBeenCalledTimes(1);
  });

  it("tanggal tidak sah ditolak", async () => {
    await expect(kirimRingkasanHarian("2026-02-30")).rejects.toThrow("tanggal tidak sah");
  });
});
