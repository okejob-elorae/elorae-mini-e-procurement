import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { kinerjaSpgHarian, kinerjaSpgKantor } from "./kinerja-queries";
import { bacaAturanShift, KUNCI_SHIFT } from "./pengaturan";

/*
 * Kinerja SPG terhadap basis data uji, di bulan Agustus 2026 dengan "sekarang"
 * 20 Agu 12.00 WIB (Kamis), supaya hari-harinya tetap. Semua baris dibuat tes
 * ini dan dihapus lewat id (`seededId`/`seededIds`). Toleransi terlambat
 * dibaca dari pengaturan yang berlaku — tes tidak mengubah pengaturan bersama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `KNJ-${Math.random().toString(36).slice(2, 9)}`;
const BULAN = "2026-08";
const SEKARANG = new Date("2026-08-20T05:00:00Z");
const wib = (day: string, jam: string) => new Date(`${day}T${jam}:00+07:00`);

d("kinerja SPG (test bed only)", () => {
  let uomId = "";
  let item = "";
  let tokoA = "";
  let tokoB = "";
  let s1 = "";
  let s2 = "";
  let s3 = "";
  let pelanggan = "";
  let saleIds: string[] = [];
  let visitIds: string[] = [];
  let leaveIds: string[] = [];
  let requestIds: string[] = [];
  let memberIds: string[] = [];
  let toleransi = 15;

  const jual = async (storeId: string, userId: string, createdAt: Date, baris: { qty: number; bersih: number; kembali?: number }[]) => {
    const total = baris.reduce((s, b) => s + b.bersih, 0);
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}/${saleIds.length + 1}`,
        salesmanId: userId,
        storeId,
        subtotal: total,
        total,
        cashReceived: total,
        changeGiven: 0,
        createdById: userId,
        createdAt,
        lines: {
          create: baris.map((b) => ({ itemId: item, productName: "Kaos Uji", qty: b.qty, unitPrice: b.bersih / b.qty, lineTotal: b.bersih, returnedQty: b.kembali ?? 0 })),
        },
      },
    });
    saleIds.push(s.id);
  };
  const masuk = async (storeId: string, userId: string, at: Date) => {
    visitIds.push((await prisma.storeVisit.create({ data: { storeId, userId, checkinAt: at, checkinLat: 0, checkinLng: 0 } })).id);
  };
  const shift = (userId: string, storeId: string, day: string, kind: "KERJA" | "LIBUR") =>
    prisma.spgShift.create({
      data: {
        userId,
        storeId,
        day,
        kind,
        shiftCode: kind === "KERJA" ? "PAGI" : null,
        startTime: kind === "KERJA" ? "10:00" : null,
        endTime: kind === "KERJA" ? "18:00" : null,
        createdById: userId,
      },
    });

  beforeAll(async () => {
    uomId = "";
    item = "";
    tokoA = "";
    tokoB = "";
    s1 = "";
    s2 = "";
    s3 = "";
    pelanggan = "";
    saleIds = [];
    visitIds = [];
    leaveIds = [];
    requestIds = [];
    memberIds = [];

    const setelan = await prisma.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } });
    toleransi = bacaAturanShift(setelan?.value).toleransiTerlambatMenit;

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    item = (await prisma.item.create({ data: { sku: `${tag}-1`, nameId: "Kaos Uji", nameEn: "Tee", type: "FINISHED_GOOD", uomId } })).id;
    const toko = (k: string) => prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType: "KONSI" } });
    tokoA = (await toko("A")).id;
    tokoB = (await toko("B")).id;
    const orang = (k: string) => prisma.user.create({ data: { email: `${tag}-${k}@test.local`.toLowerCase(), name: `SPG ${k} ${tag}`, assignedStoreId: tokoA } });
    s1 = (await orang("1")).id;
    s2 = (await orang("2")).id;
    // Akun baru, tanpa kegiatan di Agustus: tidak boleh muncul di bulan itu.
    s3 = (await orang("3")).id;

    // s1 di toko A: jadwal Agustus.
    for (const day of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-25"]) await shift(s1, tokoA, day, "KERJA");
    await shift(s1, tokoA, "2026-08-07", "LIBUR");
    // 3 Agu tepat waktu, 4 Agu terlambat (toleransi + 20 menit), 5 Agu tidak masuk, 6 Agu sakit (disetujui).
    await masuk(tokoA, s1, wib("2026-08-03", "09:55"));
    const telat = new Date(wib("2026-08-04", "10:00").getTime() + (toleransi + 20) * 60_000);
    await masuk(tokoA, s1, telat);
    // Check-in kedua di hari yang sama tidak mengubah jam masuk.
    await masuk(tokoA, s1, wib("2026-08-04", "16:00"));
    leaveIds.push(
      (await prisma.leaveRequest.create({ data: { userId: s1, type: "SAKIT", startDay: "2026-08-06", endDay: "2026-08-06", reason: "uji", status: "DISETUJUI" } })).id,
    );
    // s2 di toko A: tanpa jadwal, masuk 4 Agu.
    await masuk(tokoA, s2, wib("2026-08-04", "11:00"));

    // Nota. 3 Agu: 2 nota s1 (yang pertama 2 potong, 1 dikembalikan → bersih Rp100.000). 4 Agu: 1 nota s1, 1 nota s2.
    await jual(tokoA, s1, wib("2026-08-03", "11:00"), [{ qty: 2, bersih: 200_000, kembali: 1 }]);
    await jual(tokoA, s1, wib("2026-08-03", "15:00"), [{ qty: 1, bersih: 50_000 }]);
    await jual(tokoA, s1, wib("2026-08-04", "12:00"), [{ qty: 3, bersih: 150_000 }]);
    await jual(tokoA, s2, wib("2026-08-04", "13:00"), [{ qty: 1, bersih: 80_000 }]);
    // s1 dipinjam ke toko B 10 Agu: baris kedua, tidak mencampuri toko A.
    await jual(tokoB, s1, wib("2026-08-10", "12:00"), [{ qty: 1, bersih: 70_000 }]);

    // Pengunjung: 3 Agu s1 menghitung 10. 4 Agu s1 tidak menghitung, s2 menghitung 3, tutup hari mencatat 8 → s1 dapat 5.
    await prisma.spgVisitorCount.create({ data: { storeId: tokoA, userId: s1, day: "2026-08-03", count: 10, clientUpdatedAt: wib("2026-08-03", "21:00") } });
    await prisma.spgVisitorCount.create({ data: { storeId: tokoA, userId: s2, day: "2026-08-04", count: 3, clientUpdatedAt: wib("2026-08-04", "21:00") } });
    const tutup = (day: string, closedById: string, visitorCount: number | null) =>
      prisma.spgDailyClose.create({
        data: { storeId: tokoA, day, closedById, notaCount: 0, pcs: 0, grossTotal: 0, netTotal: 0, visitorCount },
      });
    await tutup("2026-08-03", s1, null);
    await tutup("2026-08-04", s2, 8);

    // Titip pesan: s1 membuat dua di toko A, satu sudah selesai.
    pelanggan = (await prisma.storeCustomer.create({ data: { storeId: tokoA, name: "Pembeli Uji", phone: `08${Date.now()}`.slice(0, 13), consentAt: SEKARANG, createdById: s1 } })).id;
    const titip = (status: string) =>
      prisma.customerRequest.create({ data: { storeId: tokoA, customerId: pelanggan, description: "Kaos XL", status, createdById: s1, createdAt: wib("2026-08-05", "12:00") } });
    requestIds.push((await titip("MENUNGGU")).id);
    requestIds.push((await titip("SELESAI")).id);

    // Nota 3 Agu 15.00 (s1, toko A) mencatat pembelinya: 1 dari 3 nota s1 di toko A.
    await prisma.spgSale.update({ where: { id: saleIds[1] }, data: { customerId: pelanggan } });
    // Member yang didaftarkan s1: satu di toko A bulan ini, satu di toko B bulan ini, satu di toko A bulan lalu.
    const member = async (storeId: string, joinedAt: Date) =>
      memberIds.push(
        (
          await prisma.member.create({
            data: { phone: `62812${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, name: `Member ${tag}`, consentAt: joinedAt, joinedAt, joinedStoreId: storeId, joinedById: s1 },
          })
        ).id,
      );
    await member(tokoA, wib("2026-08-05", "12:00"));
    await member(tokoB, wib("2026-08-10", "12:00"));
    await member(tokoA, wib("2026-07-31", "23:30"));
  });

  afterAll(async () => {
    await prisma.member.deleteMany({ where: { id: { in: seededIds(memberIds) } } });
    await prisma.customerRequest.deleteMany({ where: { id: { in: seededIds(requestIds) } } });
    await prisma.storeCustomer.deleteMany({ where: { id: seededId(pelanggan) } });
    await prisma.spgDailyClose.deleteMany({ where: { storeId: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.spgVisitorCount.deleteMany({ where: { storeId: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.spgShift.deleteMany({ where: { userId: { in: seededIds([s1, s2, s3].filter(Boolean)) } } });
    await prisma.leaveRequest.deleteMany({ where: { id: { in: seededIds(leaveIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(saleIds) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([s1, s2, s3].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: seededId(item) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("summarises attendance, sales, visitors, day-close compliance, requests and returns per SPG per store", async () => {
    const data = await kinerjaSpgKantor({ bulan: BULAN, storeId: tokoA, sekarang: SEKARANG });
    expect(data.berjalan).toBe(true);
    expect(data.pilihanToko.map((t) => t.id)).toEqual(expect.arrayContaining([tokoA, tokoB]));
    const r1 = data.baris.find((b) => b.userId === s1)!;
    expect(r1).toMatchObject({
      storeId: tokoA,
      bukanTokoTetap: false,
      jadwalDisusun: true,
      // 3–6 Agu; 25 Agu belum tiba, 7 Agu libur.
      hariDijadwalkan: 4,
      hariMasuk: 2,
      terlambatKali: 1,
      terlambatMenit: toleransi + 20,
      tidakMasuk: 1,
      hariIzin: 1,
      nota: 3,
      potong: 5,
      nilai: 300_000,
      rataNota: 100_000,
      pengunjung: 15,
      hariPengunjungDariTutup: 1,
      hariJual: 2,
      hariJualDitutup: 2,
      kepatuhanTutupPersen: 100,
      titipDibuat: 2,
      titipSelesai: 1,
      qtyTerjual: 6,
      qtyKembali: 1,
      // Capaian milik orangnya: nota di toko B ikut (Rp300.000 + Rp70.000).
      nilaiOrang: 370_000,
    });
    expect(r1.konversiPersen).toBeCloseTo(20);
    expect(r1.persenKembali).toBeCloseTo(100 / 6);
    // Pembeli tercatat di 1 dari 3 nota; member baru hanya yang didaftarkan di toko ini, di bulan ini.
    expect(r1).toMatchObject({ notaBerpembeli: 1, memberBaru: 1 });
    expect(r1.persenBerpembeli).toBeCloseTo(100 / 3);

    const r2 = data.baris.find((b) => b.userId === s2)!;
    expect(r2).toMatchObject({
      jadwalDisusun: false,
      hariDijadwalkan: null,
      terlambatKali: null,
      tidakMasuk: null,
      hariMasuk: 1,
      nota: 1,
      pengunjung: 3,
      hariPengunjungDariTutup: 0,
    });
    // Toko A saja: baris toko B milik s1 tidak ikut, dan akun yang baru dibuat sesudah Agustus tidak ada.
    expect(data.baris.filter((b) => [s1, s2, s3].includes(b.userId)).map((b) => [b.userId, b.storeId])).toEqual(
      expect.arrayContaining([
        [s1, tokoA],
        [s2, tokoA],
      ]),
    );
    expect(data.baris.some((b) => b.userId === s3)).toBe(false);
    expect(data.baris.some((b) => b.storeId === tokoB)).toBe(false);
  });

  it("gives an SPG who worked at a second store its own row there, without double-counting leave", async () => {
    const data = await kinerjaSpgKantor({ bulan: BULAN, storeId: null, sekarang: SEKARANG });
    const milik = data.baris.filter((b) => b.userId === s1);
    expect(milik.map((b) => b.storeId).sort()).toEqual([tokoA, tokoB].sort());
    const diB = milik.find((b) => b.storeId === tokoB)!;
    expect(diB).toMatchObject({ bukanTokoTetap: true, nota: 1, nilai: 70_000, hariIzin: 0, jadwalDisusun: false, nilaiOrang: 370_000, notaBerpembeli: 0, persenBerpembeli: 0, memberBaru: 1 });
  });

  it("lists a current SPG with no activity in the running month, with schedule columns empty rather than zero", async () => {
    const sekarang = new Date();
    const data = await kinerjaSpgKantor({ bulan: bulanWib(sekarang), storeId: tokoA, sekarang });
    expect(data.baris.find((b) => b.userId === s3)).toMatchObject({ hariDijadwalkan: null, hariMasuk: 0, nota: 0, pengunjung: null });
  });

  it("builds the daily breakdown for one SPG", async () => {
    const data = await kinerjaSpgHarian({ userId: s1, bulan: BULAN, sekarang: SEKARANG });
    expect(data).not.toBeNull();
    expect(data!.bagian.map((b) => b.storeId).sort()).toEqual([tokoA, tokoB].sort());
    const a = data!.bagian.find((b) => b.storeId === tokoA)!;
    expect(a.hari).toHaveLength(31);
    const hari = (day: string) => a.hari.find((h) => h.day === day)!;
    expect(hari("2026-08-03")).toMatchObject({ status: "HADIR", jamMasuk: "09:55", nota: 2, potong: 2, nilai: 150_000, pengunjung: 10, tutup: true });
    expect(hari("2026-08-04")).toMatchObject({ status: "TERLAMBAT", terlambatMenit: toleransi + 20, pengunjung: 5, pengunjungDariTutup: true });
    expect(hari("2026-08-04").konversiPersen).toBeCloseTo(20);
    expect(hari("2026-08-05")).toMatchObject({ status: "TIDAK_MASUK", titipDibuat: 2 });
    expect(hari("2026-08-06")).toMatchObject({ status: "IZIN", izin: "SAKIT" });
    expect(hari("2026-08-07").shift).toEqual({ jenis: "LIBUR" });
    expect(hari("2026-08-25")).toMatchObject({ depan: true, status: null, shift: { jenis: "KERJA", mulai: "10:00", selesai: "18:00" } });
    expect(await kinerjaSpgHarian({ userId: `${tag}-tidak-ada`, bulan: BULAN, sekarang: SEKARANG })).toBeNull();
  });
});
