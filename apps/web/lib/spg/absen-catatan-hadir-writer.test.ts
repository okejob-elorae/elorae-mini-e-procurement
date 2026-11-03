import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ENTITAS_CATATAN_HADIR, JEJAK_CATATAN_HADIR, KATEGORI_NOTIF_CATATAN_HADIR } from "./absen-catatan-hadir";
import { kembalikanCatatanHadir, periksaCatatanHadir, simpanCatatanHadir } from "./absen-catatan-hadir-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Catatan check-in toko SPG terhadap basis data sungguhan (P7d, P7e, P61, P61a): kantor
 * memasukkannya (DIAJUKAN), orang LAIN memeriksanya — tidak ada yang memeriksa catatan yang ikut ia
 * simpan sejak pemeriksaan terakhir, admin juga — atau mengembalikannya dengan catatan. Setiap
 * langkah tukar-bandingkan (status, version) di dalam `runSerializable`, jejaknya di transaksi yang
 * sama. Semua baris diseed di sini dan dihapus lewat `seededId(s)`; notifikasi dicocokkan lewat
 * metadata.
 */
d("catatan check-in toko SPG (test bed only)", () => {
  const tag = `CHT${Math.random().toString(36).slice(2, 8)}`;
  const BULAN = "2026-10";
  const sekarang = new Date("2026-11-05T09:00:00+07:00");
  let toko = "";
  let dewi = "";
  let pencatat = "";
  let pembetul = "";
  let pemeriksa = "";

  const orangIds = () => [dewi, pencatat, pembetul, pemeriksa].filter(Boolean);
  const HARI = [
    { day: "2026-10-01", kind: "KERJA", present: true, note: null },
    { day: "2026-10-02", kind: "KERJA", present: false, note: "tidak datang" },
    { day: "2026-10-03", kind: "LIBUR", present: false, note: null },
  ];
  const catatan = () =>
    prisma.spgAttendanceRecord.findUniqueOrThrow({
      where: { userId_month: { userId: dewi, month: BULAN } },
      select: { id: true, status: true, version: true, checkedById: true, returnNote: true, days: { select: { day: true } } },
    });
  const simpan = (olehUserId: string, versi: number | null, hari: unknown = HARI) =>
    simpanCatatanHadir({ userId: dewi, bulan: BULAN, hari, sumber: "MANUAL", versi, olehUserId, sekarang });
  const notifMilik = async (category: string) =>
    (await prisma.adminNotification.findMany({ where: { category }, select: { metadata: true } })).filter(
      (n) => (n.metadata as Record<string, unknown> | null)?.userId === dewi,
    );

  beforeAll(async () => {
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    dewi = (await prisma.user.create({ data: { email: `${tag}-dewi@test.local`, name: `Dewi ${tag}`, assignedStoreId: toko, spgStartedOn: "2026-10-01" } })).id;
    const kantor = async (nama: string) => (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`, name: `${nama} ${tag}` } })).id;
    pencatat = await kantor("pencatat");
    pembetul = await kantor("pembetul");
    pemeriksa = await kantor("pemeriksa");
  });

  afterEach(async () => {
    const rec = await prisma.spgAttendanceRecord.findMany({ where: { userId: seededId(dewi) }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: ENTITAS_CATATAN_HADIR, entityId: { in: seededIds(rec.map((r) => r.id)) } } });
    const notif = await prisma.adminNotification.findMany({
      where: { category: { in: [KATEGORI_NOTIF_CATATAN_HADIR.DIAJUKAN, KATEGORI_NOTIF_CATATAN_HADIR.DIKEMBALIKAN] } },
      select: { id: true, metadata: true },
    });
    await prisma.adminNotification.deleteMany({
      where: { id: { in: seededIds(notif.filter((n) => (n.metadata as Record<string, unknown> | null)?.userId === dewi).map((n) => n.id)) } },
    });
    await prisma.spgAttendanceRecordDay.deleteMany({ where: { recordId: { in: seededIds(rec.map((r) => r.id)) } } });
    await prisma.spgAttendanceRecord.deleteMany({ where: { userId: seededId(dewi) } });
    await prisma.spgCommission.deleteMany({ where: { storeId: seededId(toko) } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds(orangIds()) } } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
  });

  it("simpan → DIAJUKAN, menunggu diperiksa, dengan jejak potret hari di transaksi yang sama", async () => {
    expect(await simpan(pencatat, null)).toEqual({ ok: true, versi: 1 });
    const c = await catatan();
    expect([c.status, c.version, c.days.length]).toEqual(["DIAJUKAN", 1, 3]);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: ENTITAS_CATATAN_HADIR, entityId: c.id }, select: { action: true, changes: true } });
    expect(jejak).toEqual([
      expect.objectContaining({
        action: JEJAK_CATATAN_HADIR.DIMASUKKAN,
        changes: expect.objectContaining({ before: null, after: expect.objectContaining({ hari: { "2026-10-01": "KERJA:YA", "2026-10-02": "KERJA:TIDAK", "2026-10-03": "LIBUR:TIDAK" } }) }),
      }),
    ]);
    expect(await notifMilik(KATEGORI_NOTIF_CATATAN_HADIR.DIAJUKAN)).toHaveLength(1);
    // Versi yang dilihat layar sudah basi: tidak menulis apa pun.
    expect(await simpan(pencatat, null)).toEqual({ ok: false, kode: "CATATAN_BERUBAH" });
  });

  it("hari di luar masa kerja, hari depan, dan hari ganda ditolak per baris tanpa menulis apa pun", async () => {
    const r = await simpan(pencatat, null, [
      { day: "2026-09-30", kind: "KERJA", present: true },
      { day: "2026-11-06", kind: "KERJA", present: true },
      { day: "2026-10-04", kind: "KERJA", present: true },
      { day: "2026-10-04", kind: "KERJA", present: true },
    ]);
    expect(r).toMatchObject({ ok: false, galat: [{ baris: 1, kode: "DI_LUAR_MASA_KERJA" }, { baris: 2, kode: "HARI_DEPAN" }, { baris: 4, kode: "HARI_GANDA" }] });
    expect(await prisma.spgAttendanceRecord.count({ where: { userId: seededId(dewi) } })).toBe(0);
  });

  it("tidak ada yang memeriksa catatan yang ikut ia simpan sejak pemeriksaan terakhir; orang lain → DIPERIKSA; simpan lagi membuka ulang", async () => {
    await simpan(pencatat, null);
    let c = await catatan();
    expect(await periksaCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pencatat })).toEqual({ ok: false, kode: "PEMERIKSA_SAMA" });
    // Orang kedua membetulkan satu hari: yang mengetik sebagian besar hari tetap tidak boleh memeriksa.
    expect((await simpan(pembetul, c.version)).ok).toBe(true);
    c = await catatan();
    expect(await periksaCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pencatat })).toEqual({ ok: false, kode: "PEMERIKSA_SAMA" });
    expect(await periksaCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pembetul })).toEqual({ ok: false, kode: "PEMERIKSA_SAMA" });
    expect(await periksaCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pemeriksa })).toEqual({ ok: true });
    expect((await catatan()).status).toBe("DIPERIKSA");

    // Disimpan lagi sesudah diperiksa: kembali DIAJUKAN, versi naik, pemeriksaannya hilang.
    expect(await simpan(pemeriksa, c.version)).toEqual({ ok: true, versi: c.version + 1 });
    const lagi = await catatan();
    expect([lagi.status, lagi.version, lagi.checkedById]).toEqual(["DIAJUKAN", c.version + 1, null]);
    // Sejak pemeriksaan terakhir hanya `pemeriksa` yang menyimpan: kini `pencatat` boleh memeriksa.
    expect(await periksaCatatanHadir({ recordId: lagi.id, versi: lagi.version, olehUserId: pemeriksa })).toEqual({ ok: false, kode: "PEMERIKSA_SAMA" });
    expect(await periksaCatatanHadir({ recordId: lagi.id, versi: lagi.version, olehUserId: pencatat })).toEqual({ ok: true });
  });

  it("kembalikan butuh catatan; dikembalikan → DIKEMBALIKAN dengan catatannya dan notifikasi ke yang memasukkan", async () => {
    await simpan(pencatat, null);
    const c = await catatan();
    expect(await kembalikanCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pemeriksa, catatan: "  " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await kembalikanCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pemeriksa, catatan: "tanggal 2 hadir di kertas" })).toEqual({ ok: true });
    expect(await catatan()).toMatchObject({ status: "DIKEMBALIKAN", returnNote: "tanggal 2 hadir di kertas" });
    expect(await notifMilik(KATEGORI_NOTIF_CATATAN_HADIR.DIKEMBALIKAN)).toHaveLength(1);
  });

  it("catatan bulan yang gajinya sudah dibayar tidak bisa disimpan atau diperiksa lagi", async () => {
    await simpan(pencatat, null);
    const c = await catatan();
    await prisma.spgCommission.create({
      data: { userId: dewi, storeId: toko, period: BULAN, unitsSold: 0, commission: 0, basis: "TARIF_KATEGORI", lockedById: pemeriksa, paidAt: sekarang, paidById: pemeriksa },
    });
    expect(await simpan(pencatat, c.version)).toEqual({ ok: false, kode: "SUDAH_DIBAYAR" });
    expect(await periksaCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pemeriksa })).toEqual({ ok: false, kode: "SUDAH_DIBAYAR" });
  });

  it("balapan periksa vs simpan ulang atas versi yang sama: catatan tidak pernah berakhir DIPERIKSA dengan hari yang tidak dilihat pemeriksa", async () => {
    await simpan(pencatat, null);
    const c = await catatan();
    const ubah = [...HARI.slice(0, 2), { day: "2026-10-03", kind: "KERJA", present: true, note: null }];
    const [periksa, ulang] = await Promise.all([
      periksaCatatanHadir({ recordId: c.id, versi: c.version, olehUserId: pemeriksa }),
      simpan(pencatat, c.version, ubah),
    ]);
    // Simpan ulang selalu masuk (tukar-bandingkan versinya, yang tidak dinaikkan pemeriksaan): kalau
    // pemeriksaan lebih dulu, simpanan itu membuka ulang catatannya; kalau simpanan lebih dulu,
    // pemeriksaan atas versi lama ditolak.
    expect(ulang).toEqual({ ok: true, versi: c.version + 1 });
    if (!periksa.ok) expect(periksa).toEqual({ ok: false, kode: "CATATAN_BERUBAH" });
    const akhir = await catatan();
    expect([akhir.status, akhir.version, akhir.checkedById]).toEqual(["DIAJUKAN", c.version + 1, null]);
  });
});
