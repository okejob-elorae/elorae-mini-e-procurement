import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { barisPerforma, dataRekap, peringkatKol } from "./laporan-queries";
import { susunRekap } from "./rekap";

/*
 * Laporan terhadap basis data sungguhan. Data uji ditaruh di Maret 2001 —
 * periode yang tidak dimiliki data lain — dan kueri "Semua" dicakup lewat
 * pencarian tag, jadi isi basis data lain tidak ikut terhitung.
 */

const tag = `LAPUJI${Math.random().toString(36).slice(2, 7)}`;
const MARET = { dari: "2001-03-01", sampai: "2001-03-31" };
const w = (hari: string, jam = "03:00") => new Date(`${hari}T${jam}:00.000Z`);

let userId = "";
let itemId = "";
let campaignId = "";
let kolIds: string[] = [];
let kolabIds: string[] = [];
const kol: Record<string, string> = {};
const kolab: Record<string, string> = {};

async function buatKol(kunci: string, followers: number, createdAt?: Date) {
  const k = await prisma.kol.create({
    data: {
      name: `${tag} ${kunci}`,
      ...(createdAt ? { createdAt } : {}),
      accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}${kunci.toLowerCase()}`, followers }] },
    },
    select: { id: true },
  });
  kolIds.push(k.id);
  kol[kunci] = k.id;
}

async function buatKolab(
  kunci: string,
  kolKunci: string,
  d: {
    fee: number;
    dealAt?: Date | null;
    tahap?: "PROSPEK" | "TAYANG";
    konten?: { liveAt: Date; views: number }[];
    jual?: { date: Date; orders: number; gmv: number }[];
  },
) {
  const c = await prisma.kolBrief.create({
    data: {
      docNo: `${tag}/${kunci}`,
      kolId: kol[kolKunci],
      campaignId,
      fee: d.fee,
      dealAt: d.dealAt ?? null,
      tahap: d.tahap ?? "TAYANG",
      payStatus: d.fee > 0 ? "BELUM" : "TIDAK_PERLU",
    },
    select: { id: true },
  });
  kolabIds.push(c.id);
  kolab[kunci] = c.id;
  for (const [i, k] of (d.konten ?? []).entries()) {
    await prisma.kolContent.create({
      data: {
        collabId: c.id,
        platform: "TIKTOK",
        format: "VIDEO",
        link: `https://contoh.test/${kunci}/${i}`,
        liveAt: k.liveAt,
        metrics: { create: [{ recordedAt: k.liveAt, views: k.views, likes: 10 }] },
      },
    });
  }
  if (d.jual?.length) await prisma.kolSale.createMany({ data: d.jual.map((j) => ({ collabId: c.id, ...j })) });
}

