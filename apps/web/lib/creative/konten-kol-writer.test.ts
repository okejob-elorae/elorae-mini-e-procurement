import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { catatAngka, kirimDraf, mintaRevisi, setujuiDraf, simpanKontenKol } from "./konten-kol-writer";

/**
 * Penulis konten KOL, terhadap basis data sungguhan: yang bisa salah di sini
 * bukan aritmetikanya, melainkan APA YANG TERSENTUH — kolom yang tidak dikirim
 * ikut terhapus, angka lama tertimpa, atau tahap tidak maju dari faktanya.
 */

const tag = `KKW-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let userId = "";
let kolId = "";
let briefId = "";
let briefLainId = "";

async function buatKolaborasi(docNo: string, tahap: "SAMPEL_DITERIMA" | "DEAL" | "TAYANG", fee = 0) {
  return (
    await prisma.kolBrief.create({
      data: { docNo, kolId, tahap, fee, payStatus: fee > 0 ? "BELUM" : "TIDAK_PERLU" },
      select: { id: true },
    })
  ).id;
}

beforeEach(async () => {
  userId = "";
  kolId = "";
  briefId = "";
  briefLainId = "";
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (
    await prisma.kol.create({
      data: { name: `${tag} KOL`, accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}`, followers: 12_000 }] } },
      select: { id: true },
    })
  ).id;
  briefId = await buatKolaborasi(`${tag}/1`, "SAMPEL_DITERIMA");
});

