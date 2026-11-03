import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ENTITAS_JADWAL_BULAN, JEJAK_JADWAL_BULAN, KATEGORI_NOTIF_JADWAL_BULAN } from "./jadwal-bulan";
import { ajukanJadwalBulan, bukaLagiJadwalBulan, isiJadwalBulanSaya, sentuhJadwalBulan, setujuiJadwalBulan, tolakJadwalBulan } from "./jadwal-bulan-writer";
import { bacaAturanShift, KUNCI_SHIFT } from "./pengaturan";
import { ENTITAS_JADWAL_SPG, type IsianSel } from "./shift";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Jadwal bulanan SPG terhadap basis data sungguhan (P7c): SPG mengisi lalu mengajukan, kantor
 * menyetujui/menolak/membuka lagi dengan tukar-bandingkan (status, version) di dalam
 * `runSerializable`, jejaknya di transaksi yang sama. Bulan yang disetujui kembali DIAJUKAN begitu
 * SPG atau pengubah tanpa `spg_schedules:approve` mengubah selnya. Semua baris diseed di sini dan
 * dihapus lewat `seededId(s)`; notifikasi kantor dicocokkan lewat metadata.
 */
d("jadwal bulanan SPG (test bed only)", () => {
  const tag = `JBS${Math.random().toString(36).slice(2, 8)}`;
  const BULAN = "2027-03";
  const sekarang = new Date("2027-03-10T09:00:00+07:00");
  let toko = "";
  let dewi = "";
  let kantor = "";
  let kode = "";

  const orangIds = () => [dewi, kantor].filter(Boolean);
  const hari = (n: number) => `${BULAN}-${String(n).padStart(2, "0")}`;
  const kerja = (dari: number, sampai: number): IsianSel[] =>
    Array.from({ length: sampai - dari + 1 }, (_, i) => ({ userId: dewi, day: hari(dari + i), isi: { jenis: "KERJA" as const, kode } }));
  const kepala = (month = BULAN) => prisma.spgMonthSchedule.findUniqueOrThrow({ where: { userId_month: { userId: dewi, month } }, select: { status: true, version: true } });

  beforeAll(async () => {
    const aturan = bacaAturanShift((await prisma.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } }))?.value);
    kode = aturan.daftar[0].kode;
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    dewi = (await prisma.user.create({ data: { email: `${tag}-dewi@test.local`, name: `Dewi ${tag}`, assignedStoreId: toko, spgStartedOn: "2027-01-01" } })).id;
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
  });

  afterEach(async () => {
    const jadwal = await prisma.spgMonthSchedule.findMany({ where: { userId: seededId(dewi) }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: ENTITAS_JADWAL_BULAN, entityId: { in: seededIds(jadwal.map((j) => j.id)) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: ENTITAS_JADWAL_SPG, entityId: seededId(toko) } });
    const notif = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_JADWAL_BULAN }, select: { id: true, metadata: true } });
    const milikUji = notif.filter((n) => (n.metadata as Record<string, unknown> | null)?.userId === dewi).map((n) => n.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.spgMonthSchedule.deleteMany({ where: { userId: seededId(dewi) } });
    await prisma.spgShift.deleteMany({ where: { userId: seededId(dewi) } });
    await prisma.spgCommission.deleteMany({ where: { storeId: seededId(toko) } });
    await prisma.storeVisit.deleteMany({ where: { storeId: seededId(toko) } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds(orangIds()) } } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
  });

  const isi = (isian: readonly IsianSel[]) => isiJadwalBulanSaya({ userId: dewi, storeId: toko, bulan: BULAN, isian, sekarang });
  const libur = (n: number): IsianSel[] => [{ userId: dewi, day: hari(n), isi: { jenis: "LIBUR" } }];
  const ajukan = (bulan = BULAN) => ajukanJadwalBulan({ userId: dewi, storeId: toko, bulan, sekarang });

  async function diajukan() {
    expect((await isi(kerja(10, 31))).ok).toBe(true);
    const r = await ajukan();
    expect(r).toMatchObject({ ok: true, status: "DIAJUKAN" });
    return (await kepala()).version;
  }

  it("ajukan ditolak selama hari yang masih bisa diisi kosong; lengkap → DIAJUKAN dengan notifikasi kantor; bulan lalu tidak bisa diajukan", async () => {
    expect((await isi(kerja(10, 30))).ok).toBe(true);
    expect(await ajukan()).toEqual({ ok: false, kode: "JADWAL_BELUM_LENGKAP", hari: [hari(31)] });
    expect((await isi(kerja(31, 31))).ok).toBe(true);
    expect(await ajukan()).toMatchObject({ ok: true, status: "DIAJUKAN" });
    const notif = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_JADWAL_BULAN }, select: { metadata: true } });
    expect(notif.filter((n) => (n.metadata as Record<string, unknown> | null)?.userId === dewi)).toHaveLength(1);
    // Bulan yang sudah lewat tidak bisa diajukan SPG lagi — hari kosongnya ditutup catatan check-in toko.
    expect(await ajukan("2027-02")).toEqual({ ok: false, kode: "BULAN_TIDAK_BOLEH" });
  });

  it("setujui dengan versi yang dilihat → DISETUJUI dengan potret sel di jejak; versi basi ditolak; tidak menyetujui jadwalnya sendiri", async () => {
    const v = await diajukan();
    expect(await setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: dewi, sekarang })).toEqual({ ok: false, kode: "PEMOHON_SAMA" });
    expect(await setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v - 1, olehUserId: kantor, sekarang })).toEqual({ ok: false, kode: "JADWAL_BERUBAH" });
    expect(await prisma.auditLog.count({ where: { action: JEJAK_JADWAL_BULAN.DISETUJUI, userId: seededId(kantor) } })).toBe(0);

    expect(await setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, sekarang })).toMatchObject({ ok: true, status: "DISETUJUI" });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { action: JEJAK_JADWAL_BULAN.DISETUJUI, userId: seededId(kantor) }, select: { changes: true } });
    const sel = (jejak.changes as { after: { sel: Record<string, string> } }).after.sel;
    expect(sel[hari(10)]).toBe(`KERJA:${kode}`);
    expect(Object.keys(sel)).toHaveLength(22);
  });

  it("SPG mengubah bulan yang disetujui → kembali DIAJUKAN, versi naik", async () => {
    const v = await diajukan();
    expect((await setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, sekarang })).ok).toBe(true);
    expect((await isi(libur(15))).ok).toBe(true);
    expect(await kepala()).toEqual({ status: "DIAJUKAN", version: v + 1 });
  });

  it("pengubah kisi kantor atau penyetuju tukar shift tanpa izin menyetujui menurunkan bulan yang disetujui; dengan izin tetap DISETUJUI", async () => {
    const v = await diajukan();
    expect((await setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, sekarang })).ok).toBe(true);
    const sentuh = (sumber: "KANTOR" | "TUKAR", bolehSetujui: boolean) =>
      prisma.$transaction((tx) => sentuhJadwalBulan(tx, { userId: dewi, storeId: toko, hari: [hari(20)], olehUserId: kantor, sumber, bolehSetujui }));

    await sentuh("KANTOR", true);
    expect(await kepala()).toEqual({ status: "DISETUJUI", version: v + 1 });
    await sentuh("TUKAR", true);
    expect(await kepala()).toEqual({ status: "DISETUJUI", version: v + 2 });
    await sentuh("TUKAR", false);
    expect(await kepala()).toEqual({ status: "DIAJUKAN", version: v + 3 });
    expect((await setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v + 3, olehUserId: kantor, sekarang })).ok).toBe(true);
    await sentuh("KANTOR", false);
    expect((await kepala()).status).toBe("DIAJUKAN");
  });

  it("tolak butuh alasan; buka lagi hanya dari DISETUJUI dan ditolak sesudah gaji bulan itu dibayar", async () => {
    const v = await diajukan();
    expect(await tolakJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, alasan: " " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await bukaLagiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, alasan: "salah" })).toEqual({ ok: false, kode: "STATUS_BERUBAH" });
    expect((await setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, sekarang })).ok).toBe(true);

    await prisma.spgCommission.create({
      data: { userId: dewi, storeId: toko, period: BULAN, unitsSold: 0, commission: 0, basis: "TARIF_KATEGORI", lockedById: kantor, paidAt: sekarang, paidById: kantor },
    });
    expect(await bukaLagiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, alasan: "salah" })).toEqual({ ok: false, kode: "SUDAH_DIBAYAR" });
    await prisma.spgCommission.deleteMany({ where: { storeId: seededId(toko) } });
    expect(await bukaLagiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, alasan: "salah" })).toMatchObject({ ok: true, status: "DIAJUKAN" });
  });

  it("bulan yang selnya ada tetapi belum berkepala bisa disetujui kantor pada versi 0", async () => {
    await prisma.spgShift.createMany({
      data: ["2027-02-01", "2027-02-02"].map((day) => ({ userId: dewi, storeId: toko, day, kind: "KERJA", shiftCode: kode, createdById: kantor })),
    });
    expect(await setujuiJadwalBulan({ userId: dewi, bulan: "2027-02", versi: 0, olehUserId: kantor, sekarang })).toMatchObject({ ok: true, status: "DISETUJUI" });
    expect((await kepala("2027-02")).status).toBe("DISETUJUI");
    // Tanpa sel sama sekali tidak ada yang diputuskan.
    expect(await setujuiJadwalBulan({ userId: dewi, bulan: "2027-01", versi: 0, olehUserId: kantor, sekarang })).toEqual({ ok: false, kode: "JADWAL_BERUBAH" });
  });

  it("hari yang sudah ada check-in-nya tidak bisa diubah SPG", async () => {
    expect((await isi(kerja(10, 10))).ok).toBe(true);
    await prisma.storeVisit.create({ data: { storeId: toko, userId: dewi, checkinAt: new Date("2027-03-10T08:05:00+07:00"), checkinLat: 0, checkinLng: 0 } });
    expect(await isi(libur(10))).toEqual({
      ok: false,
      kode: "HARI_SUDAH_HADIR",
      hari: [hari(10)],
    });
  });

  it("balapan setujui vs tolak atas versi yang sama: tepat satu menang, satu jejak", async () => {
    const v = await diajukan();
    const [a, b] = await Promise.all([
      setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, sekarang }),
      tolakJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, alasan: "hari Minggu" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const akhir = await kepala();
    expect(akhir.status).toBe(a.ok ? "DISETUJUI" : "DITOLAK");
    expect(await prisma.auditLog.count({ where: { userId: seededId(kantor), action: { in: [JEJAK_JADWAL_BULAN.DISETUJUI, JEJAK_JADWAL_BULAN.DITOLAK] } } })).toBe(1);
  });

  it("balapan setujui vs isian SPG: bulan tidak pernah berakhir disetujui dengan sel yang tidak dilihat penyetuju", async () => {
    const v = await diajukan();
    const [setuju, ubah] = await Promise.all([
      setujuiJadwalBulan({ userId: dewi, bulan: BULAN, versi: v, olehUserId: kantor, sekarang }),
      isi(libur(25)),
    ]);
    expect(ubah.ok).toBe(true);
    // Isian SPG selalu masuk: kalau persetujuan menang lebih dulu, isian itu menurunkannya lagi;
    // kalau isian lebih dulu, persetujuan atas versi lama ditolak.
    expect((await kepala()).status).toBe("DIAJUKAN");
    if (!setuju.ok) expect(setuju).toEqual({ ok: false, kode: "JADWAL_BERUBAH" });
  });
});
