import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { PENGATURAN_ABSENSI_BAWAAN, type PengaturanAbsensi } from "./absensi";

/*
 * Absen SPG lewat check-in/check-out, terhadap basis data uji. Pengaturan
 * absensi DIPALSUKAN di sini (bukan diubah di basis data): `salesman.absensi`
 * milik pemiliknya dan dibaca aplikasi yang sedang berjalan.
 */

let pengaturan: PengaturanAbsensi = { ...PENGATURAN_ABSENSI_BAWAAN, aktif: true };
vi.mock("./absensi-queries", () => ({ pengaturanAbsensiDb: async () => pengaturan }));

const { absenMasukLewatCheckin, absenPulangLewatCheckout } = await import("./absensi-writer");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `ABS-${Math.random().toString(36).slice(2, 10)}`;
/** Rabu 30 Sep 2026, WIB. */
const jam = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00+07:00`);

d("absen SPG lewat check-in (test bed only)", () => {
  let spg = "";

  beforeAll(async () => {
    spg = "";
    spg = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: tag, assignedStoreId: `toko-${tag}` } }))
      .id;
  });

  afterEach(async () => {
    pengaturan = { ...PENGATURAN_ABSENSI_BAWAAN, aktif: true };
    await prisma.attendance.deleteMany({ where: { userId: seededId(spg) } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: seededId(spg) } });
  });

  const masuk = (hhmm: string) => absenMasukLewatCheckin({ userId: spg, lat: -6.2, lng: 106.8, akurasi: 12, sekarang: jam(hhmm) });
  const pulang = (hhmm: string) => absenPulangLewatCheckout({ userId: spg, lat: -6.21, lng: 106.81, sekarang: jam(hhmm) });
  const baris = () => prisma.attendance.findMany({ where: { userId: seededId(spg) } });

  it("check-in = absen masuk: jam server, lokasi check-in, tanpa swafoto walau swafoto wajib", async () => {
    pengaturan = { ...pengaturan, selfieWajib: true };
    expect(await masuk("08:55")).toBe("MASUK");
    const [a] = await baris();
    expect(a).toMatchObject({ dayKey: "2026-09-30", clockInAt: jam("08:55"), clockInAccuracy: 12, selfieUrl: null, clockOutAt: null });
    expect(Number(a.clockInLat)).toBeCloseTo(-6.2);
  });

  it("tidak pernah absen dua kali: check-in kedua dan check-in kembar yang berpacu tetap satu baris", async () => {
    const hasil = await Promise.all([masuk("08:00"), masuk("08:00"), masuk("08:01")]);
    expect(hasil.filter((h) => h === "MASUK")).toHaveLength(1);
    expect(hasil.filter((h) => h === "GAGAL")).toHaveLength(0);
    expect(await masuk("10:00")).toBe("LEWATI");
    const semua = await baris();
    expect(semua).toHaveLength(1);
    expect(semua[0].clockInAt.getTime()).toBeLessThanOrEqual(jam("08:01").getTime());
  });

  it("check-out = absen pulang; ketukan kedua tidak menggeser jamnya", async () => {
    await masuk("09:00");
    expect(await pulang("17:00")).toBe("PULANG");
    expect(await pulang("17:05")).toBe("LEWATI");
    const [a] = await baris();
    expect(a.clockOutAt).toEqual(jam("17:00"));
  });

  it("kembali sesudah check-out siang: harinya dibuka lagi, jam pulang = check-out terakhir", async () => {
    await masuk("09:00");
    await pulang("12:00");
    expect(await masuk("13:00")).toBe("BUKA_LAGI");
    let [a] = await baris();
    expect(a.clockInAt).toEqual(jam("09:00"));
    expect(a.clockOutAt).toBeNull();
    expect(await pulang("18:00")).toBe("PULANG");
    [a] = await baris();
    expect(a.clockOutAt).toEqual(jam("18:00"));
  });

  it("absensi mati: check-in tidak mencatat apa pun; check-out tanpa absen tidak berbuat apa-apa", async () => {
    pengaturan = { ...pengaturan, aktif: false };
    expect(await masuk("09:00")).toBe("LEWATI");
    expect(await pulang("17:00")).toBe("LEWATI");
    expect(await baris()).toHaveLength(0);
  });
});