afterEach(async () => {
  const brief = () => [seededId(briefId), seededId(briefLainId)];
  await prisma.auditLog.deleteMany({ where: { entityId: { in: brief() } } });
  await prisma.kolNote.deleteMany({ where: { collabId: { in: brief() } } });
  await prisma.kolContentMetric.deleteMany({ where: { content: { collabId: { in: brief() } } } });
  await prisma.kolContent.deleteMany({ where: { collabId: { in: brief() } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: brief() } } });
  await prisma.kolAccount.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

const tahap = async (id = briefId) => (await prisma.kolBrief.findUniqueOrThrow({ where: { id } })).tahap;
const konten = (id: string) => prisma.kolContent.findUniqueOrThrow({ where: { id } });

describe("simpanKontenKol", () => {
  it("link konten mencatat tanggal tayang hari ini dan memajukan tahap ke TAYANG", async () => {
    const r = await simpanKontenKol({
      kolaborasiId: briefId,
      platform: "TIKTOK",
      format: "VIDEO",
      link: "tiktok.com/@x/video/1",
      olehUserId: userId,
    });
    if (!r.ok) throw new Error(r.kode);
    expect(r.maju).toEqual({ dari: "SAMPEL_DITERIMA", ke: "TAYANG" });
    const k = await konten(r.id);
    expect(k.link).toBe("https://tiktok.com/@x/video/1");
    expect(k.liveAt).not.toBeNull();
    expect(await tahap()).toBe("TAYANG");
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: briefId, action: "KOL_CONTENT_RECORDED" } });
    expect(jejak.metadata).toMatchObject({ kontenId: r.id });
  });

  it("tanpa platform/format menebak dari link yang ditempel", async () => {
    const r = await simpanKontenKol({ kolaborasiId: briefId, link: "https://www.instagram.com/reel/abc", olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    const k = await konten(r.id);
    expect([k.platform, k.format]).toEqual(["INSTAGRAM", "REELS"]);
  });

  it("kolom yang tidak dikirim tidak tersentuh saat mengubah", async () => {
    const dibuat = await simpanKontenKol({
      kolaborasiId: briefId,
      platform: "TIKTOK",
      format: "VIDEO",
      link: "https://tiktok.com/@x/video/2",
      liveAt: new Date("2026-10-01T05:00:00.000Z"),
      draftLink: "https://drive.google.com/draf",
      adCode: "#AD123",
      adCodeUntil: new Date("2026-11-01T17:00:00.000Z"),
      olehUserId: userId,
    });
    if (!dibuat.ok) throw new Error(dibuat.kode);

    const ubah = await simpanKontenKol({
      id: dibuat.id,
      kolaborasiId: briefId,
      plannedAt: new Date("2026-10-05T17:00:00.000Z"),
      olehUserId: userId,
    });
    expect(ubah.ok).toBe(true);
    const k = await konten(dibuat.id);
    expect(k.plannedAt?.toISOString()).toBe("2026-10-05T17:00:00.000Z");
    expect(k.link).toBe("https://tiktok.com/@x/video/2");
    expect(k.liveAt?.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(k.draftLink).toBe("https://drive.google.com/draf");
    expect(k.adCode).toBe("#AD123");
    expect(k.adCodeUntil?.toISOString()).toBe("2026-11-01T17:00:00.000Z");
    expect([k.platform, k.format]).toEqual(["TIKTOK", "VIDEO"]);
  });

  it("null yang dikirim dengan sengaja mengosongkan kolomnya", async () => {
    const r = await simpanKontenKol({ kolaborasiId: briefId, platform: "TIKTOK", format: "VIDEO", adCode: "#X", olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    await simpanKontenKol({ id: r.id, kolaborasiId: briefId, adCode: null, olehUserId: userId });
    expect((await konten(r.id)).adCode).toBeNull();
  });

  it("menolak link yang bukan link dan konten milik kolaborasi lain", async () => {
    expect(await simpanKontenKol({ kolaborasiId: briefId, link: "sudah tayang kak", olehUserId: userId })).toEqual({
      ok: false,
      kode: "LINK_TIDAK_SAH",
    });
    briefLainId = await buatKolaborasi(`${tag}/2`, "DEAL");
    const r = await simpanKontenKol({ kolaborasiId: briefLainId, platform: "TIKTOK", format: "VIDEO", olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    expect(await simpanKontenKol({ id: r.id, kolaborasiId: briefId, adCode: "#Y", olehUserId: userId })).toEqual({
      ok: false,
      kode: "TIDAK_DITEMUKAN",
    });
    expect(await prisma.kolContent.count({ where: { collabId: briefId } })).toBe(0);
  });
});

describe("draf", () => {
  it("link draf membuat konten MENUNGGU dan memajukan ke DRAF", async () => {
    const r = await kirimDraf({ kolaborasiId: briefId, draftLink: "https://drive.google.com/d1", olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    expect(r.maju).toEqual({ dari: "SAMPEL_DITERIMA", ke: "DRAF" });
    const k = await konten(r.id);
    expect(k.draftStatus).toBe("MENUNGGU");
    expect(k.draftAt).not.toBeNull();
    // Tidak ada platform di link → dari akun KOL.
    expect(k.platform).toBe("TIKTOK");
  });

  it("setujui → DRAF_DISETUJUI dengan penyetuju; draf baru sesudahnya kembali MENUNGGU tanpa persetujuan", async () => {
    const d = await kirimDraf({ kolaborasiId: briefId, draftLink: "https://drive.google.com/d2", olehUserId: userId });
    if (!d.ok) throw new Error(d.kode);
    const s = await setujuiDraf({ kontenId: d.id, olehUserId: userId });
    expect(s).toMatchObject({ ok: true, maju: { dari: "DRAF", ke: "DRAF_DISETUJUI" } });
    let k = await konten(d.id);
    expect(k.draftStatus).toBe("DISETUJUI");
    expect(k.approvedById).toBe(userId);
    expect(k.approvedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: briefId, action: "KOL_DRAFT_APPROVED" } })).toBe(1);

    const ulang = await kirimDraf({ kontenId: d.id, kolaborasiId: briefId, draftLink: "https://drive.google.com/d2-v2", olehUserId: userId });
    expect(ulang.ok).toBe(true);
    k = await konten(d.id);
    expect(k.draftStatus).toBe("MENUNGGU");
    expect(k.approvedById).toBeNull();
    expect(k.draftLink).toBe("https://drive.google.com/d2-v2");
  });

  it("menyetujui konten tanpa draf ditolak", async () => {
    const r = await simpanKontenKol({ kolaborasiId: briefId, platform: "TIKTOK", format: "VIDEO", olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    expect(await setujuiDraf({ kontenId: r.id, olehUserId: userId })).toEqual({ ok: false, kode: "TANPA_DRAF" });
  });

  it("minta revisi wajib bercatatan; catatannya tersimpan di draf, catatan kolaborasi, dan jejak", async () => {
    const d = await kirimDraf({ kolaborasiId: briefId, draftLink: "https://drive.google.com/d3", olehUserId: userId });
    if (!d.ok) throw new Error(d.kode);

    expect(await mintaRevisi({ kontenId: d.id, catatan: "   ", olehUserId: userId })).toEqual({ ok: false, kode: "CATATAN_WAJIB" });
    expect((await konten(d.id)).draftStatus).toBe("MENUNGGU");
    expect(await prisma.kolNote.count({ where: { collabId: briefId } })).toBe(0);

    const r = await mintaRevisi({ kontenId: d.id, catatan: "Logo kurang jelas", olehUserId: userId });
    expect(r.ok).toBe(true);
    const k = await konten(d.id);
    expect(k.draftStatus).toBe("REVISI");
    expect(k.draftNote).toBe("Logo kurang jelas");
    const catatan = await prisma.kolNote.findFirstOrThrow({ where: { collabId: briefId } });
    expect(catatan.body).toBe("Minta revisi draf: Logo kurang jelas");
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: briefId, action: "KOL_DRAFT_REVISION_REQUESTED" } });
    expect(jejak.reason).toBe("Logo kurang jelas");
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: briefId } })).lastContactAt).not.toBeNull();
  });
});

