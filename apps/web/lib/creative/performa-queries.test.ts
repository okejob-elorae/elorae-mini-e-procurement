import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { engagementRate } from "./angka-konten";
import { bacaParamPerforma } from "./performa";
import { daftarPerformaVideo } from "./performa-queries";

/*
 * Daftar Performa video terhadap basis data sungguhan (PostgreSQL lokal; SQL
 * yang sama dipakai MariaDB). Data di Maret 2003, dibatasi `cakupan` ke konten
 * tes ini. Teardown lewat `seededIds()`.
 */

const tag = `ujiperforma${Math.random().toString(36).slice(2, 7)}`;
const SEKARANG = new Date("2003-03-09T03:00:00.000Z"); // 10.00 WIB, 9 Mar 2003

let kolIds: string[] = [];
let briefIds: string[] = [];
const k: Record<"k1" | "k2" | "k3" | "k4" | "k5" | "k6", string> = { k1: "", k2: "", k3: "", k4: "", k5: "", k6: "" };
let tugasIds: string[] = [];

const semua = () => Object.values(k);
/** Tes lama memakai saringan TikTok (sejak 2026-10-10 "semua" juga memuat reel Instagram k4). */
const daftar = (sp: Record<string, string> = {}, opsi: { perHalaman?: number } = {}) =>
  daftarPerformaVideo(bacaParamPerforma({ platform: "tiktok", ...sp }), { sekarang: SEKARANG, cakupan: semua(), ...opsi });

async function konten(briefId: string, isi: { link: string; liveAt: Date; platform?: "TIKTOK" | "INSTAGRAM" }) {
  return (
    await prisma.kolContent.create({
      data: { collabId: briefId, platform: isi.platform ?? "TIKTOK", format: "VIDEO", link: isi.link, liveAt: isi.liveAt },
      select: { id: true },
    })
  ).id;
}

async function angka(contentId: string, recordedAt: string, a: { views: number; likes: number; comments?: number; shares?: number; saves?: number; source?: string }) {
  await prisma.kolContentMetric.create({
    data: { contentId, recordedAt: new Date(recordedAt), views: a.views, likes: a.likes, comments: a.comments ?? 0, shares: a.shares ?? 0, saves: a.saves ?? 0, source: a.source ?? null },
  });
}

beforeAll(async () => {
  kolIds = [];
  briefIds = [];
  tugasIds = [];
  const satu = await prisma.kol.create({ data: { name: `${tag} Satu` }, select: { id: true } });
  const dua = await prisma.kol.create({ data: { name: `${tag} Dua` }, select: { id: true } });
  kolIds.push(satu.id, dua.id);
  const komisi = await prisma.kolBrief.create({ data: { docNo: `${tag}/1`, kolId: satu.id, tahap: "TAYANG", jenis: "KOMISI" }, select: { id: true } });
  const barter = await prisma.kolBrief.create({ data: { docNo: `${tag}/2`, kolId: dua.id, tahap: "TAYANG", jenis: "BARTER" }, select: { id: true } });
  briefIds.push(komisi.id, barter.id);

  k.k1 = await konten(komisi.id, { link: `https://www.tiktok.com/@${tag}.a/video/7301234567890123401`, liveAt: new Date("2003-03-05T03:00:00Z") });
  // 7 Mar 2003 pukul 00.00 WIB tepat — batas awal hari WIB.
  k.k2 = await konten(barter.id, { link: `https://www.tiktok.com/@${tag}.b/video/7301234567890123402`, liveAt: new Date("2003-03-06T17:00:00Z") });
  k.k3 = await konten(komisi.id, { link: `https://www.tiktok.com/@${tag}.a/video/7301234567890123403`, liveAt: new Date("2003-03-08T03:00:00Z") });
  k.k4 = await konten(barter.id, { link: `https://www.instagram.com/reel/${tag}`, liveAt: new Date("2003-03-05T03:00:00Z"), platform: "INSTAGRAM" });
  k.k6 = await konten(barter.id, { link: `https://www.instagram.com/${tag}/`, liveAt: new Date("2003-03-05T03:00:00Z"), platform: "INSTAGRAM" });
  k.k5 = await konten(komisi.id, { link: `https://www.tiktok.com/@${tag}.a/video/7301234567890123405`, liveAt: new Date("2003-03-04T03:00:00Z") });

  await angka(k.k1, "2003-03-06T03:00:00Z", { views: 1000, likes: 50, comments: 10, shares: 5, saves: 5 });
  await angka(k.k1, "2003-03-08T03:00:00Z", { views: 3000, likes: 120, comments: 30, shares: 9, saves: 7, source: "ekstensi" });
  await angka(k.k2, "2003-03-09T01:00:00Z", { views: 5000, likes: 100 });
  await angka(k.k4, "2003-03-09T01:00:00Z", { views: 99_999, likes: 1 });

  const t = (contentId: string, status: string, galatTerakhir: string | null, selesaiAt: Date | null) =>
    prisma.kolTugasPantau.create({
      data: { kunci: `${tag}:${contentId}:${status}`, jenis: "KONTEN", platform: "TIKTOK", contentId, url: "x", jatuhAt: SEKARANG, status, galatTerakhir, selesaiAt },
      select: { id: true },
    });
  tugasIds.push((await t(k.k3, "ANTRE", null, null)).id);
  tugasIds.push((await t(k.k5, "GAGAL", "TIDAK_DITEMUKAN", new Date("2003-03-08T05:00:00Z"))).id);
  tugasIds.push((await t(k.k1, "SELESAI", null, new Date("2003-03-08T03:00:00Z"))).id);
});

