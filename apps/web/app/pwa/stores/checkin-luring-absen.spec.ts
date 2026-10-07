import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { PENGATURAN_ABSENSI_BAWAAN, type PengaturanAbsensi } from "@/lib/salesman/absensi";
import { hariWib } from "@/lib/spg/beranda-spg";

/*
 * Absen SPG dari check-in/check-out TANPA sinyal yang tiba terlambat, terhadap
 * basis data uji dan penulis absensi yang sesungguhnya:
 * - check-in yang dicatat sudah selesai (tiba sesudah kunjungan yang lebih
 *   baru) tetap mencatat absen harinya — jam masuk = check-in pertama hari itu;
 * - check-out yang meluruskan kunjungan itu mengisi jam pulang harinya, kecuali
 *   masih ada kunjungan sesudahnya di hari yang sama.
 * Pengaturan absensi DIPALSUKAN (bukan diubah di basis data bersama).
 */

const h = vi.hoisted(() => ({ userId: "" }));
let pengaturan: PengaturanAbsensi = { ...PENGATURAN_ABSENSI_BAWAAN, aktif: true };

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: h.userId, permissions: ["pwa:access"] } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/salesman/absensi-queries", () => ({ pengaturanAbsensiDb: async () => pengaturan }));

const { checkInLuringAction, checkOutLuringAction } = await import("./actions");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `CLA-${Math.random().toString(36).slice(2, 9)}`;

/** Jam WIB `hhmm` pada hari `n` hari yang lalu (WIB). */
const jamHari = (n: number, hhmm: string) => new Date(`${hariWib(Date.now() - n * 86_400_000)}T${hhmm}:00+07:00`);

