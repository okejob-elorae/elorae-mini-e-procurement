import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededIds } from "@elorae/db";

/*
 * Penulis kolaborasi (ubah isi, pindah tahap satuan & massal, masukkan ke
 * campaign) terhadap basis data sungguhan. `runSerializable` dibungkus untuk
 * menghitung transaksi: "masukkan ke campaign" harus SATU transaksi, bukan
 * satu per KOL — setengah masuk adalah keadaan yang tidak bisa dijelaskan.
 */
const hitungTx = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/db/tx-retry", async (asli) => {
  const m = await asli<typeof import("@/lib/db/tx-retry")>();
  return {
    ...m,
    runSerializable: (cb: Parameters<typeof m.runSerializable>[0]) => {
      hitungTx.n += 1;
      return m.runSerializable(cb);
    },
  };
});

import { buatBrief, pindahTahapKolaborasi } from "./writer";
import {
  masukkanKeCampaign,
  pindahkanKeCampaign,
  pindahTahapBanyak,
  statusBayarSesudahUbahFee,
  ubahKolaborasi,
} from "./kolaborasi-writer";

const tag = `KLW-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let userId = "";
let kolA = "";
let kolB = "";
let kolBlokir = "";
let campaignId = "";
let campaignArsip = "";
let briefIds: string[] = [];

async function buatKol(nama: string, blokir = false) {
  return (
    await prisma.kol.create({
      data: { name: `${tag} ${nama}`, ...(blokir ? { blockedAt: new Date(), blockReason: "pernah menipu" } : {}) },
      select: { id: true },
    })
  ).id;
}

beforeEach(async () => {
  userId = "";
  kolA = "";
  kolB = "";
  kolBlokir = "";
  campaignId = "";
  campaignArsip = "";
  briefIds = [];
  hitungTx.n = 0;

  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolA = await buatKol("Ayu");
  kolB = await buatKol("Bima");
  kolBlokir = await buatKol("Cici", true);
  campaignId = (
    await prisma.kolCampaign.create({ data: { name: `${tag} Lebaran`, brief: "Tunjukkan bahan adem" }, select: { id: true } })
  ).id;
  campaignArsip = (
    await prisma.kolCampaign.create({ data: { name: `${tag} Lama`, archivedAt: new Date() }, select: { id: true } })
  ).id;
});

afterEach(async () => {
  const kolIds = [kolA, kolB, kolBlokir].filter(Boolean);
  const semuaBrief = (
    await prisma.kolBrief.findMany({ where: { kolId: { in: seededIds(kolIds) } }, select: { id: true } })
  ).map((b) => b.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(semuaBrief) } } });
  await prisma.kolBriefItem.deleteMany({ where: { briefId: { in: seededIds(semuaBrief) } } });
  await prisma.kolBriefDeliverable.deleteMany({ where: { briefId: { in: seededIds(semuaBrief) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(semuaBrief) } } });
  await prisma.kolCampaign.deleteMany({ where: { id: { in: seededIds([campaignId, campaignArsip].filter(Boolean)) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

async function kolaborasiBaru(tambahan: Partial<Parameters<typeof buatBrief>[0]> = {}) {
  const r = await buatBrief({ kolId: kolA, fee: 1_000_000, olehUserId: userId, ...tambahan });
  if (!r.ok) throw new Error(`buatBrief gagal: ${r.alasan}`);
  briefIds.push(r.id);
  return r.id;
}

describe("buatBrief — penjaga KOL dan campaign", () => {
  it("menolak KOL yang diblokir", async () => {
    expect(await buatBrief({ kolId: kolBlokir, fee: 0, olehUserId: userId })).toMatchObject({ ok: false, alasan: "KOL_DIBLOKIR" });
  });

  it("menolak campaign yang diarsipkan", async () => {
    expect(await buatBrief({ kolId: kolA, fee: 0, campaignId: campaignArsip, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "CAMPAIGN_DIARSIPKAN",
    });
  });
});

describe("pindahTahapKolaborasi — aturan dan jejak", () => {
  it("maju bebas tanpa alasan; mundur dan keluar wajib beralasan", async () => {
    const id = await kolaborasiBaru();
    expect(await pindahTahapKolaborasi({ kolaborasiId: id, ke: "DEAL", olehUserId: userId })).toMatchObject({ ok: true });
    expect(await pindahTahapKolaborasi({ kolaborasiId: id, ke: "NEGO", olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "ALASAN_WAJIB",
    });
    expect(await pindahTahapKolaborasi({ kolaborasiId: id, ke: "BATAL", olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "ALASAN_WAJIB",
    });
    expect(await pindahTahapKolaborasi({ kolaborasiId: id, ke: "NEGO", alasan: "salah klik", olehUserId: userId })).toMatchObject({
      ok: true,
      dari: "DEAL",
      ke: "NEGO",
    });
  });

  it("KOL yang diblokir sesudah kolaborasinya berjalan: maju ditolak, keluar tetap boleh", async () => {
    const id = await kolaborasiBaru();
    await prisma.kol.update({ where: { id: kolA }, data: { blockedAt: new Date() } });
    expect(await pindahTahapKolaborasi({ kolaborasiId: id, ke: "DEAL", olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "KOL_DIBLOKIR",
    });
    expect(
      await pindahTahapKolaborasi({ kolaborasiId: id, ke: "BATAL", alasan: "KOL diblokir", olehUserId: userId }),
    ).toMatchObject({ ok: true });
    // Membuka lagi kolaborasi KOL yang diblokir juga ditolak.
    expect(
      await pindahTahapKolaborasi({ kolaborasiId: id, ke: "PROSPEK", alasan: "coba lagi", olehUserId: userId }),
    ).toMatchObject({ ok: false, alasan: "KOL_DIBLOKIR" });
  });

  it("jejaknya memuat tahap dan tanggal tahap sebelum/sesudah", async () => {
    const id = await kolaborasiBaru();
    const sebelum = (await prisma.kolBrief.findUniqueOrThrow({ where: { id } })).tahapAt;
    await pindahTahapKolaborasi({ kolaborasiId: id, ke: "GHOSTING", alasan: "dua minggu diam", olehUserId: userId });
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "KOL_COLLAB_STAGE_CHANGED" } });
    expect(j.reason).toBe("dua minggu diam");
    expect(j.changes).toMatchObject({
      before: { tahap: "PROSPEK", tahapAt: sebelum.toISOString() },
      after: { tahap: "GHOSTING" },
    });
  });
});

describe("ubahKolaborasi", () => {
  it("mengubah isi, menyesuaikan status bayar, dan menulis jejak hanya untuk kolom yang berubah", async () => {
    const id = await kolaborasiBaru({ fee: 0 });
    const r = await ubahKolaborasi({
      id,
      isi: {
        fee: 2_000_000,
        jenis: "BAYAR",
        campaignId,
        briefText: "  Pakai di luar ruangan  ",
        deliverables: [{ platform: "TIKTOK", format: "VIDEO", qty: 2 }],
      },
      olehUserId: userId,
    });
    expect(r.ok).toBe(true);
    const b = await prisma.kolBrief.findUniqueOrThrow({ where: { id }, include: { deliverables: true } });
    expect(Number(b.fee)).toBe(2_000_000);
    expect(b.payStatus).toBe("BELUM");
    expect(b.campaignId).toBe(campaignId);
    expect(b.briefText).toBe("Pakai di luar ruangan");
    expect(b.deliverables).toHaveLength(1);

    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "KOL_COLLAB_UPDATED" } });
    expect(j.changes).toMatchObject({
      before: { fee: 0, jenis: "BARTER", payStatus: "TIDAK_PERLU", jumlahDeliverable: 0 },
      after: { fee: 2_000_000, jenis: "BAYAR", payStatus: "BELUM", jumlahDeliverable: 1 },
    });
    // Kolom yang tidak berubah tidak ikut dicatat.
    expect((j.changes as { before: Record<string, unknown> }).before).not.toHaveProperty("doList");
  });

  it("mengubah fee sesudah tayang wajib beralasan", async () => {
    const id = await kolaborasiBaru();
    await pindahTahapKolaborasi({ kolaborasiId: id, ke: "TAYANG", olehUserId: userId });
    expect(await ubahKolaborasi({ id, isi: { fee: 1_500_000 }, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "ALASAN_WAJIB",
    });
    expect(await ubahKolaborasi({ id, isi: { jenis: "CAMPURAN" }, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "ALASAN_WAJIB",
    });
    // Kolom lain tetap bebas.
    expect(await ubahKolaborasi({ id, isi: { briefText: "baru" }, olehUserId: userId })).toMatchObject({ ok: true });
    expect(
      await ubahKolaborasi({ id, isi: { fee: 1_500_000 }, alasan: "nego ulang sesudah tayang", olehUserId: userId }),
    ).toMatchObject({ ok: true });
    const j = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: "KOL_COLLAB_UPDATED", reason: "nego ulang sesudah tayang" },
    });
    expect(j.changes).toMatchObject({ before: { fee: 1_000_000 }, after: { fee: 1_500_000 } });
  });

  it("menolak memindah ke campaign yang diarsipkan", async () => {
    const id = await kolaborasiBaru();
    expect(await ubahKolaborasi({ id, isi: { campaignId: campaignArsip }, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "CAMPAIGN_DIARSIPKAN",
    });
  });

  it("status bayar SEBAGIAN dan LUNAS tidak disentuh perubahan fee", () => {
    expect(statusBayarSesudahUbahFee("TIDAK_PERLU", 10)).toBe("BELUM");
    expect(statusBayarSesudahUbahFee("BELUM", 0)).toBe("TIDAK_PERLU");
    expect(statusBayarSesudahUbahFee("SEBAGIAN", 0)).toBe("SEBAGIAN");
    expect(statusBayarSesudahUbahFee("LUNAS", 5)).toBe("LUNAS");
  });
});

describe("pindahTahapBanyak", () => {
  it("memindah yang bisa, melaporkan yang tidak bisa beserta alasannya", async () => {
    const a = await kolaborasiBaru();
    const b = await kolaborasiBaru();
    await pindahTahapKolaborasi({ kolaborasiId: b, ke: "BATAL", alasan: "mundur", olehUserId: userId });
    const r = await pindahTahapBanyak({ ids: [a, b], ke: "DEAL", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, dipindah: [a], gagal: [{ id: b, alasan: "STATUS_TIDAK_VALID" }] });
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: a } })).tahap).toBe("DEAL");
  });

  it("mundur massal tanpa alasan ditolak per baris", async () => {
    const a = await kolaborasiBaru({ tahap: "DEAL" });
    const r = await pindahTahapBanyak({ ids: [a], ke: "PROSPEK", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, dipindah: [], gagal: [{ id: a, alasan: "ALASAN_WAJIB" }] });
  });
});

describe("masukkanKeCampaign", () => {
  it("melewati KOL yang sudah ada di campaign dan yang diblokir, dalam SATU transaksi", async () => {
    // Bima sudah ada di campaign (walau sudah keluar jalur) — tidak digandakan.
    const lama = await buatBrief({ kolId: kolB, fee: 0, campaignId, olehUserId: userId });
    if (!lama.ok) throw new Error("seed gagal");
    await pindahTahapKolaborasi({ kolaborasiId: lama.id, ke: "DITOLAK", alasan: "tidak cocok", olehUserId: userId });
    hitungTx.n = 0;

    const r = await masukkanKeCampaign({
      kolIds: [kolA, kolB, kolBlokir, kolA],
      campaignId,
      tahapAwal: "DIHUBUNGI",
      olehUserId: userId,
    });
    expect(r).toMatchObject({ ok: true, dibuat: 1, sudahAda: 1, diblokir: 1 });
    expect(hitungTx.n).toBe(1);
    if (!r.ok) return;

    const baru = await prisma.kolBrief.findUniqueOrThrow({ where: { id: r.idDibuat[0] } });
    expect(baru.kolId).toBe(kolA);
    expect(baru.tahap).toBe("DIHUBUNGI");
    expect(baru.outreachAt).not.toBeNull();
    expect(baru.briefText).toBe("Tunjukkan bahan adem");
    expect(baru.payStatus).toBe("TIDAK_PERLU");
    expect(baru.docNo).toMatch(/^BRIEF\/\d{4}\/\d{4}$/);
    expect(await prisma.auditLog.count({ where: { entityId: baru.id, action: "KOL_BRIEF_CREATED" } })).toBe(1);

    // Mengulang tidak membuat apa pun: semuanya sudah ada atau diblokir.
    const ulang = await masukkanKeCampaign({ kolIds: [kolA, kolB, kolBlokir], campaignId, olehUserId: userId });
    expect(ulang).toMatchObject({ ok: true, dibuat: 0, sudahAda: 2, diblokir: 1 });
  });

  it("memberi nomor berurutan untuk beberapa KOL sekaligus", async () => {
    const r = await masukkanKeCampaign({ kolIds: [kolA, kolB], campaignId, olehUserId: userId });
    expect(r).toMatchObject({ ok: true, dibuat: 2 });
    if (!r.ok) return;
    const nomor = (await prisma.kolBrief.findMany({ where: { id: { in: r.idDibuat } }, select: { docNo: true } }))
      .map((b) => Number(b.docNo.slice(-4)))
      .sort((x, y) => x - y);
    expect(nomor[1] - nomor[0]).toBe(1);
  });

  it("menolak campaign yang diarsipkan dan tahap awal di jalur keluar", async () => {
    expect(await masukkanKeCampaign({ kolIds: [kolA], campaignId: campaignArsip, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "CAMPAIGN_DIARSIPKAN",
    });
    expect(
      await masukkanKeCampaign({ kolIds: [kolA], campaignId, tahapAwal: "GHOSTING", olehUserId: userId }),
    ).toMatchObject({ ok: false, alasan: "STATUS_TIDAK_VALID" });
    expect(await prisma.kolBrief.count({ where: { kolId: kolA } })).toBe(0);
  });
});

describe("pindahkanKeCampaign", () => {
  it("mengganti campaign di tempat, mewarisi brief kosong, dan melewati yang sudah ada atau kembar", async () => {
    const tanpa = await kolaborasiBaru();
    const sudah = await kolaborasiBaru({ campaignId });
    const lainB = await buatBrief({ kolId: kolB, fee: 0, olehUserId: userId });
    if (!lainB.ok) throw new Error("seed gagal");
    // KOL A sudah ada di campaign lewat `sudah`, jadi `tanpa` (juga KOL A) kembar.
    hitungTx.n = 0;
    const r = await pindahkanKeCampaign({ ids: [tanpa, sudah, lainB.id], campaignId, olehUserId: userId });
    expect(r).toMatchObject({ ok: true, dipindah: 1, sudahAda: 1, kembar: 1 });
    expect(hitungTx.n).toBe(1);
    const b = await prisma.kolBrief.findUniqueOrThrow({ where: { id: lainB.id } });
    expect(b.campaignId).toBe(campaignId);
    expect(b.briefText).toBe("Tunjukkan bahan adem");
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: tanpa } })).campaignId).toBeNull();
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityId: lainB.id, action: "KOL_COLLAB_UPDATED" } });
    expect(j.changes).toMatchObject({ before: { campaignId: null }, after: { campaignId } });
  });

  it("menolak campaign yang diarsipkan", async () => {
    const a = await kolaborasiBaru();
    expect(await pindahkanKeCampaign({ ids: [a], campaignId: campaignArsip, olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "CAMPAIGN_DIARSIPKAN",
    });
  });
});
