import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import type { PengaturanBrand } from "./brand-collab";
import { bacaParamBrand } from "./brand-param";
import { brandKol, daftarBrand, kolUntukBrand } from "./brand-queries";

/*
 * Direktori brand dan tab Brand profil KOL terhadap basis data sungguhan.
 * Handle brand memuat tanda acak tes ini, dan setiap kueri disaring ke tanda
 * itu (atau ke pengaturan milik tes), jadi baris sungguhan tidak ikut terhitung.
 */

const tag = `ujibq${Math.random().toString(36).slice(2, 7)}`;
const ELORAE = `${tag}.elorae`;
const LAWAN = `${tag}.lawan`;
const LAIN = `${tag}.lain`;
const PG: PengaturanBrand = { akunElorae: [ELORAE], tagarElorae: [], kompetitor: [{ handle: LAWAN, nama: "Saingan Sejati" }], otomatisKePerforma: true };

let kolIds: string[] = [];

async function kol(nama: string, blokir = false) {
  const k = await prisma.kol.create({ data: { name: `${tag} ${nama}`, blockedAt: blokir ? new Date("2003-01-01") : null }, select: { id: true } });
  kolIds.push(k.id);
  return k.id;
}

let n = 0;
async function baris(kolId: string, brandHandle: string, isi: { jenis?: "BERBAYAR" | "KOLABORASI" | "TAG"; postedAt?: Date | null; views?: number | null; brandName?: string } = {}) {
  n += 1;
  await prisma.kolBrandCollab.create({
    data: {
      kunci: `TIKTOK:${tag}${n}:${brandHandle}`,
      kolId,
      platform: "TIKTOK",
      brandHandle,
      brandName: isi.brandName ?? null,
      jenis: isi.jenis ?? "TAG",
      postId: `${tag}${n}`,
      postedAt: isi.postedAt === undefined ? new Date(`2003-0${(n % 9) + 1}-10T00:00:00Z`) : isi.postedAt,
      views: isi.views === undefined ? 100 : isi.views,
      sumber: "EKSTENSI",
    },
  });
}

beforeEach(() => {
  kolIds = [];
  n = 0;
});

afterEach(async () => {
  await prisma.kolBrandCollab.deleteMany({ where: { kolId: { in: seededIds(kolIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

describe("daftarBrand", () => {
  it("satu baris per brand: jumlah KOL, jumlah posting, posting terakhir; terbaru dulu; lencana dari pengaturan", async () => {
    const a = await kol("A");
    const b = await kol("B");
    await baris(a, ELORAE, { postedAt: new Date("2003-05-01T00:00:00Z") });
    await baris(b, ELORAE, { postedAt: new Date("2003-06-01T00:00:00Z") });
    await baris(b, ELORAE, { postedAt: null });
    await baris(a, LAWAN, { postedAt: new Date("2003-07-01T00:00:00Z") });
    await baris(a, LAIN, { postedAt: new Date("2003-01-01T00:00:00Z"), brandName: "Lain Nama" });

    const r = await daftarBrand(bacaParamBrand({ cari: tag }), { pengaturan: PG });
    expect(r.total).toBe(3);
    expect(r.baris.map((x) => [x.brandHandle, x.kol, x.posting, x.label, x.nama])).toEqual([
      // Posting tanpa tanggal dihitung dengan waktu dicatatnya (hari ini) — jadi Elorae yang terbaru.
      [ELORAE, 2, 3, "ELORAE", null],
      [LAWAN, 1, 1, "KOMPETITOR", "Saingan Sejati"],
      [LAIN, 1, 1, null, "Lain Nama"],
    ]);
  });

  it("saringan kompetitor / Elorae, cari nama kompetitor, halaman", async () => {
    const a = await kol("A");
    await baris(a, ELORAE);
    await baris(a, LAWAN);
    await baris(a, LAIN);
    expect((await daftarBrand(bacaParamBrand({ saring: "kompetitor" }), { pengaturan: PG })).baris.map((x) => x.brandHandle)).toEqual([LAWAN]);
    expect((await daftarBrand(bacaParamBrand({ saring: "elorae" }), { pengaturan: PG })).baris.map((x) => x.brandHandle)).toEqual([ELORAE]);
    expect((await daftarBrand(bacaParamBrand({ cari: "saingan sejati" }), { pengaturan: PG })).baris.map((x) => x.brandHandle)).toEqual([LAWAN]);
    const h2 = await daftarBrand(bacaParamBrand({ cari: tag, halaman: "2" }), { pengaturan: PG, perHalaman: 2 });
    expect([h2.total, h2.halaman, h2.baris.length]).toEqual([3, 2, 1]);
    // Halaman di luar jangkauan jatuh ke halaman terakhir.
    expect((await daftarBrand(bacaParamBrand({ cari: tag, halaman: "99" }), { pengaturan: PG, perHalaman: 2 })).halaman).toBe(2);
  });
});

describe("kolUntukBrand", () => {
  it("KOL-KOL yang menandai satu brand, dengan rincian jenis, views, dan posting terakhir", async () => {
    const a = await kol("A");
    const b = await kol("B", true);
    await baris(a, ELORAE, { jenis: "BERBAYAR", views: 1000, postedAt: new Date("2003-02-01T00:00:00Z") });
    await baris(a, ELORAE, { jenis: "TAG", views: null, postedAt: new Date("2003-03-01T00:00:00Z") });
    await baris(b, ELORAE, { jenis: "KOLABORASI", views: 50, postedAt: new Date("2003-04-01T00:00:00Z") });
    await baris(b, LAWAN);
    const r = await kolUntukBrand(ELORAE, 1, { pengaturan: PG });
    expect(r.brand).toEqual({ brandHandle: ELORAE, nama: null, label: "ELORAE", posting: 3 });
    expect(r.total).toBe(2);
    expect(r.baris).toEqual([
      { kolId: b, nama: `${tag} B`, diblokir: true, posting: 1, berbayar: 0, kolaborasi: 1, tag: 0, views: 50, terakhir: "2003-04-01T00:00:00.000Z" },
      { kolId: a, nama: `${tag} A`, diblokir: false, posting: 2, berbayar: 1, kolaborasi: 0, tag: 1, views: 1000, terakhir: "2003-03-01T00:00:00.000Z" },
    ]);
  });
});

describe("brandKol", () => {
  it("riwayat brand satu KOL, posting terbaru dulu, tanpa tanggal di akhir", async () => {
    const a = await kol("A");
    await baris(a, LAIN, { postedAt: null });
    await baris(a, LAWAN, { postedAt: new Date("2003-08-01T00:00:00Z"), jenis: "BERBAYAR" });
    await baris(a, ELORAE, { postedAt: new Date("2003-09-01T00:00:00Z") });
    const r = await brandKol(a, { pengaturan: PG });
    expect(r.total).toBe(3);
    expect(r.baris.map((x) => [x.brandHandle, x.label, x.brandName])).toEqual([
      [ELORAE, "ELORAE", null],
      [LAWAN, "KOMPETITOR", "Saingan Sejati"],
      [LAIN, null, null],
    ]);
  });
});
