import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { AMBANG_BAWAAN } from "./ambang";
import { CHIP_DAFTAR_KONTEN_KOL } from "./konten-kol";
import { daftarKontenKol, hitungKontenKol, jadwalTayang, kontenKolaborasi, riwayatAngka } from "./konten-kol-queries";

/**
 * Antrean Konten KOL terhadap basis data sungguhan. Semua kolaborasi uji ada
 * di satu campaign uji, dan setiap kueri disaring ke campaign itu — basis data
 * dev berisi data lain yang tidak boleh ikut terhitung.
 */

const tag = `KKQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let kolId = "";
let campaignId = "";
const brief: Record<string, string> = {};
let kontenTayangG = "";

const hari = (s: string, jamUtc = "05:00") => new Date(`${s}T${jamUtc}:00.000Z`);

async function kolaborasi(kunci: string, tahap: string, extra: Record<string, unknown> = {}) {
  brief[kunci] = (
    await prisma.kolBrief.create({
      data: { docNo: `${tag}/${kunci}`, kolId, campaignId, tahap: tahap as never, ...extra },
      select: { id: true },
    })
  ).id;
  return brief[kunci];
}

beforeAll(async () => {
  kolId = (
    await prisma.kol.create({
      data: { name: `${tag} Nadia`, accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}nadia`, followers: 20_000 }] } },
      select: { id: true },
    })
  ).id;
  campaignId = (await prisma.kolCampaign.create({ data: { name: `${tag} Campaign` }, select: { id: true } })).id;

  // Menunggu konten
  const a = await kolaborasi("A", "SAMPEL_DITERIMA");
  await prisma.kolShipment.create({ data: { collabId: a, trackingNo: "JNE1", sentAt: hari("2026-09-20"), receivedAt: hari("2026-09-25") } });
  await kolaborasi("B", "DEAL", { plannedLiveAt: hari("2026-10-15", "03:00") });
  // DEAL tapi ada pengiriman → masih urusan Sampel, bukan menunggu konten.
  const c = await kolaborasi("C", "DEAL");
  await prisma.kolShipment.create({ data: { collabId: c } });

  // Draf masuk
  const d = await kolaborasi("D", "DRAF");
  await prisma.kolContent.create({
    data: { collabId: d, platform: "TIKTOK", format: "VIDEO", draftLink: "https://drive.google.com/d", draftStatus: "MENUNGGU", draftAt: hari("2026-10-01") },
  });
  const e = await kolaborasi("E", "DRAF");
  await prisma.kolContent.create({
    data: { collabId: e, platform: "TIKTOK", format: "VIDEO", draftLink: "https://drive.google.com/e", draftStatus: "REVISI", draftNote: "Logo", draftAt: hari("2026-10-02") },
  });

  // Disetujui, belum tayang — dengan rencana tayang bulan depan yang jatuh 1 Nov WIB.
  const f = await kolaborasi("F", "DRAF_DISETUJUI");
  await prisma.kolContent.create({
    data: {
      collabId: f,
      platform: "INSTAGRAM",
      format: "REELS",
      draftLink: "https://drive.google.com/f",
      draftStatus: "DISETUJUI",
      approvedAt: hari("2026-10-03"),
      plannedAt: new Date("2026-10-31T17:30:00.000Z"),
    },
  });

  // Tayang
  const g = await kolaborasi("G", "TAYANG", { tahapAt: hari("2026-10-02") });
  kontenTayangG = (
    await prisma.kolContent.create({
      data: { collabId: g, platform: "TIKTOK", format: "VIDEO", link: "https://tiktok.com/@x/video/g", liveAt: new Date("2026-10-02T20:00:00.000Z") },
      select: { id: true },
    })
  ).id;
  await prisma.kolContentMetric.createMany({
    data: [
      { contentId: kontenTayangG, views: 1000, likes: 40, comments: 5, shares: 3, saves: 2, recordedAt: hari("2026-10-04") },
      { contentId: kontenTayangG, views: 3000, likes: 100, comments: 10, shares: 5, saves: 5, recordedAt: hari("2026-10-06") },
    ],
  });
  const i = await kolaborasi("I", "SAMPEL_DITERIMA");
  await prisma.kolContent.create({
    data: { collabId: i, platform: "TIKTOK", format: "VIDEO", link: "https://tiktok.com/@x/video/i", liveAt: hari("2026-09-15") },
  });

  // Keluar jalur: drafnya tidak menuntut review.
  const h = await kolaborasi("H", "BATAL");
  await prisma.kolContent.create({
    data: { collabId: h, platform: "TIKTOK", format: "VIDEO", draftLink: "https://drive.google.com/h", draftStatus: "MENUNGGU", draftAt: hari("2026-09-01") },
  });
}, 60_000);

