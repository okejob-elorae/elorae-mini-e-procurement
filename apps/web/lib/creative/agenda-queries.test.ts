import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { kalenderKreatif } from "./agenda-queries";

/*
 * Kalender terhadap basis data sungguhan, dibatasi ke baris tes lewat
 * `cakupan`: kejadian jatuh ke hari WIB-nya dan diringkas per jenis, tenggat
 * jatuh ke tanggal tenggatnya, agenda hanya milik orang yang melihat.
 */

const tag = `KALUJI-${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let kolIds: string[] = [];
let kolabIds: string[] = [];
let agendaIds: string[] = [];
let campaignIds: string[] = [];

/** 12.00 WIB pada hari itu. */
const siang = (tgl: string) => new Date(`${tgl}T05:00:00Z`);

beforeEach(async () => {
  userId = "";
  kolIds = [];
  kolabIds = [];
  agendaIds = [];
  campaignIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.kolAgenda.deleteMany({ where: { id: { in: seededIds(agendaIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  await prisma.kolCampaign.deleteMany({ where: { id: { in: seededIds(campaignIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

async function kolaborasi(nama: string, isi: Record<string, unknown> = {}) {
  const k = await prisma.kol.create({
    data: { name: `${tag} ${nama}`, accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}${nama}`, followers: 1000 }] } },
    select: { id: true },
  });
  kolIds.push(k.id);
  const c = await prisma.kolBrief.create({ data: { docNo: `${tag}-${nama}`, kolId: k.id, tahap: "TAYANG", ...isi } as never, select: { id: true } });
  kolabIds.push(c.id);
  return c.id;
}

describe("kalenderKreatif", () => {
  it("kejadian diringkas per jenis per hari WIB, dengan jumlah dan nilai", async () => {
    const a = await kolaborasi("a", { fee: 400_000, paidAmount: 400_000, paidAt: siang("2026-10-09"), payStatus: "LUNAS" });
    const b = await kolaborasi("b");
    // 23.30 WIB tanggal 4 = 16.30 UTC tanggal 4 — tetap hari ke-4.
    await prisma.kolShipment.create({ data: { collabId: a, courier: "JNE", trackingNo: "R1", sentAt: new Date("2026-10-04T16:30:00Z"), receivedAt: siang("2026-10-07") } });
    await prisma.kolShipment.create({ data: { collabId: b, trackingNo: "R2", sentAt: siang("2026-10-04") } });
    const ka = await prisma.kolContent.create({ data: { collabId: a, platform: "TIKTOK", format: "VIDEO", link: "https://contoh.test/a", liveAt: siang("2026-10-08") }, select: { id: true } });
    await prisma.kolContentMetric.createMany({
      data: [
        { contentId: ka.id, recordedAt: siang("2026-10-09"), views: 1_000 },
        { contentId: ka.id, recordedAt: siang("2026-10-12"), views: 5_000 },
      ],
    });
    await prisma.kolContent.create({ data: { collabId: b, platform: "TIKTOK", format: "VIDEO", plannedAt: siang("2026-10-15") } });
    const cp = await prisma.kolCampaign.create({ data: { name: `${tag} cp`, startDate: siang("2026-10-01") }, select: { id: true } });
    campaignIds.push(cp.id);

    const k = await kalenderKreatif({
      dari: "2026-09-28",
      sampai: "2026-11-01",
      userId,
      hariIni: "2026-10-20",
      cakupan: { kolaborasiIds: kolabIds, campaignIds, agendaIds },
    });
    const kirim = k.hari["2026-10-04"].kejadian.find((g) => g.jenis === "KIRIM")!;
    expect(kirim.jumlah).toBe(2);
    expect(kirim.baris.map((x) => x.kolaborasiId).sort()).toEqual([a, b].sort());
    expect(k.hari["2026-10-07"].kejadian.map((g) => g.jenis)).toEqual(["SAMPAI"]);
    expect(k.hari["2026-10-08"].kejadian.find((g) => g.jenis === "TAYANG")?.nilai).toBe(5_000);
    expect(k.hari["2026-10-09"].kejadian.find((g) => g.jenis === "DIBAYAR")?.nilai).toBe(400_000);
    expect(k.hari["2026-10-15"].kejadian.map((g) => g.jenis)).toEqual(["RENCANA_TAYANG"]);
    expect(k.hari["2026-10-01"].kejadian.map((g) => g.jenis)).toEqual(["CAMPAIGN_MULAI"]);
  });

  it("tenggat jatuh di tanggal tenggatnya, ditandai lewat bila harinya sudah berganti", async () => {
    // Deal 1 Okt, ambang bawaan deal → kirim 3 hari = tenggat 4 Okt.
    const id = await kolaborasi("c", { tahap: "DEAL", dealAt: siang("2026-10-01") });
    const k = await kalenderKreatif({ dari: "2026-09-28", sampai: "2026-11-01", userId, hariIni: "2026-10-20", cakupan: { kolaborasiIds: kolabIds, campaignIds: [], agendaIds: [] } });
    const g = k.hari["2026-10-04"].tenggat.find((t) => t.jenis === "KIRIM_SAMPEL")!;
    expect(g.baris[0]).toMatchObject({ kolaborasiId: id, lewat: true });
    expect(k.dealBelumKirim.jumlah).toBe(1);
    expect(k.dealBelumKirim.contoh[0].id).toBe(id);

    const sebelum = await kalenderKreatif({ dari: "2026-09-28", sampai: "2026-11-01", userId, hariIni: "2026-10-04", cakupan: { kolaborasiIds: kolabIds, campaignIds: [], agendaIds: [] } });
    expect(sebelum.hari["2026-10-04"].tenggat[0].baris[0].lewat).toBe(false);
  });

  it("agenda milik sendiri saja, urut jam, dengan daftar persiapan", async () => {
    const lain = await prisma.user.findFirst({ where: { id: { not: userId } }, select: { id: true } });
    const a1 = await prisma.kolAgenda.create({
      data: { title: `${tag} sore`, date: siang("2026-10-10"), time: "16:00", ownerId: userId, checklist: JSON.stringify([{ teks: "Deck", selesai: true }]) },
      select: { id: true },
    });
    const a2 = await prisma.kolAgenda.create({ data: { title: `${tag} pagi`, date: siang("2026-10-10"), time: "08:30", ownerId: userId }, select: { id: true } });
    agendaIds.push(a1.id, a2.id);
    if (lain) {
      const a3 = await prisma.kolAgenda.create({ data: { title: `${tag} orang lain`, date: siang("2026-10-10"), ownerId: lain.id }, select: { id: true } });
      agendaIds.push(a3.id);
    }
    const k = await kalenderKreatif({ dari: "2026-09-28", sampai: "2026-11-01", userId, hariIni: "2026-10-20", cakupan: { kolaborasiIds: [], campaignIds: [], agendaIds } });
    expect(k.hari["2026-10-10"].agenda.map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(k.hari["2026-10-10"].agenda[1].checklist).toEqual([{ teks: "Deck", selesai: true }]);
  });
});