afterAll(async () => {
  await prisma.kolTugasPantau.deleteMany({ where: { id: { in: seededIds(tugasIds) } } });
  await prisma.kolContentMetric.deleteMany({ where: { contentId: { in: seededIds(semua().filter(Boolean)) } } });
  await prisma.kolContent.deleteMany({ where: { id: { in: seededIds(semua().filter(Boolean)) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(briefIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

describe("daftarPerformaVideo", () => {
  it("platform: semua memuat reel Instagram (ber-platform INSTAGRAM, link-nya ke Instagram); saringan instagram hanya itu", async () => {
    const r = await daftarPerformaVideo(bacaParamPerforma({}), { sekarang: SEKARANG, cakupan: semua() });
    // k6 = konten Instagram ber-link profil: tetap tampil (link ke instagram.com), sama seperti TikTok ber-link apa pun ke tiktok.com.
    expect(r.total).toBe(6);
    expect(r.baris.find((b) => b.kontenId === k.k4)).toMatchObject({ platform: "INSTAGRAM", angka: { views: 99_999, likes: 1 } });
    const ig = await daftarPerformaVideo(bacaParamPerforma({ platform: "instagram" }), { sekarang: SEKARANG, cakupan: semua() });
    expect(ig.baris.map((b) => b.kontenId).sort()).toEqual([k.k4, k.k6].sort());
    expect((await daftarPerformaVideo(bacaParamPerforma({ platform: "youtube" }), { sekarang: SEKARANG, cakupan: semua() })).total).toBe(0);
  });

  it("satu baris per video TikTok, bacaan terbaru, naik sejak bacaan sebelumnya, ER rumus tunggal; views terbanyak dulu, kosong di akhir", async () => {
    const r = await daftar();
    expect(r.total).toBe(4);
    expect(r.baris.map((b) => b.kontenId).slice(0, 2)).toEqual([k.k2, k.k1]);
    expect(new Set(r.baris.slice(2).map((b) => b.kontenId))).toEqual(new Set([k.k3, k.k5]));

    const b1 = r.baris.find((b) => b.kontenId === k.k1)!;
    expect(b1).toMatchObject({
      nama: `${tag} Satu`,
      handle: `${tag}.a`,
      afiliasi: true,
      angka: { views: 3000, likes: 120, comments: 30, shares: 9, saves: 7 },
      naik: 2000,
      sumber: "ekstensi",
      status: "TERBACA",
      dicekAt: "2003-03-08T03:00:00.000Z",
      tayangAt: "2003-03-05T03:00:00.000Z",
    });
    expect(b1.er).toBe(engagementRate({ views: 3000, likes: 120, comments: 30, shares: 9, saves: 7 }));
    const b2 = r.baris.find((b) => b.kontenId === k.k2)!;
    expect(b2).toMatchObject({ afiliasi: false, naik: null, er: 2, handle: `${tag}.b` });
  });

  it("status: menunggu cek, gagal beserta alasannya", async () => {
    const r = await daftar();
    expect(r.baris.find((b) => b.kontenId === k.k3)).toMatchObject({ status: "MENUNGGU", angka: null, er: null, naik: null });
    expect(r.baris.find((b) => b.kontenId === k.k5)).toMatchObject({ status: "GAGAL", alasanGagal: "TIDAK_DITEMUKAN" });
  });

  it("ringkasan memakai saringan yang sama: video, total views, rata-rata ER (= rata-rata engagementRate), dicek hari ini (WIB)", async () => {
    const { ringkasan } = await daftar();
    const er1 = engagementRate({ views: 3000, likes: 120, comments: 30, shares: 9, saves: 7 })!;
    const er2 = engagementRate({ views: 5000, likes: 100, comments: 0, shares: 0, saves: 0 })!;
    expect(ringkasan.video).toBe(4);
    expect(ringkasan.totalViews).toBe(8000);
    expect(Math.abs((ringkasan.rataEr ?? 0) - (er1 + er2) / 2)).toBeLessThanOrEqual(0.01);
    expect(ringkasan.dicekHariIni).toBe(1);
    expect((await daftar({ jenis: "kol" })).ringkasan).toMatchObject({ video: 1, totalViews: 5000, rataEr: er2 });
  });

  it("saring KOL/Afiliasi, cari nama atau handle (abai huruf besar), dan rentang tanggal tayang WIB", async () => {
    expect((await daftar({ jenis: "afiliasi" })).baris.map((b) => b.kontenId).sort()).toEqual([k.k1, k.k3, k.k5].sort());
    expect((await daftar({ jenis: "kol" })).baris.map((b) => b.kontenId)).toEqual([k.k2]);
    expect((await daftar({ cari: `@${tag}.B` })).baris.map((b) => b.kontenId)).toEqual([k.k2]);
    expect((await daftar({ cari: `${tag} satu` })).total).toBe(3);
    expect((await daftar({ cari: "%" })).total).toBe(0);
    expect((await daftar({ dari: "2003-03-07", sampai: "2003-03-07" })).baris.map((b) => b.kontenId)).toEqual([k.k2]);
    expect((await daftar({ dari: "2003-03-06", sampai: "2003-03-06" })).total).toBe(0);
    expect((await daftar({ dari: "2003-03-08" })).baris.map((b) => b.kontenId)).toEqual([k.k3]);
  });

  it("urutan lain: naik terbanyak, ER tertinggi (sama dengan engagementRate), tayang terbaru, dicek terbaru", async () => {
    expect((await daftar({ urut: "naik" })).baris[0].kontenId).toBe(k.k1);
    const er = (await daftar({ urut: "er" })).baris;
    expect(er.slice(0, 2).map((b) => b.kontenId)).toEqual([k.k1, k.k2]);
    expect(er[0].er! > er[1].er!).toBe(true);
    expect((await daftar({ urut: "tayang" })).baris.map((b) => b.kontenId)).toEqual([k.k3, k.k2, k.k1, k.k5]);
    expect((await daftar({ urut: "dicek" })).baris.slice(0, 2).map((b) => b.kontenId)).toEqual([k.k2, k.k1]);
  });

  it("halaman dipotong di server; halaman di luar batas jatuh ke halaman terakhir", async () => {
    const h1 = await daftar({}, { perHalaman: 3 });
    expect(h1).toMatchObject({ total: 4, halaman: 1, perHalaman: 3 });
    expect(h1.baris).toHaveLength(3);
    const h2 = await daftar({ halaman: "2" }, { perHalaman: 3 });
    expect(h2.baris).toHaveLength(1);
    expect((await daftar({ halaman: "9" }, { perHalaman: 3 })).halaman).toBe(2);
    expect(new Set([...h1.baris, ...h2.baris].map((b) => b.kontenId)).size).toBe(4);
  });
});
