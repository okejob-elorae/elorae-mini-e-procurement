import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededIds } from "@elorae/db";

vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(),
}));

import { KUNCI_SHIFT, SHIFT_BAWAAN } from "./pengaturan";
import { kunciSel } from "./shift";
import { jadwalSpgHp, jadwalSpgMingguKantor, shiftHariIni, tokoDenganSpg } from "./shift-queries";
import { ajukanTukarShift, simpanJadwalSpg } from "./shift-writer";

/*
 * Bacaan jadwal SPG terhadap basis data uji: kisi kantor dengan kenyataannya
 * (check-in sungguhan di `StoreVisit`, izin sungguhan di `LeaveRequest`),
 * shift hari ini untuk beranda, dan layar HP. Hari dipatok ke Januari 2030.
 * Teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `SHQ-${Math.random().toString(36).slice(2, 9)}`;
const SEN = "2030-01-07";
const SEL = "2030-01-08";
const RAB = "2030-01-09";
const wib = (day: string, jam: string) => new Date(`${day}T${jam}:00+07:00`);

d("jadwal SPG — bacaan (test bed only)", () => {
  let toko = "";
  let tokoLain = "";
  let a = "";
  let b = "";
  let kantor = "";
  let setelanAwal: string | null = null;
  const userIds = () => seededIds([a, b, kantor].filter(Boolean));
  const tokoIds = () => seededIds([toko, tokoLain].filter(Boolean));

  beforeAll(async () => {
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } });
    setelanAwal = ada?.value ?? null;
    const nilai = JSON.stringify(SHIFT_BAWAAN);
    await prisma.systemSetting.upsert({ where: { key: KUNCI_SHIFT }, create: { key: KUNCI_SHIFT, value: nilai }, update: { value: nilai } });

    toko = (await prisma.store.create({ data: { code: `${tag}-A`, name: `Toko A ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    tokoLain = (await prisma.store.create({ data: { code: `${tag}-B`, name: `Toko B ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    const orang = async (n: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    a = await orang("ani", toko);
    b = await orang("budi", toko);
    kantor = await orang("kantor", null);

    // Jadwal disusun pada Minggu 6 Januari, sebelum minggunya mulai.
    const r = await simpanJadwalSpg({
      storeId: toko,
      olehUserId: kantor,
      sekarang: wib("2030-01-06", "09:00"),
      isian: [
        { userId: a, day: SEN, isi: { jenis: "KERJA", kode: "PAGI" } },
        { userId: a, day: SEL, isi: { jenis: "KERJA", kode: "PAGI" } },
        { userId: a, day: RAB, isi: { jenis: "KERJA", kode: "PAGI" } },
        { userId: b, day: SEN, isi: { jenis: "KERJA", kode: "SIANG" } },
        { userId: b, day: SEL, isi: { jenis: "LIBUR" } },
        { userId: b, day: RAB, isi: { jenis: "KERJA", kode: "SIANG" } },
      ],
    });
    if (!r.ok) throw new Error(r.kode);
    // Minggu sebelumnya — bahan "salin minggu lalu". Penulis menolak hari
    // yang sudah lewat, jadi barisnya ditulis langsung.
    await prisma.spgShift.create({
      data: { userId: a, storeId: toko, day: "2030-01-02", kind: "KERJA", shiftCode: "PENUH", startTime: "10:00", endTime: "22:00", createdById: kantor },
    });

    const masuk = (userId: string, storeId: string, at: Date) =>
      prisma.storeVisit.create({ data: { storeId, userId, checkinAt: at, checkinLat: -6.2, checkinLng: 106.8 } });
    await masuk(a, toko, wib(SEN, "09:58"));
    await masuk(a, toko, wib(SEN, "15:00"));
    await masuk(a, toko, wib(SEL, "10:20"));
    await masuk(b, toko, wib(SEL, "11:00"));
    // Check-in di toko LAIN tidak dihitung masuk di toko ini.
    await masuk(b, tokoLain, wib(SEN, "14:00"));
    await prisma.leaveRequest.create({ data: { userId: b, type: "SAKIT", startDay: RAB, endDay: RAB, reason: "uji", status: "DISETUJUI" } });
  });

  afterAll(async () => {
    try {
      if (setelanAwal === null) await prisma.systemSetting.delete({ where: { key: KUNCI_SHIFT } });
      else await prisma.systemSetting.update({ where: { key: KUNCI_SHIFT }, data: { value: setelanAwal } });
    } finally {
      await prisma.storeVisit.deleteMany({ where: { userId: { in: userIds() } } });
      await prisma.leaveRequest.deleteMany({ where: { userId: { in: userIds() } } });
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds() } } });
      await prisma.spgShiftSwap.deleteMany({ where: { storeId: { in: tokoIds() } } });
      await prisma.spgShift.deleteMany({ where: { userId: { in: userIds() } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds() } } });
      await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    }
  });

  it("kisi kantor: kenyataan per sel dari check-in di toko ini, izin, dan jadwal", async () => {
    // Rabu 9 Januari pukul 12.00 WIB.
    const data = await jadwalSpgMingguKantor({ storeId: toko, senin: SEN, sekarang: wib(RAB, "12:00") });
    expect(data.hari[0]).toBe(SEN);
    expect(data.hariIni).toBe(RAB);
    expect(data.orang.map((o) => o.id).sort()).toEqual([a, b].sort());
    expect(data.sel[kunciSel(a, SEN)]).toMatchObject({ kind: "KERJA", shiftCode: "PAGI", label: "Pagi", mulai: "10:00", selesai: "18:00", tokoLain: false });

    expect(data.kenyataan[kunciSel(a, SEN)]).toEqual({ status: "HADIR", jamMasuk: "09:58" });
    expect(data.kenyataan[kunciSel(a, SEL)]).toEqual({ status: "TERLAMBAT", jamMasuk: "10:20", menit: 20 });
    expect(data.kenyataan[kunciSel(a, RAB)]).toEqual({ status: "BELUM_MASUK" });
    // Senin b shift siang tanpa check-in di toko ini (check-in di toko lain tidak dihitung).
    expect(data.kenyataan[kunciSel(b, SEN)]).toEqual({ status: "TIDAK_MASUK" });
    expect(data.kenyataan[kunciSel(b, SEL)]).toEqual({ status: "MASUK_SAAT_LIBUR", jamMasuk: "11:00" });
    expect(data.kenyataan[kunciSel(b, RAB)]).toEqual({ status: "IZIN", jenis: "SAKIT" });
    expect(data.izin[kunciSel(b, RAB)]).toBe("SAKIT");
    // Hari depan tanpa kenyataan.
    expect(data.kenyataan[kunciSel(a, "2030-01-10")]).toBeUndefined();

    expect(data.mingguLalu).toEqual([
      { userId: a, day: "2030-01-02", kind: "KERJA", shiftCode: "PENUH", startTime: "10:00", endTime: "22:00" },
    ]);
    expect(data.aturan.daftar.map((s) => s.kode)).toEqual(["PAGI", "SIANG", "PENUH"]);
  });

  it("toko dengan SPG dan shift hari ini untuk beranda", async () => {
    const daftar = await tokoDenganSpg();
    expect(daftar.find((t) => t.id === toko)).toMatchObject({ jumlahSpg: 2 });
    expect(daftar.find((t) => t.id === tokoLain)).toBeUndefined();

    expect(await shiftHariIni(a, SEN)).toEqual({ jenis: "KERJA", label: "Pagi", mulai: "10:00", selesai: "18:00" });
    expect(await shiftHariIni(b, SEL)).toEqual({ jenis: "LIBUR" });
    expect(await shiftHariIni(b, "2030-01-10")).toBeNull();
    // Date dibaca sebagai hari WIB-nya: Senin 7 Jan 23.30 UTC = Selasa 8 Jan WIB.
    expect(await shiftHariIni(b, new Date("2030-01-07T23:30:00Z"))).toEqual({ jenis: "LIBUR" });
  });

  it("HP: 14 hari jadwal sendiri dan rekan, ajuan masuk/keluar, tanpa rupiah", async () => {
    const r = await ajukanTukarShift({
      userId: a,
      storeId: toko,
      day: SEL,
      partnerId: b,
      alasan: "acara keluarga",
      idempotencyKey: `${tag}-k1`,
      sekarang: wib(SEN, "08:00"),
    });
    if (!r.ok) throw new Error(r.kode);

    const hpA = await jadwalSpgHp({ userId: a, storeId: toko, sekarang: wib(SEN, "08:00") });
    expect(hpA.hari).toHaveLength(14);
    expect(hpA.hari[0]).toMatchObject({ day: SEN, hariIni: true });
    expect(hpA.hari[0].saya).toMatchObject({ kind: "KERJA", label: "Pagi", mulai: "10:00" });
    expect(hpA.hari[0].rekan).toEqual([
      { userId: b, nama: `budi ${tag}`, sel: { kind: "KERJA", shiftCode: "SIANG", label: "Siang", mulai: "14:00", selesai: "22:00" }, izin: false },
    ]);
    // Rekan hanya tahu "izin", bukan jenisnya (sakit/cuti).
    expect(hpA.hari[2].rekan[0].izin).toBe(true);
    expect(JSON.stringify(hpA.hari.map((h) => h.rekan))).not.toContain("SAKIT");
    expect(hpA.rekan).toEqual([{ id: b, nama: `budi ${tag}` }]);
    expect(hpA.keluar.map((s) => s.id)).toEqual([r.id]);
    expect(hpA.masuk).toEqual([]);
    expect(hpA.keluar[0].sel).toEqual([
      expect.objectContaining({ day: SEL, pengaju: expect.objectContaining({ shiftCode: "PAGI" }), rekan: expect.objectContaining({ kind: "LIBUR" }) }),
    ]);

    const hpB = await jadwalSpgHp({ userId: b, storeId: toko, sekarang: wib(SEN, "08:00") });
    expect(hpB.masuk.map((s) => s.id)).toEqual([r.id]);
    expect(hpB.masuk[0]).toMatchObject({ peran: "REKAN", pengaju: `ani ${tag}`, status: "MENUNGGU_REKAN", alasan: "acara keluarga" });

    // Tidak ada uang sama sekali di bayaran HP.
    for (const hp of [hpA, hpB]) {
      const teks = JSON.stringify(hp);
      expect(teks).not.toMatch(/"[^"]*(price|harga|total|nilai|amount)[^"]*":/i);
      expect(teks).not.toMatch(/Rp\s?\d/);
    }
  });
});
