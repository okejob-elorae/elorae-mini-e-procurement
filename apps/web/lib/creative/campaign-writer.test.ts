import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { parseDateOnly } from "@/lib/date-only";
import { simpanCampaign } from "./campaign-writer";
import { daftarCampaign, detailCampaign } from "./campaign-queries";

/*
 * Campaign: penulis (arsip, jejak sebelum/sesudah) dan kueri (terpakai dan
 * bar budget dari `angkaKolaborasi`) terhadap basis data sungguhan.
 */

const tag = `KCW-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let userId = "";
let campaignId = "";
let kolId = "";
let kolabIds: string[] = [];

beforeEach(async () => {
  userId = "";
  campaignId = "";
  kolId = "";
  kolabIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} Dewi` }, select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.kolSale.deleteMany({ where: { collabId: { in: seededIds(kolabIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(campaignId) } });
  await prisma.kolCampaign.deleteMany({ where: { id: seededId(campaignId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

async function campaignBaru(isi: Partial<Parameters<typeof simpanCampaign>[0]["isi"]> = {}) {
  const r = await simpanCampaign({ isi: { name: `${tag} Lebaran`, ...isi }, olehUserId: userId });
  if (!r.ok) throw new Error(`simpanCampaign gagal: ${r.alasan}`);
  campaignId = r.id;
  return r.id;
}

let urut = 0;
async function kolab(tahap: string, fee: number, tambahan: { gmv?: number; komisi?: number; boost?: number } = {}) {
  urut += 1;
  const k = await prisma.kolBrief.create({
    data: {
      docNo: `${tag}/${urut}`,
      kolId,
      campaignId,
      tahap: tahap as never,
      fee,
      boostCost: tambahan.boost ?? 0,
    },
    select: { id: true },
  });
  kolabIds.push(k.id);
  if (tambahan.gmv || tambahan.komisi) {
    await prisma.kolSale.create({
      data: { collabId: k.id, date: new Date(), orders: 3, gmv: tambahan.gmv ?? 0, commission: tambahan.komisi ?? 0 },
    });
  }
  return k.id;
}

describe("simpanCampaign", () => {
  it("menolak nama kosong, periode terbalik, dan angka negatif", async () => {
    expect(await simpanCampaign({ isi: { name: "  " }, olehUserId: userId })).toMatchObject({ ok: false, alasan: "NAMA_WAJIB" });
    expect(
      await simpanCampaign({
        isi: { name: "x", startDate: parseDateOnly("2026-10-10"), endDate: parseDateOnly("2026-10-01") },
        olehUserId: userId,
      }),
    ).toMatchObject({ ok: false, alasan: "PERIODE_TIDAK_VALID" });
    expect(await simpanCampaign({ isi: { name: "x", budget: -1 }, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "ANGKA_TIDAK_VALID",
    });
    expect(await simpanCampaign({ isi: { name: "x", targetKol: 2.5 }, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "ANGKA_TIDAK_VALID",
    });
  });

  it("mencatat jejak pembuatan, lalu hanya kolom yang berubah", async () => {
    const id = await campaignBaru({ budget: 10_000_000, brand: "Eloraé" });
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "KOL_CAMPAIGN_CREATED" } })).toBe(1);

    await simpanCampaign({ id, isi: { name: `${tag} Lebaran`, budget: 12_000_000, brand: "Eloraé" }, olehUserId: userId });
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "KOL_CAMPAIGN_UPDATED" } });
    expect(j.changes).toEqual({ before: { budget: 10_000_000 }, after: { budget: 12_000_000 } });
  });

  it("mengarsipkan sekali (jejak tersendiri), dan bisa dibuka lagi", async () => {
    const id = await campaignBaru();
    await simpanCampaign({ id, isi: { name: `${tag} Lebaran`, arsip: true }, olehUserId: userId });
    const arsip = (await prisma.kolCampaign.findUniqueOrThrow({ where: { id } })).archivedAt;
    expect(arsip).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "KOL_CAMPAIGN_ARCHIVED" } })).toBe(1);

    // Menyimpan ulang yang sudah diarsip tidak menggeser tanggal arsipnya.
    await simpanCampaign({ id, isi: { name: `${tag} Lebaran`, arsip: true, note: "x" }, olehUserId: userId });
    expect((await prisma.kolCampaign.findUniqueOrThrow({ where: { id } })).archivedAt).toEqual(arsip);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "KOL_CAMPAIGN_ARCHIVED" } })).toBe(1);

    await simpanCampaign({ id, isi: { name: `${tag} Lebaran`, arsip: false }, olehUserId: userId });
    expect((await prisma.kolCampaign.findUniqueOrThrow({ where: { id } })).archivedAt).toBeNull();
  });
});

describe("daftarCampaign / detailCampaign — budget", () => {
  it("terpakai = biaya kolaborasi; kolaborasi yang keluar tanpa konten tidak lagi memakai fee", async () => {
    await campaignBaru({ budget: 5_000_000, targetKol: 4 });
    await kolab("DEAL", 2_000_000, { boost: 500_000, gmv: 6_000_000, komisi: 300_000 });
    await kolab("BATAL", 1_000_000, { komisi: 100_000 });
    const d = await detailCampaign(campaignId);
    expect(d).not.toBeNull();
    // 2.000.000 + 500.000 + 300.000 (aktif) + 100.000 (komisi kolaborasi batal; fee-nya tidak dihitung).
    expect(d!.terpakai).toBe(2_900_000);
    expect(d!.gmv).toBe(6_000_000);
    expect(d!.jumlahKolaborasi).toBe(2);
    expect(d!.jumlahKol).toBe(1);
    expect(d!.budget.keadaan).toBe("AMAN");
    expect(d!.roas).toBeCloseTo(6_000_000 / 2_900_000, 2);
  });

  it("kuning mulai 80%, merah bila lewat budget", async () => {
    await campaignBaru({ budget: 1_000_000 });
    const k = await kolab("DEAL", 850_000);
    expect((await detailCampaign(campaignId))!.budget.keadaan).toBe("HAMPIR");
    await prisma.kolBrief.update({ where: { id: k }, data: { fee: 1_200_000 } });
    const d = await detailCampaign(campaignId);
    expect(d!.budget.keadaan).toBe("LEWAT");
    expect(d!.budget.sisa).toBe(-200_000);
  });

  it("yang diarsip ada di bawah dan ikut saringan Arsip", async () => {
    const id = await campaignBaru();
    await simpanCampaign({ id, isi: { name: `${tag} Lebaran`, arsip: true }, olehUserId: userId });
    const arsip = await daftarCampaign({ status: "arsip" });
    expect(arsip.baris.some((b) => b.id === id && b.arsip)).toBe(true);
    const aktif = await daftarCampaign({ status: "aktif" });
    expect(aktif.baris.some((b) => b.id === id)).toBe(false);
    const semua = await daftarCampaign();
    const posisi = semua.baris.findIndex((b) => b.id === id);
    expect(semua.baris.slice(posisi).every((b) => b.arsip)).toBe(true);
    expect(semua.jumlah.semua).toBe(semua.jumlah.aktif + semua.jumlah.arsip);
  });
});