describe("catatAngka", () => {
  async function kontenTayang(liveAt: Date) {
    await prisma.kolBrief.update({ where: { id: briefId }, data: { tahap: "TAYANG", fee: 500_000, payStatus: "BELUM" } });
    const r = await simpanKontenKol({
      kolaborasiId: briefId,
      platform: "TIKTOK",
      format: "VIDEO",
      link: "https://tiktok.com/@x/video/9",
      liveAt,
      olehUserId: userId,
    });
    if (!r.ok) throw new Error(r.kode);
    return r.id;
  }

  it("setiap pengisian menjadi baris baru — angka lama tidak pernah ditimpa", async () => {
    const id = await kontenTayang(new Date("2026-10-01T05:00:00.000Z"));
    const satu = await catatAngka({ kontenId: id, views: 1000, likes: 50, comments: 3, shares: 1, saves: 2, recordedAt: new Date("2026-10-02T05:00:00.000Z"), olehUserId: userId });
    const dua = await catatAngka({ kontenId: id, views: 5000, likes: 200, comments: 9, shares: 4, saves: 7, recordedAt: new Date("2026-10-04T05:00:00.000Z"), olehUserId: userId });
    expect(satu.ok && dua.ok).toBe(true);
    const baris = await prisma.kolContentMetric.findMany({ where: { contentId: id }, orderBy: { recordedAt: "asc" } });
    expect(baris.map((b) => b.views)).toEqual([1000, 5000]);
    expect(baris[0].likes).toBe(50);
    expect(await prisma.auditLog.count({ where: { entityId: briefId, action: "KOL_CONTENT_METRICS_RECORDED" } })).toBe(2);
  });

  it("angka pada H+7 memajukan TAYANG ke ANGKA_MASUK", async () => {
    // Relatif terhadap sekarang: angka di masa depan ditolak penulisnya.
    const hari = (n: number) => new Date(Date.now() + n * 86_400_000);
    const id = await kontenTayang(hari(-10));
    const awal = await catatAngka({ kontenId: id, views: 10, recordedAt: hari(-7), olehUserId: userId });
    expect(awal).toMatchObject({ ok: true, maju: null });
    const r = await catatAngka({ kontenId: id, views: 100, recordedAt: hari(-1), olehUserId: userId });
    expect(r).toMatchObject({ ok: true, maju: { dari: "TAYANG", ke: "ANGKA_MASUK" } });
    expect(await tahap()).toBe("ANGKA_MASUK");
  });

  it("menolak angka kosong, konten yang belum tayang, dan tanggal sebelum tayang", async () => {
    const belum = await simpanKontenKol({ kolaborasiId: briefId, platform: "TIKTOK", format: "VIDEO", olehUserId: userId });
    if (!belum.ok) throw new Error(belum.kode);
    expect(await catatAngka({ kontenId: belum.id, views: 10, olehUserId: userId })).toEqual({ ok: false, kode: "BELUM_TAYANG" });

    const id = await kontenTayang(new Date("2026-10-05T05:00:00.000Z"));
    expect(await catatAngka({ kontenId: id, views: 0, olehUserId: userId })).toEqual({ ok: false, kode: "ANGKA_KOSONG" });
    expect(await catatAngka({ kontenId: id, views: -5, olehUserId: userId })).toEqual({ ok: false, kode: "ANGKA_TIDAK_SAH" });
    expect(
      await catatAngka({ kontenId: id, views: 5, recordedAt: new Date("2026-10-03T05:00:00.000Z"), olehUserId: userId }),
    ).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(await prisma.kolContentMetric.count({ where: { contentId: id } })).toBe(0);
  });
});
