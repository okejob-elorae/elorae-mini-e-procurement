import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prisma, seededIds } from "@elorae/db";
import type { PengaturanBrand } from "./brand-collab";
import { hapusBrandKol, tambahBrandManual } from "./brand-writer";
import type { HasilKonten, HasilProfil, PostingProfil } from "./pantau-muatan";
import { simpanHasil, simpanManual, simpanOtomatis, type PerangkatSah } from "./pantau-writer";
import { PANTAU_BAWAAN } from "./pantau-aturan";
import { bacaParamPerforma } from "./performa";
import { daftarPerformaVideo } from "./performa-queries";

/*
 * Riwayat brand (D1), video yang menandai Elorae masuk Performa (D2), dan
 * kiriman otomatis panel (D3) terhadap basis data sungguhan. Waktu di tahun
 * 2000–2004 (satu hari acak per tes), pengaturan brand diberikan tes (akun
 * Elorae palsu milik tes ini, bukan `elorae.official`), handle dan id video
 * acak, teardown lewat `seededId()`. Tidak ada tugas pantau yang bisa
 * dipinjam ekstensi sungguhan: D2 tidak membuat tugas, dan satu-satunya tugas
 * di sini jatuh tempo di tahun 2000-an.
 */

const tag = `UJIBRAND${Math.random().toString(36).slice(2, 7)}`;
const handle = tag.toLowerCase();
const AKUN_ELORAE = `${handle}.elorae`;
const KOMPETITOR = `${handle}.lain`;
const PB: PengaturanBrand = { akunElorae: [AKUN_ELORAE], tagarElorae: [`${handle}tagar`], kompetitor: [{ handle: KOMPETITOR, nama: "Kompetitor uji" }], otomatisKePerforma: true };

let adminId = "";
let kolIds: string[] = [];
let perangkatIds: string[] = [];
let tugasIds: string[] = [];
let penggunaIds: string[] = [];
let kolId = "";
let akunId = "";

function hariAcak(): Date {
  const r = (n: number) => Math.floor(Math.random() * n);
  return new Date(Date.UTC(2000 + r(5), r(12), 1 + r(28), 3, 0, 0));
}
let SEKARANG = hariAcak();
const tambahJam = (d: Date, n: number) => new Date(d.getTime() + n * 3_600_000);
const detik = (d: Date) => Math.floor(d.getTime() / 1000);
/** Id video acak 19 angka — tidak mungkin cocok dengan konten sungguhan di basis data bersama. */
const vid = () => `79${Array.from({ length: 17 }, () => Math.floor(Math.random() * 10)).join("")}`;

async function perangkat(olehUserId = adminId): Promise<PerangkatSah> {
  const p = await prisma.kolPerangkat.create({
    data: { nama: `${tag} Laptop`, dibuatOlehId: olehUserId, tokenHash: createHash("sha256").update(`${tag}${Math.random()}`).digest("hex"), tersambungAt: SEKARANG },
    select: { id: true, nama: true, dibuatOlehId: true, dijedaSampai: true, alasanJeda: true, dicabutAt: true, terakhirLaporAt: true },
  });
  perangkatIds.push(p.id);
  return p;
}

async function kolBaru(h: string, briefJenis?: "KOMISI" | "BAYAR") {
  const kol = await prisma.kol.create({
    data: { name: `${tag} ${h}`, accounts: { create: [{ platform: "TIKTOK", handle: `@${h}`, followers: 1000 }] } },
    select: { id: true, accounts: { select: { id: true } } },
  });
  kolIds.push(kol.id);
  if (briefJenis) {
    await prisma.kolBrief.create({ data: { docNo: `${tag}/${Math.random().toString(36).slice(2, 8)}`, kolId: kol.id, tahap: "DEAL", jenis: briefJenis, fee: 0, payStatus: "TIDAK_PERLU" } });
  }
  return { kolId: kol.id, akunId: kol.accounts[0].id };
}

function posting(isi: Partial<PostingProfil> = {}): PostingProfil {
  return { id: vid(), dibuatPada: detik(tambahJam(SEKARANG, -48)), disematkan: false, views: 1000, like: 80, komentar: 10, share: 5, save: 5, ...isi };
}