afterAll(async () => {
  const ids = () => seededIds(Object.values(brief));
  await prisma.kolContentMetric.deleteMany({ where: { content: { collabId: { in: ids() } } } });
  await prisma.kolContent.deleteMany({ where: { collabId: { in: ids() } } });
  await prisma.kolShipment.deleteMany({ where: { collabId: { in: ids() } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: ids() } } });
  await prisma.kolCampaign.deleteMany({ where: { id: seededId(campaignId) } });
  await prisma.kolAccount.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

const opsi = { hariIni: "2026-10-07", ambang: AMBANG_BAWAAN, perHalaman: 100 };

describe("hitungan chip", () => {
  it("setiap angka chip sama dengan panjang daftarnya", async () => {
    const f = { campaignId };
    const hitungan = await hitungKontenKol(f);
    expect(hitungan).toEqual({ menunggu: 2, draf: 2, disetujui: 1, tayang: 2 });
    for (const chip of CHIP_DAFTAR_KONTEN_KOL) {
      const d = await daftarKontenKol(chip, f, opsi);
      expect(d.total).toBe(hitungan[chip]);
      expect(d.baris).toHaveLength(hitungan[chip]);
    }
  });

  it("pencarian ikut menyaring angka chip", async () => {
    expect(await hitungKontenKol({ campaignId, cari: `${tag.toLowerCase()}nadia` })).toEqual({ menunggu: 2, draf: 2, disetujui: 1, tayang: 2 });
    expect(await hitungKontenKol({ campaignId, cari: `@${tag}/D` })).toEqual({ menunggu: 0, draf: 1, disetujui: 0, tayang: 0 });
    expect(await hitungKontenKol({ campaignId, cari: "tidak-ada-yang-cocok-xyz" })).toEqual({ menunggu: 0, draf: 0, disetujui: 0, tayang: 0 });
  });

  it("?kolaborasi= menyempitkan angka dan daftar ke satu kolaborasi", async () => {
    expect(await hitungKontenKol({ kolaborasiId: brief.G })).toEqual({ menunggu: 0, draf: 0, disetujui: 0, tayang: 1 });
    const d = await daftarKontenKol("tayang", { kolaborasiId: brief.G }, opsi);
    expect(d.baris.map((b) => b.kolaborasiId)).toEqual([brief.G]);
    expect((await jadwalTayang("2026-10", { kolaborasiId: brief.B })).map((b) => b.kolaborasiId)).toEqual([brief.B]);
  });
});

describe("isi baris", () => {
  it("menunggu konten: umur sejak diterima, merah lewat ambang, terlama di atas", async () => {
    const d = await daftarKontenKol("menunggu", { campaignId }, opsi);
    if (d.chip !== "menunggu") throw new Error("chip salah");
    expect(d.baris.map((b) => b.kolaborasiId)).toEqual([brief.A, brief.B]);
    expect(d.baris[0]).toMatchObject({ sejak: "2026-09-25", umurHari: 12, merah: true, tanpaSampel: false });
    expect(d.baris[1]).toMatchObject({ tanpaSampel: true, rencanaTayang: "2026-10-15" });
  });

  it("draf masuk: MENUNGGU disorot setelah ambang review, REVISI membawa catatannya", async () => {
    const d = await daftarKontenKol("draf", { campaignId }, opsi);
    if (d.chip !== "draf") throw new Error("chip salah");
    const menunggu = d.baris.find((b) => b.kolaborasiId === brief.D)!;
    const revisi = d.baris.find((b) => b.kolaborasiId === brief.E)!;
    expect(menunggu).toMatchObject({ draftStatus: "MENUNGGU", menungguHari: 6, merah: true });
    expect(revisi).toMatchObject({ draftStatus: "REVISI", draftNote: "Logo", merah: false });
  });

  it("tayang: angka TERBARU yang mewakili, ER dari angka itu, dan halaman", async () => {
    const d = await daftarKontenKol("tayang", { campaignId }, { ...opsi, perHalaman: 1 });
    if (d.chip !== "tayang") throw new Error("chip salah");
    expect(d.total).toBe(2);
    expect(d.baris).toHaveLength(1);
    const g = d.baris[0];
    expect(g.kontenId).toBe(kontenTayangG);
    expect(g.tayangHari).toBe("2026-10-03");
    expect(g.angkaTerakhir).toMatchObject({ views: 3000, likes: 100, hari: "2026-10-06" });
    expect(g.jumlahAngka).toBe(2);
    expect(g.er).toBe(4);
    // Tayang 3 Okt, angka terakhir 6 Okt: H+7 (10 Okt) belum jatuh tempo.
    expect(g.peringatan.kosong).toEqual([]);
    expect(g.peringatan.berikut?.jenis).toBe("ANGKA_H7");

    const h2 = await daftarKontenKol("tayang", { campaignId }, { ...opsi, perHalaman: 1, halaman: 2 });
    expect(h2.baris).toHaveLength(1);
    expect(h2.baris[0].kolaborasiId).toBe(brief.I);
  });

  it("riwayat angka: semua baris, terbaru dulu", async () => {
    const r = await riwayatAngka(kontenTayangG);
    expect(r.map((b) => b.views)).toEqual([3000, 1000]);
  });
});

describe("jadwal tayang", () => {
  it("mengelompokkan menurut HARI WIB dan hanya bulan yang diminta", async () => {
    const okt = await jadwalTayang("2026-10", { campaignId });
    const ringkas = okt.map((b) => `${b.tanggal}:${b.jenis}:${b.kolaborasiId === brief.G ? "G" : b.kolaborasiId === brief.B ? "B" : "?"}`);
    // G tayang 2 Okt 20.00 UTC = 3 Okt WIB; B hanya punya rencana tayang di kolaborasinya.
    expect(ringkas).toContain("2026-10-03:TAYANG:G");
    expect(ringkas).toContain("2026-10-15:RENCANA:B");
    // Rencana F jatuh 1 Nov WIB, bukan 31 Okt.
    expect(okt.some((b) => b.kolaborasiId === brief.F)).toBe(false);
    const nov = await jadwalTayang("2026-11", { campaignId });
    expect(nov.find((b) => b.kolaborasiId === brief.F)).toMatchObject({ tanggal: "2026-11-01", jenis: "RENCANA" });
    // I tayang September.
    expect(okt.some((b) => b.kolaborasiId === brief.I)).toBe(false);
  });
});

describe("panel konten kolaborasi", () => {
  it("memuat konten dengan seluruh riwayat angkanya", async () => {
    const p = await kontenKolaborasi(brief.G, { hariIni: "2026-10-07", ambang: AMBANG_BAWAAN });
    expect(p?.konten).toHaveLength(1);
    expect(p!.konten[0].angka.map((a) => a.views)).toEqual([3000, 1000]);
    expect(await kontenKolaborasi("tidak-ada", { hariIni: "2026-10-07" })).toBeNull();
  });
});
