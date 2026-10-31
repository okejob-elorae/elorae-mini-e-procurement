import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { geserHari } from "@/lib/tanggal-isian";
import { CHIP_BAYAR } from "./bayar-aturan";
import { catatPembayaran } from "./bayar-writer";
import { daftarPembayaran, dataPanelBayar, semuaBarisBayar } from "./bayar-queries";
import { bacaAmbangKreatif } from "./pengaturan";

/*
 * Daftar Pembayaran terhadap basis data sungguhan. Setiap kueri dicakup ke
 * campaign uji sendiri, jadi data lain di basis data tidak ikut terhitung.
 */

const HARI_INI = "2026-10-07";
const tag = `BAYARQ-${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let kolIds: string[] = [];
let kolabIds: string[] = [];
let campaignId = "";
const id: Record<string, string> = {};

async function kol(nama: string, handle: string) {
  const k = await prisma.kol.create({
    data: { name: `${tag} ${nama}`, accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}-${handle}`, followers: 1000 }] } },
    select: { id: true },
  });
  kolIds.push(k.id);
  return k.id;
}

async function kolaborasi(
  kunci: string,
  kolId: string,
  data: { fee: number; tahap?: "TAYANG" | "BATAL" | "DEAL"; payStatus: "BELUM" | "SEBAGIAN" | "LUNAS" | "TIDAK_PERLU"; paidAmount?: number; paidAt?: Date; tayang?: Date },
) {
  const c = await prisma.kolBrief.create({
    data: {
      docNo: `${tag}/${kunci}`,
      kolId,
      campaignId,
      fee: data.fee,
      tahap: data.tahap ?? "TAYANG",
      payStatus: data.payStatus,
      paidAmount: data.paidAmount ?? 0,
      paidAt: data.paidAt ?? null,
      ...(data.tayang
        ? { kolContents: { create: [{ platform: "TIKTOK", format: "VIDEO", link: `https://contoh.test/${kunci}`, liveAt: data.tayang }] } }
        : {}),
    },
    select: { id: true },
  });
  kolabIds.push(c.id);
  id[kunci] = c.id;
}