function profil(h: string, daftar: PostingProfil[], pengikut = 20_000): HasilProfil {
  return { jenis: "PROFIL", uniqueId: h, pengikut, posting: daftar };
}

function video(h: string, isi: Partial<HasilKonten> = {}): HasilKonten {
  return { jenis: "KONTEN", videoId: vid(), uniqueId: h, views: 700, like: 70, komentar: 7, share: 3, save: 2, dibuatPada: detik(tambahJam(SEKARANG, -30)), ...isi };
}

const urlProfil = (h: string) => `https://www.tiktok.com/@${h}`;
const urlVideo = (h: string, id: string) => `https://www.tiktok.com/@${h}/video/${id}`;

async function kontenVideo(id: string) {
  const ks = await prisma.kolContent.findMany({
    where: { link: { contains: id } },
    select: { id: true, link: true, liveAt: true, collab: { select: { id: true, kolId: true, jenis: true, fee: true } }, metrics: { select: { views: true, source: true, perangkatId: true }, orderBy: { recordedAt: "asc" } } },
  });
  return ks;
}

beforeEach(async () => {
  adminId = "";
  kolIds = [];
  perangkatIds = [];
  tugasIds = [];
  penggunaIds = [];
  kolId = "";
  akunId = "";
  SEKARANG = hariAcak();
  adminId = (await prisma.user.findFirstOrThrow({ where: { roleDefinition: { isSystem: true } }, select: { id: true } })).id;
  ({ kolId, akunId } = await kolBaru(handle));
});

