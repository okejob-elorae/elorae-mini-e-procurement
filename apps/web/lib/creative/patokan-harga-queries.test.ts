import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { patokanHargaKol } from "./patokan-harga-queries";

/*
 * Patokan harga terhadap basis data sungguhan. Data di 2003, dibatasi ke kolaborasi tes ini lewat
 * `kolaborasiIds`. Teardown lewat `seededIds()`.
 */

const tag = `ujipatokan${Math.random().toString(36).slice(2, 7)}`;
const TAYANG = new Date("2003-04-01T03:00:00Z");
const H8 = new Date("2003-04-09T03:00:00Z");

let kolIds: string[] = [];
let briefIds: string[] = [];
let kontenIds: string[] = [];

async function kolaborasi(nomor: number, isi: { fee: number; tahap?: "TAYANG" | "DEAL" | "SELESAI"; views: number | null; dicatat?: Date }) {
  const kol = await prisma.kol.create({ data: { name: `${tag} ${nomor}` }, select: { id: true } });
  kolIds.push(kol.id);
  const b = await prisma.kolBrief.create({
    data: { docNo: `${tag}/${nomor}`, kolId: kol.id, tahap: isi.tahap ?? "TAYANG", jenis: "BAYAR", fee: isi.fee },
    select: { id: true },
  });
  briefIds.push(b.id);
  const c = await prisma.kolContent.create({
    data: { collabId: b.id, platform: "TIKTOK", format: "VIDEO", link: `https://www.tiktok.com/@${tag}/video/73012345678901234${nomor}`, liveAt: TAYANG },
    select: { id: true },
  });
  kontenIds.push(c.id);
  // Angka lama yang lebih kecil: harus kalah oleh angka terakhir.
  await prisma.kolContentMetric.create({ data: { contentId: c.id, recordedAt: new Date("2003-04-02T03:00:00Z"), views: 1 } });
  if (isi.views !== null) await prisma.kolContentMetric.create({ data: { contentId: c.id, recordedAt: isi.dicatat ?? H8, views: isi.views } });
  return b.id;
}

beforeAll(async () => {
  kolIds = [];
  briefIds = [];
  kontenIds = [];
  await kolaborasi(1, { fee: 4_000_000, views: 200_000 });
  await kolaborasi(2, { fee: 6_000_000, views: 200_000 });
  await kolaborasi(3, { fee: 8_000_000, views: 200_000, tahap: "SELESAI" });
  await kolaborasi(4, { fee: 10_000_000, views: 200_000 });
  // Dilewati: belum tayang, angka baru 3 hari.
  await kolaborasi(5, { fee: 99_000_000, views: 200_000, tahap: "DEAL" });
  await kolaborasi(6, { fee: 99_000_000, views: 200_000, dicatat: new Date("2003-04-04T03:00:00Z") });
});

afterAll(async () => {
  await prisma.kolContentMetric.deleteMany({ where: { contentId: { in: seededIds(kontenIds) } } });
  await prisma.kolContent.deleteMany({ where: { id: { in: seededIds(kontenIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(briefIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

describe("patokanHargaKol", () => {
  it("empat sampel sah dari enam kolaborasi → belum cukup untuk patokan", async () => {
    expect(await patokanHargaKol({ kolaborasiIds: briefIds })).toMatchObject({ n: 4, cukup: false });
  });

  it("sampel kelima → kuartil dari angka terakhir tiap video, bukan angka lamanya", async () => {
    const id = await kolaborasi(7, { fee: 12_000_000, views: 200_000 });
    const p = await patokanHargaKol({ kolaborasiIds: briefIds });
    expect(briefIds).toContain(id);
    expect(p).toMatchObject({ n: 5, cukup: true, p25: 30_000, median: 40_000, p75: 50_000 });
  });
});