beforeEach(async () => {
  userId = "";
  kolIds = [];
  kolabIds = [];
  campaignId = "";
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  campaignId = (await prisma.kolCampaign.create({ data: { name: `${tag} campaign` }, select: { id: true } })).id;
  const nadia = await kol("Nadia", "nadia");
  const rina = await kol("Rina", "rina");
  await kolaborasi("a", nadia, { fee: 1_000_000, payStatus: "BELUM", tayang: new Date("2026-09-01T03:00:00Z") });
  await kolaborasi("b", rina, { fee: 2_000_000, payStatus: "SEBAGIAN", paidAmount: 500_000, paidAt: new Date("2026-10-02T03:00:00Z") });
  await kolaborasi("c", rina, { fee: 300_000, payStatus: "LUNAS", paidAmount: 300_000, paidAt: new Date("2026-10-03T03:00:00Z") });
  await kolaborasi("d", nadia, { fee: 0, payStatus: "TIDAK_PERLU" });
  await kolaborasi("e", nadia, { fee: 400_000, payStatus: "BELUM", tahap: "BATAL" });
  await kolaborasi("f", rina, { fee: 600_000, payStatus: "TIDAK_PERLU" });
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(kolabIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
  if (campaignId) await prisma.kolCampaign.delete({ where: { id: seededId(campaignId) } });
});

describe("daftarPembayaran", () => {
  it("jumlah per chip sama dengan panjang daftarnya; fee 0 dan batal-tanpa-konten tidak ikut", async () => {
    const pertama = await daftarPembayaran({ campaignId, chip: "SEMUA", perHalaman: 100 }, HARI_INI);
    expect(pertama.jumlahPerChip).toEqual({ BELUM: 2, SEBAGIAN: 1, LUNAS: 1, SEMUA: 4 });
    for (const chip of CHIP_BAYAR) {
      const r = await daftarPembayaran({ campaignId, chip, perHalaman: 100 }, HARI_INI);
      expect(r.baris).toHaveLength(r.jumlahPerChip[chip]);
      expect(r.total).toBe(r.jumlahPerChip[chip]);
    }
    const ids = pertama.baris.map((b) => b.id);
    expect(ids).not.toContain(id.d);
    expect(ids).not.toContain(id.e);
    // Fee yang masih tercatat TIDAK_PERLU dibaca belum dibayar.
    expect(pertama.baris.find((b) => b.id === id.f)?.payStatus).toBe("BELUM");
  });

  it("tiga kartu mengikuti saringan yang aktif", async () => {
    const semua = await daftarPembayaran({ campaignId, chip: "SEMUA" }, HARI_INI);
    expect(semua.ringkas).toEqual({ jumlah: 4, totalFee: 3_900_000, dibayar: 800_000, sisa: 3_100_000 });
    const belum = await daftarPembayaran({ campaignId, chip: "BELUM" }, HARI_INI);
    expect(belum.ringkas).toEqual({ jumlah: 2, totalFee: 1_600_000, dibayar: 0, sisa: 1_600_000 });
  });

  it("yang belum lunas di depan; jatuh tempo = tayang + ambang, lewat sesudah harinya", async () => {
    const r = await daftarPembayaran({ campaignId, chip: "SEMUA" }, HARI_INI);
    expect(r.baris.at(-1)?.id).toBe(id.c);
    const ambang = await bacaAmbangKreatif();
    const a = r.baris.find((b) => b.id === id.a)!;
    expect(a.jatuhTempo?.tanggal).toBe(geserHari("2026-09-01", ambang.jatuhTempoBayarHari));
    expect(a.jatuhTempo?.lewat).toBe(true);
    expect(a.sisa).toBe(1_000_000);
    expect(r.baris.find((b) => b.id === id.b)).toMatchObject({ dibayar: 500_000, sisa: 1_500_000, paidAt: "2026-10-02", jatuhTempo: null });
  });

  it("mencari @handle dan memotong halaman tanpa tumpang tindih", async () => {
    const cari = await daftarPembayaran({ campaignId, chip: "SEMUA", cari: `@${tag.toLowerCase()}-nadia` }, HARI_INI);
    expect(cari.baris.map((b) => b.id)).toEqual([id.a]);

    const semua = await semuaBarisBayar({ campaignId, chip: "SEMUA" }, HARI_INI);
    expect(semua).toHaveLength(4);
    const h1 = await daftarPembayaran({ campaignId, chip: "SEMUA", perHalaman: 25, halaman: 1 }, HARI_INI);
    const h9 = await daftarPembayaran({ campaignId, chip: "SEMUA", perHalaman: 25, halaman: 9 }, HARI_INI);
    expect(h9.halaman).toBe(1);
    expect(h1.baris.map((b) => b.id)).toEqual(semua.map((b) => b.id));
  });
});

describe("dataPanelBayar", () => {
  it("membawa keadaan bayar dan riwayat dari jejak", async () => {
    await catatPembayaran({ kolaborasiId: id.a, status: "SEBAGIAN", jumlah: 250_000, tanggal: "2026-10-01", olehUserId: userId });
    await catatPembayaran({ kolaborasiId: id.a, status: "LUNAS", tanggal: "2026-10-02", olehUserId: userId });
    const p = await dataPanelBayar(id.a, HARI_INI);
    expect(p).toMatchObject({ payStatus: "LUNAS", dibayar: 1_000_000, sisa: 0, paidAt: "2026-10-02", jatuhTempo: null });
    expect(p!.riwayat).toHaveLength(2);
    expect(p!.riwayat[0].sesudah).toMatchObject({ payStatus: "LUNAS", paidAmount: 1_000_000 });
    expect(p!.riwayat[1].sebelum).toMatchObject({ payStatus: "BELUM" });
    expect(await dataPanelBayar("tidak-ada", HARI_INI)).toBeNull();
  });
});