d("absen SPG dari check-in/out tanpa sinyal yang terlambat (test bed only)", () => {
  let spg = "";
  let toko = "";
  let ke = 0;
  const id = () => `${tag}-${ke++}`;

  beforeAll(async () => {
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    spg = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: toko } })).id;
  });

  beforeEach(() => {
    h.userId = spg;
    pengaturan = { ...PENGATURAN_ABSENSI_BAWAAN, aktif: true };
  });

  afterEach(async () => {
    await prisma.attendance.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.storeVisit.deleteMany({ where: { userId: seededId(spg) } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: seededId(spg) } });
    await prisma.store.deleteMany({ where: { id: seededId(toko) } });
  });

  const masuk = (clientId: string, waktu: Date) =>
    checkInLuringAction({ clientId, storeId: toko, lat: -7.78, lng: 110.37, accuracy: 10, waktu: waktu.toISOString() });
  const keluar = (clientId: string, waktu: Date) => checkOutLuringAction({ visitClientId: clientId, waktu: waktu.toISOString(), lat: -7.79, lng: 110.38 });
  const bukaOnline = (checkinAt: Date) => prisma.storeVisit.create({ data: { storeId: toko, userId: spg, checkinAt, checkinLat: 1, checkinLng: 1 } });
  const absen = (n: number) => prisma.attendance.findUnique({ where: { userId_dayKey: { userId: spg, dayKey: hariWib(jamHari(n, "12:00")) } } });

  it("check-in yang tiba sesudah kunjungan hari berikutnya mencatat absen harinya; check-out-nya mengisi jam pulang", async () => {
    await bukaOnline(jamHari(1, "08:00"));
    const c = id();
    const r = await masuk(c, jamHari(2, "08:05"));
    if (!r.ok) throw new Error(r.code);
    expect(await prisma.storeVisit.findUniqueOrThrow({ where: { id: r.visitId } })).toMatchObject({ autoClosed: true });
    expect(await absen(2)).toMatchObject({ clockInAt: jamHari(2, "08:05"), clockOutAt: null, clockInAccuracy: 10 });

    // Kiriman ulang: tidak ada absen kedua, jam tidak bergeser.
    expect(await masuk(c, jamHari(2, "08:05"))).toMatchObject({ ok: true, visitId: r.visitId });
    expect(await prisma.attendance.count({ where: { userId: spg } })).toBe(1);

    expect(await keluar(c, jamHari(2, "17:10"))).toMatchObject({ ok: true, sudahTertutup: false });
    const a = await absen(2);
    expect(a).toMatchObject({ clockInAt: jamHari(2, "08:05"), clockOutAt: jamHari(2, "17:10") });
    expect(Number(a?.clockOutLat)).toBeCloseTo(-7.79);
  });

  it("jam masuk = check-in pertama hari itu: check-in terlambat yang lebih pagi memajukan jam masuk; jam pulang kunjungan sesudahnya tidak disentuh", async () => {
    await bukaOnline(jamHari(2, "13:00"));
    await prisma.attendance.create({
      data: { userId: spg, dayKey: hariWib(jamHari(2, "13:00")), clockInAt: jamHari(2, "13:00"), clockOutAt: jamHari(2, "17:00") },
    });
    const c = id();
    const r = await masuk(c, jamHari(2, "08:00"));
    if (!r.ok) throw new Error(r.code);
    expect(await absen(2)).toMatchObject({ clockInAt: jamHari(2, "08:00"), clockOutAt: jamHari(2, "17:00") });

    // Check-out kunjungan pagi (12.00): masih ada kunjungan sesudahnya hari itu.
    expect(await keluar(c, jamHari(2, "12:00"))).toMatchObject({ ok: true, sudahTertutup: false });
    expect(await absen(2)).toMatchObject({ clockInAt: jamHari(2, "08:00"), clockOutAt: jamHari(2, "17:00") });
    expect(await prisma.attendance.count({ where: { userId: spg } })).toBe(1);
  });

  it("kunjungan sesudahnya hari itu masih berjalan: check-out kunjungan pagi tidak memulangkan SPG", async () => {
    await bukaOnline(jamHari(2, "13:00"));
    await prisma.attendance.create({ data: { userId: spg, dayKey: hariWib(jamHari(2, "13:00")), clockInAt: jamHari(2, "13:00") } });
    const c = id();
    const r = await masuk(c, jamHari(2, "08:00"));
    if (!r.ok) throw new Error(r.code);
    expect(await keluar(c, jamHari(2, "12:00"))).toMatchObject({ ok: true, sudahTertutup: false });
    expect(await absen(2)).toMatchObject({ clockInAt: jamHari(2, "08:00"), clockOutAt: null });
  });

  it("check-out yang diluruskan memulangkan hari check-in-nya walau check-in-nya dengan sinyal", async () => {
    // Check-in pagi dengan sinyal (absen sudah ada), check-out tanpa sinyal tertahan,
    // keesokan harinya check-in dengan sinyal menutup kunjungan itu otomatis.
    const pagi = await bukaOnline(jamHari(2, "08:00"));
    await prisma.attendance.create({ data: { userId: spg, dayKey: hariWib(jamHari(2, "08:00")), clockInAt: jamHari(2, "08:00") } });
    await prisma.storeVisit.update({ where: { id: pagi.id }, data: { checkoutAt: jamHari(1, "08:00"), autoClosed: true } });
    await bukaOnline(jamHari(1, "08:00"));
    const k = await checkOutLuringAction({ visitId: pagi.id, waktu: jamHari(2, "16:30").toISOString(), lat: 1, lng: 2 });
    expect(k).toMatchObject({ ok: true, sudahTertutup: false });
    expect(await absen(2)).toMatchObject({ clockOutAt: jamHari(2, "16:30") });
  });

  it("absensi mati: check-in terlambat tidak membuat absen", async () => {
    pengaturan = { ...pengaturan, aktif: false };
    await bukaOnline(jamHari(1, "08:00"));
    const r = await masuk(id(), jamHari(2, "08:00"));
    expect(r.ok).toBe(true);
    expect(await prisma.attendance.count({ where: { userId: spg } })).toBe(0);
  });

  it("balapan: dua kiriman check-in terlambat yang sama sekaligus tetap satu absen", async () => {
    await bukaOnline(jamHari(1, "08:00"));
    const c = id();
    const hasil = await Promise.all([masuk(c, jamHari(2, "09:00")), masuk(c, jamHari(2, "09:00"))]);
    expect(hasil.every((x) => x.ok)).toBe(true);
    expect(await prisma.attendance.count({ where: { userId: spg } })).toBe(1);
    expect(await absen(2)).toMatchObject({ clockInAt: jamHari(2, "09:00") });
  });
});
