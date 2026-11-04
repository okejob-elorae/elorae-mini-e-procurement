import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { geserHari } from "@/lib/salesman/jadwal";
import { pengunjungToko, pengunjungTokoRinci, pengunjungUntukHp, riwayatPengunjungHp } from "./pengunjung-queries";
import { catatPengunjung } from "./pengunjung-writer";

/*
 * Penghitung pengunjung terhadap basis data uji. Semua baris dibuat tes ini
 * dan dihapus lewat id toko/orang buatan tes (`seededIds`). Hari = hari ini WIB
 * saat tes berjalan.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `PGJ-${Math.random().toString(36).slice(2, 9)}`;
const MENIT = 60_000;

d("penghitung pengunjung SPG (test bed only)", () => {
  let tokoA = "";
  let tokoB = "";
  let spg1 = "";
  let spg2 = "";
  let spgB = "";
  let day = "";
  const sekarang = new Date();
  const lalu = (menit: number) => new Date(sekarang.getTime() - menit * MENIT).toISOString();

  beforeAll(async () => {
    tokoA = "";
    tokoB = "";
    spg1 = "";
    spg2 = "";
    spgB = "";
    day = kunciHariWib(sekarang);
    const toko = (k: string) => prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType: "KONSI" } });
    tokoA = (await toko("A")).id;
    tokoB = (await toko("B")).id;
    const orang = (k: string, storeId: string) =>
      prisma.user.create({ data: { email: `${tag}-${k}@test.local`.toLowerCase(), name: `SPG ${k}`, assignedStoreId: storeId } });
    spg1 = (await orang("1", tokoA)).id;
    spg2 = (await orang("2", tokoA)).id;
    spgB = (await orang("b", tokoB)).id;
  });

  afterAll(async () => {
    await prisma.spgVisitorCount.deleteMany({ where: { storeId: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spg1, spg2, spgB].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
  });

  const kirim = (userId: string, storeId: string, count: number, waktu: string, hari = day) =>
    catatPengunjung({ userId, storeId, isian: { day: hari, count, clientUpdatedAt: waktu }, sekarang });

  it("stores the absolute count, and a newer change replaces it", async () => {
    const a = await kirim(spg1, tokoA, 5, lalu(30));
    expect(a).toMatchObject({ ok: true, diterapkan: true, day, saya: { count: 5 }, totalToko: 5 });
    const b = await kirim(spg1, tokoA, 8, lalu(20));
    expect(b).toMatchObject({ ok: true, diterapkan: true, saya: { count: 8 } });
  });

  it("never lets an older or repeated send overwrite a newer count", async () => {
    const lama = await kirim(spg1, tokoA, 2, lalu(25));
    expect(lama).toMatchObject({ ok: true, diterapkan: false, saya: { count: 8, clientUpdatedAt: lalu(20) } });
    const ulang = await kirim(spg1, tokoA, 99, lalu(20));
    expect(ulang).toMatchObject({ ok: true, diterapkan: false, saya: { count: 8 } });
    const baris = await prisma.spgVisitorCount.findMany({ where: { storeId: tokoA, userId: spg1 } });
    expect(baris).toHaveLength(1);
    expect(baris[0].count).toBe(8);
  });

  it("adds up every SPG of the store, and keeps other stores apart", async () => {
    await kirim(spg2, tokoA, 4, lalu(10));
    await kirim(spgB, tokoB, 40, lalu(10));
    expect(await pengunjungToko(tokoA, day)).toBe(12);
    expect(await pengunjungToko(tokoB, day)).toBe(40);
    expect(await pengunjungToko(tokoA, geserHari(day, -1))).toBeNull();
    expect((await pengunjungTokoRinci(tokoA, day)).map((r) => [r.userId, r.count])).toEqual([
      [spg1, 8],
      [spg2, 4],
    ]);
    const hp = await pengunjungUntukHp(spg2, tokoA, day);
    expect(hp).toEqual({ day, saya: { count: 4, clientUpdatedAt: lalu(10) }, totalToko: 12 });
  });

  it("refuses days more than three days back and future days", async () => {
    expect(await kirim(spg1, tokoA, 1, lalu(1), geserHari(day, -4))).toEqual({ ok: false, kode: "HARI_TERLALU_LAMA" });
    expect(await kirim(spg1, tokoA, 1, lalu(1), geserHari(day, 1))).toEqual({ ok: false, kode: "HARI_DEPAN" });
    const kemarin = await kirim(spg1, tokoA, 6, lalu(1), geserHari(day, -1));
    expect(kemarin).toMatchObject({ ok: true, diterapkan: true, day: geserHari(day, -1) });
    const riwayat = await riwayatPengunjungHp(spg2, tokoA, day, 2);
    expect(riwayat).toEqual([
      { day: geserHari(day, -1), saya: null, toko: 6 },
      { day: geserHari(day, -2), saya: null, toko: null },
    ]);
  });

  it("settles a race between an old and a new send on the newer one, whichever lands first — also on a brand-new row", async () => {
    const hari = geserHari(day, -2);
    for (let i = 0; i < 3; i++) {
      const baru = lalu(5 - i);
      const lama = lalu(40);
      await Promise.all([kirim(spgB, tokoB, 100 + i, baru, hari), kirim(spgB, tokoB, 1, lama, hari)]);
      const r = await prisma.spgVisitorCount.findUniqueOrThrow({ where: { storeId_userId_day: { storeId: tokoB, userId: spgB, day: hari } } });
      expect(r.count).toBe(100 + i);
      expect(r.clientUpdatedAt.toISOString()).toBe(baru);
    }
    expect(await prisma.spgVisitorCount.count({ where: { storeId: tokoB, userId: spgB, day: hari } })).toBe(1);
  });
});