beforeEach(async () => {
  userId = "";
  itemId = "";
  campaignId = "";
  kolIds = [];
  kolabIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  itemId = (await prisma.item.findFirstOrThrow({ select: { id: true } })).id;
  campaignId = (await prisma.kolCampaign.create({ data: { name: `${tag} Ramadan` }, select: { id: true } })).id;

  await buatKol("A", 90_000);
  await buatKol("B", 40_000);
  await buatKol("C", 10_000);
  await buatKol("D", 5_000);
  await buatKol("E", 12_300, w("2001-03-06"));

  await buatKolab("a1", "A", {
    fee: 1_000_000,
    dealAt: w("2001-03-05"),
    konten: [{ liveAt: w("2001-03-06"), views: 100_000 }],
    jual: [{ date: w("2001-03-06"), orders: 10, gmv: 3_000_000 }],
  });
  await buatKolab("b1", "B", {
    fee: 400_000,
    dealAt: w("2001-03-07"),
    konten: [
      { liveAt: w("2001-03-08"), views: 30_000 },
      { liveAt: w("2001-03-09"), views: 20_000 },
    ],
    jual: [{ date: w("2001-03-10"), orders: 2, gmv: 500_000 }],
  });
  await buatKolab("c1", "C", { fee: 0, tahap: "PROSPEK" });
  await buatKolab("d1", "D", { fee: 200_000, dealAt: w("2001-04-02"), jual: [{ date: w("2001-04-03"), orders: 1, gmv: 100_000 }] });

  await prisma.kolShipment.create({
    data: {
      collabId: kolab.a1,
      courier: "JNE",
      trackingNo: `${tag}-RESI`,
      sentAt: w("2001-03-06", "02:00"),
      stockIssuedAt: w("2001-03-06", "02:00"),
      shippingCost: 20_000,
      lines: { create: [{ itemId, itemName: "Contoh", qty: 2, unitCost: 50_000 }] },
    },
  });
  await prisma.auditLog.create({
    data: {
      userId,
      action: "KOL_COLLAB_STAGE_CHANGED",
      entityType: "KolBrief",
      entityId: kolab.a1,
      changes: { before: { tahap: "SAMPEL_DITERIMA" }, after: { tahap: "TAYANG" } },
      createdAt: w("2001-03-06", "04:00"),
    },
  });
  await prisma.kolNote.create({ data: { kolId: kol.A, body: "Minta revisi\ncaption", createdAt: w("2001-03-06", "05:15") } });
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(kolabIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
  if (campaignId) await prisma.kolCampaign.delete({ where: { id: seededId(campaignId) } });
});

describe("peringkatKol", () => {
  it("hanya KOL yang beraktivitas di periode; GMV terbesar dulu; angka dari angkaKolaborasi", async () => {
    const r = await peringkatKol({ periode: MARET });
    expect(r.total).toBe(2);
    expect(r.baris.map((b) => b.kolId)).toEqual([kol.A, kol.B]);
    expect(r.baris[0]).toMatchObject({ peringkat: 1, views: 100_000, orders: 10, gmv: 3_000_000, jumlahKonten: 1, pengikut: 90_000, platform: "TIKTOK" });
    // Biaya A = fee 1.000.000 + ongkir 20.000 + sampel 2 × 50.000.
    expect(r.baris[0].biaya).toBe(1_120_000);
    expect(r.baris[0].roas).toBe(2.68);
    expect(r.baris[0].cpm).toBe(11_200);
  });

  it("urutan mengikuti pilihan; CPM termurah naik", async () => {
    const urutan = async (urut: "roas" | "konten" | "cpm" | "biaya" | "views") =>
      (await peringkatKol({ periode: MARET, urut })).baris.map((b) => b.kolId);
    expect(await urutan("konten")).toEqual([kol.B, kol.A]);
    expect(await urutan("cpm")).toEqual([kol.B, kol.A]); // B: 400.000 / 50.000 views = 8.000
    expect(await urutan("roas")).toEqual([kol.A, kol.B]);
    expect(await urutan("biaya")).toEqual([kol.A, kol.B]);
    expect(await urutan("views")).toEqual([kol.A, kol.B]);
  });

  it("nomor peringkat berlanjut lintas halaman", async () => {
    const h2 = await peringkatKol({ periode: MARET, perHalaman: 1, halaman: 2 });
    expect(h2.total).toBe(2);
    expect(h2.baris).toHaveLength(1);
    expect(h2.baris[0]).toMatchObject({ peringkat: 2, kolId: kol.B });
  });

  it("Semua = tanpa batas periode; KOL tanpa angka apa pun tetap tidak ikut", async () => {
    const r = await peringkatKol({ periode: null, cari: tag });
    expect(new Set(r.baris.map((b) => b.kolId))).toEqual(new Set([kol.A, kol.B, kol.D]));
  });

  it("CSV performa per kolaborasi untuk periode yang sama", async () => {
    const baris = await barisPerforma({ periode: MARET });
    expect(baris.map((b) => b.docNo)).toEqual([`${tag}/a1`, `${tag}/b1`]);
    expect(baris[0]).toMatchObject({ fee: 1_000_000, biayaKirim: 120_000, totalBiaya: 1_120_000, campaign: `${tag} Ramadan` });
  });
});

describe("dataRekap", () => {
  it("satu hari: ringkasan, pengiriman, konten, KOL baru, perubahan tahap, catatan", async () => {
    const d = await dataRekap({ dari: "2001-03-06", sampai: "2001-03-06", userId, denganTugas: false, sekarang: w("2001-03-06", "10:00") });
    expect(d.ringkasan).toEqual({
      kolBaru: 1,
      barangDikirim: 1,
      barangDiterima: 0,
      kontenTayang: 1,
      views: 100_000,
      orders: 10,
      gmv: 3_000_000,
      komisi: 0,
      biayaFee: 0,
      biayaPph: 0,
      biayaKirim: 120_000,
      biayaBoost: 0,
    });
    const handleA = `@${tag.toLowerCase()}a`;
    expect(d.pengiriman).toEqual([{ kol: handleA, platform: "TikTok", kurir: "JNE", resi: `${tag}-RESI` }]);
    expect(d.kontenTayang).toEqual([{ kol: handleA, platform: "TikTok", views: 100_000, link: `https://contoh.test/a1/0`, tanggal: "2001-03-06" }]);
    expect(d.kolBaru).toEqual([{ kol: `@${tag.toLowerCase()}e`, platform: "TikTok", pengikut: 12_300 }]);
    expect(d.perubahanTahap).toEqual([{ kol: handleA, dari: "SAMPEL_DITERIMA", ke: "TAYANG" }]);
    expect(d.catatan).toEqual([{ kol: handleA, waktu: w("2001-03-06", "05:15"), isi: "Minta revisi\ncaption" }]);
    expect(d.teratas).toEqual([{ kol: handleA, platform: "TikTok", gmv: 3_000_000, orders: 10 }]);
    expect(d.tindakLanjut).toEqual([]);

    const teks = susunRekap(d);
    expect(teks.startsWith("REKAP KOL — Selasa, 6 Maret 2001\n")).toBe(true);
    expect(teks).toContain(`- ${handleA} (TikTok) | JNE ${tag}-RESI`);
    expect(teks).toContain("- Minta revisi caption".slice(2));
  });

  it("rentang: per campaign dan teratas dari seluruh rentang", async () => {
    const d = await dataRekap({ ...MARET, userId, denganTugas: false });
    expect(d.ringkasan).toMatchObject({ kontenTayang: 3, views: 150_000, orders: 12, gmv: 3_500_000, biayaFee: 1_400_000 });
    expect(d.perCampaign).toEqual([{ nama: `${tag} Ramadan`, kol: 2, views: 150_000, gmv: 3_500_000 }]);
    expect(d.teratas.map((t) => t.gmv)).toEqual([3_000_000, 500_000]);
    expect(d.posisi.find((p) => p.tahap === "TAYANG")!.jumlah).toBeGreaterThanOrEqual(3);
  });

  it("menghitung tugas tindak lanjut tanpa galat", async () => {
    const d = await dataRekap({ dari: "2001-03-06", sampai: "2001-03-06", userId });
    expect(Array.isArray(d.tindakLanjut)).toBe(true);
    expect(d.tindakLanjut.every((t) => typeof t.judul === "string" && t.jumlah >= 0)).toBe(true);
  });
});