afterEach(async () => {
  const ids = seededIds(kolIds);
  const briefIds = (await prisma.kolBrief.findMany({ where: { kolId: { in: ids } }, select: { id: true } })).map((b) => b.id);
  const kontenIds = (await prisma.kolContent.findMany({ where: { collabId: { in: seededIds(briefIds) } }, select: { id: true } })).map((k) => k.id);
  const akunIds = (await prisma.kolAccount.findMany({ where: { kolId: { in: ids } }, select: { id: true } })).map((a) => a.id);
  await prisma.kolLogPantau.deleteMany({ where: { perangkatId: { in: seededIds(perangkatIds) } } });
  await prisma.kolTugasPantau.deleteMany({
    where: { OR: [{ id: { in: seededIds(tugasIds) } }, { contentId: { in: seededIds(kontenIds) } }, { accountId: { in: seededIds(akunIds) } }] },
  });
  await prisma.kolContentMetric.deleteMany({ where: { contentId: { in: seededIds(kontenIds) } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...seededIds(briefIds), ...seededIds(kontenIds), ...seededIds(perangkatIds)] } } });
  await prisma.kolBrandCollab.deleteMany({ where: { kolId: { in: seededIds(kolIds) } } });
  await prisma.kolContent.deleteMany({ where: { id: { in: seededIds(kontenIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(briefIds) } } });
  await prisma.kolFollowerSnapshot.deleteMany({ where: { accountId: { in: seededIds(akunIds) } } });
  await prisma.kolAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
  await prisma.kolPerangkat.deleteMany({ where: { id: { in: seededIds(perangkatIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
  await prisma.user.deleteMany({ where: { id: { in: seededIds(penggunaIds) } } });
});

describe("D1 + D2 dari pembacaan profil (Simpan ke Elorae)", () => {
  it("brand dicatat per posting × brand; video yang menandai Elorae masuk Performa dengan angkanya, tanpa tugas", async () => {
    const a = await perangkat();
    const tandai = posting({ sebutan: [AKUN_ELORAE, KOMPETITOR], tagar: ["gifted"], teks: "makasih @Eloraé", views: 4321 });
    const lain = posting({ sebutan: [KOMPETITOR], iklan: true });
    const polos = posting({ teks: "tanpa sebutan" });
    const orangLain = posting({ sebutan: [AKUN_ELORAE], penulis: `${handle}.tamu` });
    const r = await simpanManual({ perangkat: a, url: urlProfil(handle), data: profil(handle, [tandai, lain, polos, orangLain]), sekarang: SEKARANG, pengaturanBrand: PB });
    expect(r).toMatchObject({ ok: true, cocok: { kolId } });

    const brand = await prisma.kolBrandCollab.findMany({ where: { kolId }, orderBy: [{ kunci: "asc" }] });
    expect(brand.map((b) => [b.kunci, b.jenis, b.sumber, b.accountId]).sort()).toEqual(
      [
        [`TIKTOK:${tandai.id}:${AKUN_ELORAE}`, "KOLABORASI", "EKSTENSI", akunId],
        [`TIKTOK:${tandai.id}:${KOMPETITOR}`, "KOLABORASI", "EKSTENSI", akunId],
        [`TIKTOK:${lain.id}:${KOMPETITOR}`, "BERBAYAR", "EKSTENSI", akunId],
      ].sort(),
    );
    expect(brand.find((b) => b.postId === tandai.id)?.views).toBe(4321);

    const [k] = await kontenVideo(tandai.id);
    expect(k.link).toBe(urlVideo(handle, tandai.id));
    expect(k.collab.kolId).toBe(kolId);
    expect(k.collab.jenis).not.toBe("KOMISI");
    expect(Number(k.collab.fee)).toBe(0);
    expect(k.liveAt?.getTime()).toBe(tandai.dibuatPada * 1000);
    expect(k.metrics).toEqual([{ views: 4321, source: "ekstensi", perangkatId: a.id }]);
    expect(await prisma.kolTugasPantau.count({ where: { contentId: k.id } })).toBe(0);
    // Posting orang lain dan posting yang tidak menandai Elorae tidak dibuat.
    expect(await kontenVideo(orangLain.id)).toEqual([]);
    expect(await kontenVideo(lain.id)).toEqual([]);
    // Jejak pembuatannya bersumber DETEKSI_TAG.
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "KolBrief", entityId: k.collab.id, action: "KOL_CONTENT_RECORDED" }, select: { metadata: true } });
    expect(JSON.stringify(jejak)).toContain("DETEKSI_TAG");

    // Dibuka lagi 5 menit kemudian: tidak ada konten kedua, tidak ada angka baru (jeda 12 jam), brand tidak berubah.
    const lagi = { ...profil(handle, [tandai, lain, polos, orangLain]) };
    await simpanManual({ perangkat: a, url: urlProfil(handle), data: lagi, sekarang: new Date(SEKARANG.getTime() + 5 * 60_000), pengaturanBrand: PB });
    const [k2] = await kontenVideo(tandai.id);
    expect(k2.metrics).toHaveLength(1);
    expect(await prisma.kolBrandCollab.count({ where: { kolId } })).toBe(3);

    // 13 jam kemudian: angkanya dicatat lagi dari profil.
    await simpanManual({
      perangkat: a,
      url: urlProfil(handle),
      data: profil(handle, [{ ...tandai, views: 9000 }]),
      sekarang: tambahJam(SEKARANG, 13),
      pengaturanBrand: PB,
    });
    const [k3] = await kontenVideo(tandai.id);
    expect(k3.metrics.map((m) => m.views)).toEqual([4321, 9000]);
    expect((await prisma.kolBrandCollab.findUniqueOrThrow({ where: { kunci: `TIKTOK:${tandai.id}:${AKUN_ELORAE}` } })).views).toBe(9000);
  });

  it("Performa video melencanai video yang masuk sendiri (Terdeteksi otomatis), tidak video tempelan biasa", async () => {
    const a = await perangkat();
    const tandai = posting({ sebutan: [AKUN_ELORAE] });
    await simpanManual({ perangkat: a, url: urlProfil(handle), data: profil(handle, [tandai]), sekarang: SEKARANG, pengaturanBrand: PB });
    const biasa = video(handle);
    await simpanManual({ perangkat: a, url: urlVideo(handle, biasa.videoId), data: biasa, sekarang: SEKARANG, pengaturanBrand: PB });
    const [k1] = await kontenVideo(tandai.id);
    const [k2] = await kontenVideo(biasa.videoId);
    const r = await daftarPerformaVideo(bacaParamPerforma({}), { cakupan: [k1.id, k2.id] });
    expect(Object.fromEntries(r.baris.map((b) => [b.kontenId, b.terdeteksi]))).toEqual({ [k1.id]: true, [k2.id]: false });
  });

  it("tagar Elorae juga dihitung; KOL yang kolaborasi berjalannya hanya KOMISI → masuk sebagai afiliasi", async () => {
    const af = `${handle}af`;
    const kol = await kolBaru(af, "KOMISI");
    const a = await perangkat();
    const p = posting({ tagar: [`${handle}tagar`] });
    await simpanManual({ perangkat: a, url: urlProfil(af), data: profil(af, [p]), sekarang: SEKARANG, pengaturanBrand: PB });
    const [k] = await kontenVideo(p.id);
    expect(k.collab.kolId).toBe(kol.kolId);
    expect(k.collab.jenis).toBe("KOMISI");
    // Tanpa brand yang DITANDAI tidak ada baris riwayat brand (tagar bukan sebutan).
    expect(await prisma.kolBrandCollab.count({ where: { kolId: kol.kolId } })).toBe(0);
  });

  it("otomatisKePerforma mati → riwayat brand tetap, video tidak dibuat", async () => {
    const a = await perangkat();
    const p = posting({ sebutan: [AKUN_ELORAE] });
    await simpanManual({ perangkat: a, url: urlProfil(handle), data: profil(handle, [p]), sekarang: SEKARANG, pengaturanBrand: { ...PB, otomatisKePerforma: false } });
    expect(await kontenVideo(p.id)).toEqual([]);
    expect(await prisma.kolBrandCollab.count({ where: { kolId } })).toBe(1);
  });

  it("pemasang tanpa creative:manage → profil dan brand tersimpan, video tidak dibuat", async () => {
    const u = await prisma.user.create({ data: { email: `${handle}@uji.invalid`, name: tag }, select: { id: true } });
    penggunaIds.push(u.id);
    const a = await perangkat(u.id);
    const p = posting({ sebutan: [AKUN_ELORAE] });
    const r = await simpanManual({ perangkat: a, url: urlProfil(handle), data: profil(handle, [p], 31_000), sekarang: SEKARANG, pengaturanBrand: PB });
    expect(r.ok).toBe(true);
    expect((await prisma.kolAccount.findUniqueOrThrow({ where: { id: akunId } })).followers).toBe(31_000);
    expect(await kontenVideo(p.id)).toEqual([]);
    expect(await prisma.kolBrandCollab.count({ where: { kolId } })).toBe(1);
  });

  it("akun lain milik KOL yang sama tidak pernah dicatat sebagai brand", async () => {
    await prisma.kolAccount.create({ data: { kolId, platform: "INSTAGRAM", handle: `${handle}.ig`, followers: 1 } });
    const a = await perangkat();
    await simpanManual({ perangkat: a, url: urlProfil(handle), data: profil(handle, [posting({ sebutan: [`${handle}.ig`, KOMPETITOR] })]), sekarang: SEKARANG, pengaturanBrand: PB });
    const brand = await prisma.kolBrandCollab.findMany({ where: { kolId }, select: { brandHandle: true } });
    expect(brand.map((b) => b.brandHandle)).toEqual([KOMPETITOR]);
  });

  it("tugas profil otomatis (simpanHasil) juga menjalankan D1 + D2", async () => {
    const a = await perangkat();
    const t = await prisma.kolTugasPantau.create({
      data: { jenis: "PROFIL", platform: "TIKTOK", accountId: akunId, url: urlProfil(handle), prioritas: 50, jatuhAt: tambahJam(SEKARANG, -24), kunci: `${tag}:${Math.random()}` },
      select: { id: true },
    });
    tugasIds.push(t.id);
    const p = posting({ sebutan: [AKUN_ELORAE] });
    const r = await simpanHasil({ perangkat: a, tugasId: t.id, data: profil(handle, [p]), sekarang: SEKARANG, pengaturan: PANTAU_BAWAAN, pengaturanBrand: PB });
    expect(r).toEqual({ ok: true });
    const [k] = await kontenVideo(p.id);
    expect(k.metrics).toHaveLength(1);
    expect(await prisma.kolBrandCollab.count({ where: { kolId } })).toBe(1);
  });
});

describe("simpanOtomatis (POST /otomatis)", () => {
  it("profil yang belum ada dan tidak menandai Elorae → DIABAIKAN, tidak menulis apa pun", async () => {
    const a = await perangkat();
    const asing = `${handle}asing`;
    const r = await simpanOtomatis({ perangkat: a, url: urlProfil(asing), data: profil(asing, [posting({ sebutan: [KOMPETITOR] })]), sekarang: SEKARANG, pengaturanBrand: PB });
    expect(r).toEqual({ ok: true, hasil: "DIABAIKAN", videoMasuk: 0, brand: 0 });
    expect(await prisma.kolAccount.count({ where: { handle: { contains: asing } } })).toBe(0);
    expect(await prisma.kolLogPantau.count({ where: { perangkatId: a.id } })).toBe(0);
  });

  it("profil yang belum ada tetapi menandai Elorae → KOL \"@handle\" dibuat, D1 + D2, log OTOMATIS_PROFIL", async () => {
    const a = await perangkat();
    const baru = `${handle}baru`;
    const p = posting({ sebutan: [AKUN_ELORAE, KOMPETITOR] });
    const r = await simpanOtomatis({ perangkat: a, url: urlProfil(baru), data: profil(baru, [p, posting()], 45_000), sekarang: SEKARANG, pengaturanBrand: PB });
    if (!r.ok || !r.kol) throw new Error(JSON.stringify(r));
    kolIds.push(r.kol.id);
    expect(r).toEqual({ ok: true, hasil: "DISIMPAN", kol: { id: r.kol.id, nama: `@${baru}` }, videoMasuk: 1, brand: 2 });
    const akun = await prisma.kolAccount.findFirstOrThrow({ where: { kolId: r.kol.id }, select: { followers: true } });
    expect(akun.followers).toBe(45_000);
    const [k] = await kontenVideo(p.id);
    expect(k.metrics).toHaveLength(1);
    expect(await prisma.kolLogPantau.count({ where: { perangkatId: a.id, kode: "OTOMATIS_PROFIL", tugasId: null } })).toBe(1);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "Kol", entityId: r.kol.id }, select: { metadata: true } });
    expect(JSON.stringify(jejak)).toContain("DETEKSI_TAG");
  });

  it("profil akun Elorae sendiri tidak pernah dijadikan KOL", async () => {
    const a = await perangkat();
    const r = await simpanOtomatis({
      perangkat: a,
      url: urlProfil(AKUN_ELORAE),
      data: profil(AKUN_ELORAE, [posting({ tagar: [`${handle}tagar`] })]),
      sekarang: SEKARANG,
      pengaturanBrand: PB,
    });
    expect(r).toEqual({ ok: true, hasil: "DIABAIKAN", videoMasuk: 0, brand: 0 });
    expect(await prisma.kolAccount.count({ where: { handle: { contains: AKUN_ELORAE } } })).toBe(0);
  });

  it("profil yang sudah ada → DISIMPAN walau tidak ada video baru", async () => {
    const a = await perangkat();
    const r = await simpanOtomatis({ perangkat: a, url: urlProfil(handle), data: profil(handle, [posting()], 22_222), sekarang: SEKARANG, pengaturanBrand: PB });
    expect(r).toEqual({ ok: true, hasil: "DISIMPAN", kol: { id: kolId, nama: `${tag} ${handle}` }, videoMasuk: 0, brand: 0 });
    expect((await prisma.kolAccount.findUniqueOrThrow({ where: { id: akunId } })).followers).toBe(22_222);
  });

  it("pemasang tanpa creative:manage tidak bisa membuat KOL baru (TANPA_IZIN), tidak ada yang dibuat", async () => {
    const u = await prisma.user.create({ data: { email: `${handle}2@uji.invalid`, name: tag }, select: { id: true } });
    penggunaIds.push(u.id);
    const a = await perangkat(u.id);
    const baru = `${handle}tanpaizin`;
    const r = await simpanOtomatis({ perangkat: a, url: urlProfil(baru), data: profil(baru, [posting({ sebutan: [AKUN_ELORAE] })]), sekarang: SEKARANG, pengaturanBrand: PB });
    expect(r).toEqual({ ok: false, kode: "TANPA_IZIN" });
    expect(await prisma.kolAccount.count({ where: { handle: { contains: baru } } })).toBe(0);
  });

  it("video: belum ada & tidak menandai → DIABAIKAN; menandai → DISIMPAN dengan angka; dibuka lagi < 12 jam → DIABAIKAN; > 12 jam → angka baru", async () => {
    const a = await perangkat();
    const polos = video(handle);
    expect(await simpanOtomatis({ perangkat: a, url: urlVideo(handle, polos.videoId), data: polos, sekarang: SEKARANG, pengaturanBrand: PB })).toEqual({
      ok: true,
      hasil: "DIABAIKAN",
      videoMasuk: 0,
      brand: 0,
    });
    expect(await kontenVideo(polos.videoId)).toEqual([]);

    const v = video(handle, { sebutan: [AKUN_ELORAE], iklan: true, teks: "outfit dari @Eloraé" });
    const r = await simpanOtomatis({ perangkat: a, url: urlVideo(handle, v.videoId), data: v, sekarang: SEKARANG, pengaturanBrand: PB });
    expect(r).toEqual({ ok: true, hasil: "DISIMPAN", kol: { id: kolId, nama: `${tag} ${handle}` }, videoMasuk: 1, brand: 1 });
    const [k] = await kontenVideo(v.videoId);
    expect(k.metrics.map((m) => m.views)).toEqual([700]);
    const b = await prisma.kolBrandCollab.findUniqueOrThrow({ where: { kunci: `TIKTOK:${v.videoId}:${AKUN_ELORAE}` } });
    expect(b).toMatchObject({ jenis: "BERBAYAR", caption: "outfit dari @Eloraé", views: 700, kolId });

    const segera = await simpanOtomatis({ perangkat: a, url: urlVideo(handle, v.videoId), data: v, sekarang: tambahJam(SEKARANG, 2), pengaturanBrand: PB });
    expect(segera).toEqual({ ok: true, hasil: "DIABAIKAN", kol: { id: kolId, nama: `${tag} ${handle}` }, videoMasuk: 0, brand: 0 });

    const nanti = await simpanOtomatis({ perangkat: a, url: urlVideo(handle, v.videoId), data: { ...v, views: 1500 }, sekarang: tambahJam(SEKARANG, 13), pengaturanBrand: PB });
    expect(nanti).toEqual({ ok: true, hasil: "DISIMPAN", kol: { id: kolId, nama: `${tag} ${handle}` }, videoMasuk: 0, brand: 1 });
    expect((await kontenVideo(v.videoId))[0].metrics.map((m) => m.views)).toEqual([700, 1500]);
    expect(await prisma.kolLogPantau.count({ where: { perangkatId: a.id, kode: "OTOMATIS_KONTEN" } })).toBe(2);
  });

  it("video KOL yang diblokir → KOL_DIBLOKIR, tidak ada yang dibuat", async () => {
    await prisma.kol.update({ where: { id: kolId }, data: { blockedAt: SEKARANG } });
    const a = await perangkat();
    const v = video(handle, { sebutan: [AKUN_ELORAE] });
    expect(await simpanOtomatis({ perangkat: a, url: urlVideo(handle, v.videoId), data: v, sekarang: SEKARANG, pengaturanBrand: PB })).toEqual({
      ok: false,
      kode: "KOL_DIBLOKIR",
    });
    expect(await kontenVideo(v.videoId)).toEqual([]);
  });

  it("balapan: dua kiriman serentak untuk video yang sama membuat SATU konten", async () => {
    const a = await perangkat();
    const v = video(handle, { sebutan: [AKUN_ELORAE] });
    const kirim = () => simpanOtomatis({ perangkat: a, url: urlVideo(handle, v.videoId), data: v, sekarang: SEKARANG, pengaturanBrand: PB });
    const hasil = await Promise.all([kirim(), kirim(), kirim()]);
    for (const r of hasil) expect(r.ok).toBe(true);
    const ks = await kontenVideo(v.videoId);
    expect(ks).toHaveLength(1);
    expect(ks[0].metrics).toHaveLength(1);
    expect(await prisma.kolBrandCollab.count({ where: { kolId } })).toBe(1);
  });
});

