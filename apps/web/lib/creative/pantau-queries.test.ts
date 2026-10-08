import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { PANTAU_BAWAAN } from "./pantau-aturan";
import { anomaliTugas, keadaanPerangkat, perangkatBerhentiTugas } from "./pantau-queries";

/*
 * Pembaca pantau KOL terhadap basis data sungguhan, dibatasi ke baris tes
 * (`akunIds`, `perangkatIds`), tahun 2003.
 */

const tag = `UJIPANTAUQ${Math.random().toString(36).slice(2, 7)}`;
const SEKARANG = new Date("2003-07-15T03:00:00Z");
const jamLalu = (n: number) => new Date(SEKARANG.getTime() - n * 3_600_000);

let userId = "";
let kolId = "";
let akunIds: string[] = [];
let perangkatIds: string[] = [];

async function akun(snap: { jamLalu: number; followers: number; er?: number | null }[]) {
  const a = await prisma.kolAccount.create({
    data: { kolId, platform: "TIKTOK", handle: `@${tag.toLowerCase()}${akunIds.length}`, followers: 1 },
    select: { id: true },
  });
  akunIds.push(a.id);
  for (const s of snap) {
    await prisma.kolFollowerSnapshot.create({
      data: { accountId: a.id, followers: s.followers, er: s.er ?? null, recordedAt: jamLalu(s.jamLalu), source: "ekstensi" },
    });
  }
  return a.id;
}

async function perangkat(isi: { dijedaSampai?: Date | null; alasanJeda?: string | null; terakhirLaporAt?: Date | null; dicabutAt?: Date | null }) {
  const p = await prisma.kolPerangkat.create({
    data: { nama: `${tag} P${perangkatIds.length}`, dibuatOlehId: userId, tersambungAt: jamLalu(100), terakhirLaporAt: jamLalu(1), ...isi },
    select: { id: true },
  });
  perangkatIds.push(p.id);
  return p.id;
}

beforeEach(async () => {
  userId = "";
  kolId = "";
  akunIds = [];
  perangkatIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.kolLogPantau.deleteMany({ where: { perangkatId: { in: seededIds(perangkatIds) } } });
  await prisma.kolPerangkat.deleteMany({ where: { id: { in: seededIds(perangkatIds) } } });
  await prisma.kolFollowerSnapshot.deleteMany({ where: { accountId: { in: seededIds(akunIds) } } });
  await prisma.kolAccount.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

describe("anomaliTugas", () => {
  it("akun yang pengikutnya melonjak atau ER-nya anjlok muncul; yang wajar tidak; hari dibaca di WIB", async () => {
    const naik = await akun([
      { jamLalu: 24 * 6, followers: 10_000, er: 5 },
      // 2003-07-14 20:00 UTC = 2003-07-15 03:00 WIB.
      { jamLalu: 7, followers: 14_000, er: 5 },
    ]);
    const turun = await akun([
      { jamLalu: 24 * 30, followers: 10_000, er: 6 },
      { jamLalu: 24, followers: 10_100, er: 2 },
    ]);
    const wajar = await akun([
      { jamLalu: 24 * 6, followers: 10_000, er: 5 },
      { jamLalu: 24, followers: 10_500, er: 4.5 },
    ]);
    const r = await anomaliTugas({ sekarang: SEKARANG, pengaturan: PANTAU_BAWAAN, akunIds: [naik, turun, wajar] });
    const peta = new Map(r.map((x) => [x.akunId, x]));
    expect(peta.get(naik)).toMatchObject({ kolId, hari: "2003-07-15", pengikut: { dari: 10_000, ke: 14_000, persen: 40 }, er: null });
    expect(peta.get(turun)).toMatchObject({ pengikut: null, er: { dari: 6, ke: 2 } });
    expect(peta.has(wajar)).toBe(false);
  });

  it("anomali yang catatan terbarunya lebih tua dari 7 hari tidak ditampilkan; KOL diblokir dilewati", async () => {
    const lama = await akun([
      { jamLalu: 24 * 20, followers: 10_000 },
      { jamLalu: 24 * 10, followers: 20_000 },
    ]);
    expect(await anomaliTugas({ sekarang: SEKARANG, pengaturan: PANTAU_BAWAAN, akunIds: [lama] })).toEqual([]);
    const baru = await akun([
      { jamLalu: 48, followers: 10_000 },
      { jamLalu: 2, followers: 20_000 },
    ]);
    await prisma.kol.update({ where: { id: kolId }, data: { blockedAt: SEKARANG } });
    expect(await anomaliTugas({ sekarang: SEKARANG, pengaturan: PANTAU_BAWAAN, akunIds: [baru] })).toEqual([]);
  });
});

describe("perangkatBerhentiTugas", () => {
  it("jeda otomatis dan senyap > 24 jam berhenti; jeda manual, yang aktif, dan yang dicabut tidak", async () => {
    const captcha = await perangkat({ dijedaSampai: new Date(SEKARANG.getTime() + 3_600_000), alasanJeda: "CAPTCHA" });
    await prisma.kolLogPantau.create({ data: { perangkatId: captcha, jenis: "JEDA", kode: "CAPTCHA", createdAt: jamLalu(1) } });
    const senyap = await perangkat({ terakhirLaporAt: jamLalu(30) });
    const manual = await perangkat({ dijedaSampai: new Date("2100-01-01T00:00:00Z"), alasanJeda: "MANUAL" });
    const aktif = await perangkat({});
    const dicabut = await perangkat({ dicabutAt: jamLalu(2), terakhirLaporAt: jamLalu(48) });
    const r = await perangkatBerhentiTugas({ sekarang: SEKARANG, perangkatIds: [captcha, senyap, manual, aktif, dicabut] });
    expect(r.map((x) => x.id).sort()).toEqual([captcha, senyap].sort());
    expect(r.find((x) => x.id === captcha)).toMatchObject({ alasan: "CAPTCHA", sejak: "2003-07-15", sampai: new Date(SEKARANG.getTime() + 3_600_000).toISOString() });
    expect(r.find((x) => x.id === senyap)).toMatchObject({ alasan: "TIDAK_LAPOR", sampai: null, sejak: "2003-07-14" });
  });
});

describe("keadaanPerangkat", () => {
  const dasar = { dicabutAt: null, tersambungAt: null, kodeBerlakuSampai: null, dijedaSampai: null };
  it("membedakan belum tersambung, kode kedaluwarsa, aktif, dijeda, dicabut", () => {
    expect(keadaanPerangkat({ ...dasar, kodeBerlakuSampai: jamLalu(-1) }, SEKARANG)).toBe("BELUM_TERSAMBUNG");
    expect(keadaanPerangkat({ ...dasar, kodeBerlakuSampai: jamLalu(1) }, SEKARANG)).toBe("KODE_KEDALUWARSA");
    expect(keadaanPerangkat({ ...dasar, tersambungAt: jamLalu(5) }, SEKARANG)).toBe("AKTIF");
    expect(keadaanPerangkat({ ...dasar, tersambungAt: jamLalu(5), dijedaSampai: jamLalu(-1) }, SEKARANG)).toBe("DIJEDA");
    expect(keadaanPerangkat({ ...dasar, tersambungAt: jamLalu(5), dicabutAt: jamLalu(1) }, SEKARANG)).toBe("DICABUT");
  });
});