describe("riwayat brand manual dari profil KOL", () => {
  it("tambah dengan link video TikTok memakai kunci yang sama dengan ekstensi; pembacaan berikutnya memperbarui baris itu", async () => {
    const id = vid();
    const r = await tambahBrandManual({ kolId, brandHandle: "@Toko.Manual", brandName: "Toko Manual", jenis: "BERBAYAR", postUrl: `${urlVideo(handle, id)}?is_from_webapp=1`, postedAt: SEKARANG, olehUserId: adminId });
    if (!r.ok) throw new Error(r.kode);
    const b = await prisma.kolBrandCollab.findUniqueOrThrow({ where: { id: r.id } });
    expect(b).toMatchObject({ kunci: `TIKTOK:${id}:toko.manual`, sumber: "MANUAL", platform: "TIKTOK", brandName: "Toko Manual", postUrl: urlVideo(handle, id) });
    expect(await tambahBrandManual({ kolId, brandHandle: "toko.manual", jenis: "TAG", postUrl: urlVideo(handle, id), olehUserId: adminId })).toEqual({ ok: false, kode: "SUDAH_ADA" });

    const a = await perangkat();
    await simpanManual({ perangkat: a, url: urlProfil(handle), data: profil(handle, [posting({ id, sebutan: ["toko.manual"], tagar: ["collab"] })]), sekarang: SEKARANG, pengaturanBrand: PB });
    const semua = await prisma.kolBrandCollab.findMany({ where: { kolId } });
    expect(semua).toHaveLength(1);
    expect(semua[0]).toMatchObject({ id: r.id, sumber: "MANUAL", jenis: "KOLABORASI" });

    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Kol", entityId: kolId, action: "KOL_BRAND_COLLAB_ADDED" } });
    expect(jejak.userId).toBe(adminId);
  });

  it("tanpa link → kunci MANUAL; handle KOL itu sendiri ditolak; hapus menulis jejak sebelum", async () => {
    const r = await tambahBrandManual({ kolId, brandHandle: "brand.x", jenis: "TAG", olehUserId: adminId });
    if (!r.ok) throw new Error(r.kode);
    const b = await prisma.kolBrandCollab.findUniqueOrThrow({ where: { id: r.id } });
    expect(b.kunci).toMatch(/^MANUAL:/);
    expect(await tambahBrandManual({ kolId, brandHandle: handle, jenis: "TAG", olehUserId: adminId })).toEqual({ ok: false, kode: "HANDLE_TIDAK_SAH" });
    expect(await tambahBrandManual({ kolId, brandHandle: "a b", jenis: "TAG", olehUserId: adminId })).toEqual({ ok: false, kode: "HANDLE_TIDAK_SAH" });
    expect(await tambahBrandManual({ kolId, brandHandle: "ok", jenis: "LAIN", olehUserId: adminId })).toEqual({ ok: false, kode: "JENIS_TIDAK_SAH" });

    expect(await hapusBrandKol({ id: r.id, kolId: "bukan-kol-ini", olehUserId: adminId })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
    expect(await hapusBrandKol({ id: r.id, kolId, olehUserId: adminId })).toEqual({ ok: true });
    expect(await prisma.kolBrandCollab.count({ where: { id: r.id } })).toBe(0);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Kol", entityId: kolId, action: "KOL_BRAND_COLLAB_DELETED" }, select: { changes: true, metadata: true } });
    expect(JSON.stringify(jejak.changes)).toContain("brand.x");
    expect(JSON.stringify(jejak.metadata)).toContain("MANUAL");
  });
});
