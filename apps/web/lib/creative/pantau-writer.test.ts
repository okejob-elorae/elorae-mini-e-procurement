import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { kunciMinta } from "./pantau-antrean";
import { prisma, seededId, seededIds } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { PANTAU_BAWAAN, type PengaturanPantau } from "./pantau-aturan";
import {
  buatKodeSambung,
  cabutPerangkat,
  jedaPerangkat,
  lanjutkanPerangkat,
  laporMasalah,
  perangkatDariToken,
  pinjamTugas,
  UMUR_MAKS_TUGAS_HARI,
  putuskanSendiri,
  sambungPerangkat,
  simpanHasil,
  simpanManual,
  statusPerangkat,
  susunAntrean,
  tolakMuatan,
  type PerangkatSah,
} from "./pantau-writer";

/*
 * Penulis pantau KOL terhadap basis data sungguhan. Semua waktu di tahun
 * 2000–2004 (satu hari acak per tes, supaya hitungan kuota "hari ini" tidak
 * bercampur dengan tes lain atau data sungguhan), pengaturan diberikan tes,
 * dan bacaan antrean dibatasi `cakupan`. Teardown lewat `seededId()`.
 */

const tag = `UJIPANTAU${Math.random().toString(36).slice(2, 7)}`;
const handle = tag.toLowerCase();
const PG: PengaturanPantau = { ...PANTAU_BAWAAN, kuotaHarian: 1000, maksGagalBeruntun: 3 };

let userId = "";
let kolId = "";
let akunId = "";
let briefId = "";
let kontenId = "";
let perangkatIds: string[] = [];
let tugasIds: string[] = [];

/** Pukul 10.00 WIB pada satu hari acak 2000–2004. */
function hariAcak(): Date {
  const r = (n: number) => Math.floor(Math.random() * n);
  return new Date(Date.UTC(2000 + r(5), r(12), 1 + r(28), 3, 0, 0));
}
let SEKARANG = hariAcak();
const tambahMenit = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
const tambahHari = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

async function perangkat(nama = "Laptop uji"): Promise<PerangkatSah> {
  const p = await prisma.kolPerangkat.create({
    data: { nama: `${tag} ${nama}`, dibuatOlehId: userId, tokenHash: createHash("sha256").update(`${tag}${Math.random()}`).digest("hex"), tersambungAt: SEKARANG },
    select: { id: true, nama: true, dibuatOlehId: true, dijedaSampai: true, alasanJeda: true, dicabutAt: true, terakhirLaporAt: true },
  });
  perangkatIds.push(p.id);
  return p;
}

async function tugas(isi: { jenis?: "PROFIL" | "KONTEN"; prioritas?: number; jatuhAt?: Date } = {}) {
  const jenis = isi.jenis ?? "PROFIL";
  const t = await prisma.kolTugasPantau.create({
    data: {
      jenis,
      platform: "TIKTOK",
      accountId: jenis === "PROFIL" ? akunId : null,
      contentId: jenis === "KONTEN" ? kontenId : null,
      url: jenis === "PROFIL" ? `https://www.tiktok.com/@${handle}` : `https://www.tiktok.com/@${handle}/video/7301234567890123456`,
      prioritas: isi.prioritas ?? 50,
      jatuhAt: isi.jatuhAt ?? tambahHari(SEKARANG, -1),
      kunci: `${tag}:${Math.random()}`,
    },
    select: { id: true },
  });
  tugasIds.push(t.id);
  return t.id;
}

/** Tugas konten ANTRE berkunci tertentu (mis. titik H7 yang belum dikerjakan). */
async function tugasBerkunci(kunci: string) {
  const t = await prisma.kolTugasPantau.create({
    data: {
      jenis: "KONTEN",
      platform: "TIKTOK",
      contentId: kontenId,
      url: `https://www.tiktok.com/@${handle}/video/7301234567890123456`,
      titikH: 7,
      prioritas: 80,
      jatuhAt: tambahHari(SEKARANG, -1),
      kunci,
    },
    select: { id: true },
  });
  tugasIds.push(t.id);
  return t.id;
}

/** Pinjamkan tugas `id` ke perangkat `p` (laporan hanya dihitung untuk pinjaman milik pelapornya). */
const pinjam = (p: PerangkatSah, id: string, sekarang = SEKARANG) =>
  pinjamTugas({ perangkatId: p.id, sekarang, pengaturan: PG, cakupan: { tugasIds: [id] } });

const hasilProfil = (pengikut = 15_000, uniqueId = handle) => ({
  jenis: "PROFIL" as const,
  uniqueId,
  secUid: "MS4wLjABAAAA-uji",
  pengikut,
  posting: [1, 2, 3, 4].map((i) => ({
    id: `p${i}`,
    dibuatPada: Math.floor(SEKARANG.getTime() / 1000) - (72 + i) * 3600,
    disematkan: false,
    views: 1000,
    like: 80,
    komentar: 10,
    share: 5,
    save: 5,
  })),
});

beforeEach(async () => {
  userId = "";
  kolId = "";
  akunId = "";
  briefId = "";
  kontenId = "";
  perangkatIds = [];
  tugasIds = [];
  SEKARANG = hariAcak();
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  const kol = await prisma.kol.create({
    data: { name: `${tag} KOL`, accounts: { create: [{ platform: "TIKTOK", handle: `@${handle}`, followers: 10_000 }] } },
    select: { id: true, accounts: { select: { id: true } } },
  });
  kolId = kol.id;
  akunId = kol.accounts[0].id;
  briefId = (
    await prisma.kolBrief.create({
      data: { docNo: `${tag}/1`, kolId, tahap: "TAYANG", liveAt: tambahHari(SEKARANG, -8), fee: 100_000, payStatus: "BELUM" },
      select: { id: true },
    })
  ).id;
  kontenId = (
    await prisma.kolContent.create({
      data: {
        collabId: briefId,
        platform: "TIKTOK",
        format: "VIDEO",
        link: `https://www.tiktok.com/@${handle}/video/7301234567890123456`,
        liveAt: tambahHari(SEKARANG, -8),
      },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  await prisma.kolLogPantau.deleteMany({ where: { perangkatId: { in: seededIds(perangkatIds) } } });
  await prisma.kolTugasPantau.deleteMany({
    where: { OR: [{ id: { in: seededIds(tugasIds) } }, { accountId: seededId(akunId) }, { contentId: seededId(kontenId) }] },
  });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...seededIds(perangkatIds), seededId(briefId)] } } });
  await prisma.kolPerangkat.deleteMany({ where: { id: { in: seededIds(perangkatIds) } } });
  await prisma.kolFollowerSnapshot.deleteMany({ where: { accountId: seededId(akunId) } });
  await prisma.kolContentMetric.deleteMany({ where: { contentId: seededId(kontenId) } });
  await prisma.kolContent.deleteMany({ where: { id: seededId(kontenId) } });
  await prisma.kolBrief.deleteMany({ where: { id: seededId(briefId) } });
  await prisma.kolAccount.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

describe("sambung perangkat", () => {
  it("kode 8 tanda, hanya hash-nya yang disimpan, sekali pakai, menghasilkan token", async () => {
    const k = await buatKodeSambung({ nama: `${tag} Laptop`, olehUserId: userId, sekarang: SEKARANG });
    if (!k.ok) throw new Error(k.kode);
    perangkatIds.push(k.perangkatId);
    expect(k.kode).toMatch(/^[A-Z2-9]{8}$/);
    const baris = await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: k.perangkatId } });
    expect(baris.kodeHash).toBe(createHash("sha256").update(k.kode).digest("hex"));
    expect(JSON.stringify(baris)).not.toContain(k.kode);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: k.perangkatId, action: "KOL_MONITOR_DEVICE_CODE_CREATED" } });
    expect(JSON.stringify(jejak)).not.toContain(k.kode);

    const ketik = `${k.kode.slice(0, 4).toLowerCase()}-${k.kode.slice(4)}`;
    const s = await sambungPerangkat({ kode: ketik, versi: "0.1.0", sekarang: tambahMenit(SEKARANG, 14) });
    if (!s.ok) throw new Error(s.kode);
    expect(s.token).toHaveLength(43);
    expect(s.perangkat).toEqual({ id: k.perangkatId, nama: `${tag} Laptop` });
    const sesudah = await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: k.perangkatId } });
    expect(sesudah.tokenHash).toBe(createHash("sha256").update(s.token).digest("hex"));
    expect(sesudah.kodeHash).toBeNull();
    expect(sesudah.versiEkstensi).toBe("0.1.0");

    expect(await sambungPerangkat({ kode: k.kode, versi: "0.1.0", sekarang: tambahMenit(SEKARANG, 14) })).toEqual({ ok: false, kode: "KODE_TIDAK_SAH" });
    expect((await perangkatDariToken(s.token, tambahMenit(SEKARANG, 15)))?.id).toBe(k.perangkatId);
  });

  it("versi ekstensi dari kepala permintaan dicatat; versi yang bentuknya aneh diabaikan", async () => {
    const p = await perangkat("Versi");
    const token = `${tag}-versi-${Math.random()}`;
    await prisma.kolPerangkat.update({ where: { id: p.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex"), versiEkstensi: "0.1.0" } });
    await perangkatDariToken(token, SEKARANG, { versi: "0.3.1" });
    expect((await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: p.id } })).versiEkstensi).toBe("0.3.1");
    await perangkatDariToken(token, SEKARANG, { versi: "<script>" });
    expect((await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: p.id } })).versiEkstensi).toBe("0.3.1");
  });

  it("kode lewat 15 menit kedaluwarsa; kode asal tidak sah", async () => {
    const k = await buatKodeSambung({ nama: `${tag} Lama`, olehUserId: userId, sekarang: SEKARANG });
    if (!k.ok) throw new Error(k.kode);
    perangkatIds.push(k.perangkatId);
    expect(await sambungPerangkat({ kode: k.kode, versi: "x", sekarang: tambahMenit(SEKARANG, 16) })).toEqual({ ok: false, kode: "KODE_KEDALUWARSA" });
    expect(await sambungPerangkat({ kode: "ZZZZZZZZ", versi: "x", sekarang: SEKARANG })).toEqual({ ok: false, kode: "KODE_TIDAK_SAH" });
    expect(await sambungPerangkat({ kode: "pendek", versi: "x" })).toEqual({ ok: false, kode: "KODE_TIDAK_SAH" });
  });

  it("menolak nama kosong", async () => {
    expect(await buatKodeSambung({ nama: "  ", olehUserId: userId })).toEqual({ ok: false, kode: "NAMA_WAJIB" });
  });
});

describe("pinjamTugas", () => {
  it("BALAPAN: dua perangkat serentak tidak pernah mendapat tugas yang sama", async () => {
    for (let putaran = 0; putaran < 3; putaran++) {
      const [a, b] = [await perangkat("A"), await perangkat("B")];
      const satu = await tugas();
      const [ra, rb] = await Promise.all([
        pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [satu] } }),
        pinjamTugas({ perangkatId: b.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [satu] } }),
      ]);
      const dapat = [ra, rb].filter((r) => r.tugas);
      expect(dapat).toHaveLength(1);
      expect([ra, rb].find((r) => !r.tugas)?.alasan).toBe("ANTREAN_KOSONG");
      const t = await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id: satu } });
      expect(t.status).toBe("DIPINJAM");
      expect(t.perangkatId).toBe(ra.tugas ? a.id : b.id);
    }
  });

  it("BALAPAN: dua tugas, dua perangkat serentak → masing-masing satu yang berbeda", async () => {
    const [a, b] = [await perangkat("A"), await perangkat("B")];
    const ids = [await tugas(), await tugas()];
    const [ra, rb] = await Promise.all([
      pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: ids } }),
      pinjamTugas({ perangkatId: b.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: ids } }),
    ]);
    expect(ra.tugas && rb.tugas).toBeTruthy();
    expect(ra.tugas!.id).not.toBe(rb.tugas!.id);
  });

  it(`tugas yang jatuh tempo lebih dari ${UMUR_MAKS_TUGAS_HARI} hari lalu tidak pernah dipinjamkan`, async () => {
    // Penjaga ini membuat ekstensi yang sedang berjalan tidak mengambil tugas tes (bertanggal 2000–2004)
    // dari basis data lokal yang sama — kejadian nyata 2026-10-09.
    const a = await perangkat();
    const basi = await tugas({ prioritas: 99, jatuhAt: tambahHari(SEKARANG, -(UMUR_MAKS_TUGAS_HARI + 1)) });
    const r = await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [basi] } });
    expect(r).toEqual({ tugas: null, alasan: "ANTREAN_KOSONG" });
    const pas = await tugas({ prioritas: 99, jatuhAt: tambahHari(SEKARANG, -UMUR_MAKS_TUGAS_HARI) });
    expect((await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [basi, pas] } })).tugas?.id).toBe(pas);
  });

  it("prioritas tertinggi dulu; payload membawa url dan handle tanpa @", async () => {
    const a = await perangkat();
    const rendah = await tugas({ prioritas: 20 });
    const tinggi = await tugas({ jenis: "KONTEN", prioritas: 90 });
    const r = await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [rendah, tinggi] } });
    expect(r.tugas).toEqual({
      id: tinggi,
      jenis: "KONTEN",
      platform: "TIKTOK",
      url: `https://www.tiktok.com/@${handle}/video/7301234567890123456`,
      handle,
    });
    const t = await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id: tinggi } });
    expect(t.pinjamSampai?.getTime()).toBe(tambahMenit(SEKARANG, 5).getTime());
  });

  it("perangkat yang masih memegang tugas mendapat tugas yang sama lagi; lease lewat → kembali ke antrean", async () => {
    const [a, b] = [await perangkat("A"), await perangkat("B")];
    const ids = [await tugas(), await tugas()];
    const pertama = await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: ids } });
    const lagi = await pinjamTugas({ perangkatId: a.id, sekarang: tambahMenit(SEKARANG, 2), pengaturan: PG, cakupan: { tugasIds: ids } });
    expect(lagi.tugas?.id).toBe(pertama.tugas?.id);

    // Tugas kedua dipinjam B, lalu lease A lewat: B mendapat tugas A yang kembali ke antrean.
    const kedua = await pinjamTugas({ perangkatId: b.id, sekarang: tambahMenit(SEKARANG, 2), pengaturan: PG, cakupan: { tugasIds: ids } });
    expect(kedua.tugas?.id).not.toBe(pertama.tugas?.id);
    await prisma.kolTugasPantau.update({ where: { id: kedua.tugas!.id }, data: { status: "SELESAI" } });
    const sesudahLewat = await pinjamTugas({ perangkatId: b.id, sekarang: tambahMenit(SEKARANG, 10), pengaturan: PG, cakupan: { tugasIds: ids } });
    expect(sesudahLewat.tugas?.id).toBe(pertama.tugas?.id);
  });

  it("di luar jam kerja hanya permintaan langsung (Cek sekarang) yang dipinjamkan", async () => {
    const a = await perangkat();
    const biasa = await tugas({ prioritas: 99 });
    const minta = await tugasBerkunci(kunciMinta(kontenId, SEKARANG.getTime()));
    // 20.00 WIB.
    const malam = tambahMenit(SEKARANG, 600);
    expect((await pinjamTugas({ perangkatId: a.id, sekarang: malam, pengaturan: PG, cakupan: { tugasIds: [biasa, minta] } })).tugas?.id).toBe(minta);
    expect(await pinjamTugas({ perangkatId: a.id, sekarang: malam, pengaturan: PG, cakupan: { tugasIds: [biasa] } })).toEqual({ tugas: null, alasan: "DI_LUAR_JAM" });
  });

  it("alasan tanpa tugas: NONAKTIF, DIJEDA, DI_LUAR_JAM, KUOTA_HABIS, ANTREAN_KOSONG", async () => {
    const a = await perangkat();
    const id = await tugas();
    const pinjam = (o: { sekarang?: Date; pengaturan?: PengaturanPantau } = {}) =>
      pinjamTugas({ perangkatId: a.id, sekarang: o.sekarang ?? SEKARANG, pengaturan: o.pengaturan ?? PG, cakupan: { tugasIds: [id] } });

    expect(await pinjam({ pengaturan: { ...PG, aktif: false } })).toEqual({ tugas: null, alasan: "NONAKTIF" });
    // 20.00 WIB.
    expect(await pinjam({ sekarang: tambahMenit(SEKARANG, 600) })).toEqual({ tugas: null, alasan: "DI_LUAR_JAM" });
    await prisma.kolLogPantau.create({ data: { perangkatId: a.id, tugasId: "lain", jenis: "HASIL", createdAt: tambahMenit(SEKARANG, -30) } });
    expect(await pinjam({ pengaturan: { ...PG, kuotaHarian: 1 } })).toEqual({ tugas: null, alasan: "KUOTA_HABIS" });
    await prisma.kolPerangkat.update({ where: { id: a.id }, data: { dijedaSampai: tambahMenit(SEKARANG, 30), alasanJeda: "CAPTCHA" } });
    expect(await pinjam()).toEqual({ tugas: null, alasan: "DIJEDA" });
    await prisma.kolPerangkat.update({ where: { id: a.id }, data: { dijedaSampai: null, alasanJeda: null } });
    await prisma.kolTugasPantau.update({ where: { id }, data: { jatuhAt: tambahHari(SEKARANG, 1) } });
    expect(await pinjam()).toEqual({ tugas: null, alasan: "ANTREAN_KOSONG" });
  });
});

describe("simpanHasil", () => {
  it("profil: catatan pengikut ber-ER, akun diperbarui, tugas SELESAI, log HASIL; kiriman kedua = ulang", async () => {
    const a = await perangkat();
    const id = await tugas();
    await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [id] } });
    const r = await simpanHasil({ perangkat: a, tugasId: id, data: hasilProfil(), sekarang: SEKARANG, pengaturan: PG });
    expect(r).toEqual({ ok: true });

    const snap = await prisma.kolFollowerSnapshot.findMany({ where: { accountId: akunId } });
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ followers: 15_000, source: "ekstensi", avgViews: 1000, postsCounted: 4, perangkatId: a.id });
    expect(Number(snap[0].er)).toBe(10);
    const akun = await prisma.kolAccount.findUniqueOrThrow({ where: { id: akunId } });
    expect(akun).toMatchObject({ followers: 15_000, avgViews: 1000, checkStatus: "OK", platformUserId: "MS4wLjABAAAA-uji" });
    expect(Number(akun.er)).toBe(10);
    expect(akun.lastCheckedAt?.getTime()).toBe(SEKARANG.getTime());
    const t = await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } });
    expect(t).toMatchObject({ status: "SELESAI", perangkatId: a.id });
    expect(await prisma.kolLogPantau.count({ where: { tugasId: id, jenis: "HASIL" } })).toBe(1);

    expect(await simpanHasil({ perangkat: a, tugasId: id, data: hasilProfil(16_000), sekarang: SEKARANG, pengaturan: PG })).toEqual({ ok: true, ulang: true });
    expect(await prisma.kolFollowerSnapshot.count({ where: { accountId: akunId } })).toBe(1);
  });

  it("uniqueId berbeda: tugas GAGAL AKUN_BERBEDA, tidak ada yang disimpan", async () => {
    const a = await perangkat();
    const id = await tugas();
    await pinjam(a, id);
    const r = await simpanHasil({ perangkat: a, tugasId: id, data: hasilProfil(15_000, "orang.lain"), sekarang: SEKARANG, pengaturan: PG });
    expect(r).toEqual({ ok: false, kode: "AKUN_BERBEDA" });
    expect(await prisma.kolFollowerSnapshot.count({ where: { accountId: akunId } })).toBe(0);
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "GAGAL", galatTerakhir: "AKUN_BERBEDA" });
    expect(await prisma.kolLogPantau.count({ where: { tugasId: id, jenis: "MASALAH", kode: "AKUN_BERBEDA" } })).toBe(1);
  });

  it("uniqueId cocok tanpa memandang huruf besar dan @", async () => {
    const a = await perangkat();
    const id = await tugas();
    expect(await simpanHasil({ perangkat: a, tugasId: id, data: hasilProfil(15_000, `@${handle.toUpperCase()}`), sekarang: SEKARANG, pengaturan: PG })).toEqual({ ok: true });
  });

  it("konten: angka baru bersumber ekstensi + perangkat, dan tahap maju lewat terapkanMajuOtomatis", async () => {
    const a = await perangkat();
    const id = await tugas({ jenis: "KONTEN" });
    const r = await simpanHasil({
      perangkat: a,
      tugasId: id,
      data: { jenis: "KONTEN", videoId: "7301234567890123456", uniqueId: handle, views: 5000, like: 400, komentar: 30, share: 10, save: 20 },
      sekarang: SEKARANG,
      pengaturan: PG,
    });
    expect(r).toEqual({ ok: true });
    const m = await prisma.kolContentMetric.findFirstOrThrow({ where: { contentId: kontenId } });
    expect(m).toMatchObject({ views: 5000, likes: 400, comments: 30, shares: 10, saves: 20, source: "ekstensi", perangkatId: a.id, createdById: userId });
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: briefId } })).tahap).toBe("ANGKA_MASUK");
  });

  it("konten: video lain ditolak KONTEN_BERBEDA; jenis berbeda ditolak tanpa mengubah tugas", async () => {
    const a = await perangkat();
    const id = await tugas({ jenis: "KONTEN" });
    expect(await simpanHasil({ perangkat: a, tugasId: id, data: hasilProfil(), sekarang: SEKARANG, pengaturan: PG })).toEqual({ ok: false, kode: "JENIS_BERBEDA" });
    expect((await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).status).toBe("ANTRE");
    await pinjam(a, id);
    const r = await simpanHasil({
      perangkat: a,
      tugasId: id,
      data: { jenis: "KONTEN", videoId: "999", uniqueId: handle, views: 1, like: 1, komentar: 0, share: 0, save: 0 },
      sekarang: SEKARANG,
      pengaturan: PG,
    });
    expect(r).toEqual({ ok: false, kode: "KONTEN_BERBEDA" });
    expect(await prisma.kolContentMetric.count({ where: { contentId: kontenId } })).toBe(0);
  });

  it("angka di atas batas kolom Int disimpan terpangkas, profilnya tetap tersimpan", async () => {
    const a = await perangkat();
    const id = await tugas();
    const data = hasilProfil();
    data.posting = data.posting.map((x) => ({ ...x, views: 5_000_000_000, like: 500_000_000, komentar: 0, share: 0, save: 0 }));
    expect(await simpanHasil({ perangkat: a, tugasId: id, data, sekarang: SEKARANG, pengaturan: PG })).toEqual({ ok: true });
    const snap = await prisma.kolFollowerSnapshot.findFirstOrThrow({ where: { accountId: akunId } });
    expect(snap.avgViews).toBe(2_147_483_647);
    expect(Number(snap.er)).toBe(10);
  });

  it("tugas tidak dikenal", async () => {
    const a = await perangkat();
    expect(await simpanHasil({ perangkat: a, tugasId: "tidak-ada", data: hasilProfil(), sekarang: SEKARANG, pengaturan: PG })).toEqual({ ok: false, kode: "TUGAS_TIDAK_ADA" });
  });
});

describe("laporMasalah", () => {
  it("GAGAL_MUAT diantrekan lagi sampai percobaan ketiga, lalu GAGAL", async () => {
    const a = await perangkat();
    const id = await tugas();
    const lapor = async () => {
      await pinjam(a, id);
      await laporMasalah({ perangkat: a, masalah: { kode: "GAGAL_MUAT", tugasId: id, pesan: null }, sekarang: SEKARANG, pengaturan: { ...PG, maksGagalBeruntun: 20 } });
    };
    await lapor();
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ANTRE", percobaan: 1, galatTerakhir: "GAGAL_MUAT" });
    await lapor();
    await lapor();
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "GAGAL", percobaan: 3 });
  });

  it("CAPTCHA menjeda perangkat, tugasnya kembali ke antrean tanpa menambah percobaan; jeda lewat dilepas otomatis", async () => {
    const a = await perangkat();
    const id = await tugas();
    await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [id] } });
    const r = await laporMasalah({ perangkat: a, masalah: { kode: "CAPTCHA", tugasId: id, pesan: "captcha muncul" }, sekarang: SEKARANG, pengaturan: PG });
    expect(r).toEqual({ ok: true, dijedaSampai: tambahMenit(SEKARANG, 60).toISOString() });
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ANTRE", percobaan: 0, perangkatId: null });
    expect(await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ alasanJeda: "CAPTCHA" });
    expect((await pinjamTugas({ perangkatId: a.id, sekarang: tambahMenit(SEKARANG, 1), pengaturan: PG, cakupan: { tugasIds: [id] } })).alasan).toBe("DIJEDA");

    const p = await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: a.id } });
    const token = `${tag}x`.padEnd(43, "x");
    await prisma.kolPerangkat.update({ where: { id: a.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    const sesudah = await perangkatDariToken(token, tambahMenit(SEKARANG, 61));
    expect(sesudah?.dijedaSampai).toBeNull();
    expect(p.dijedaSampai).not.toBeNull();
    expect(await prisma.kolLogPantau.count({ where: { perangkatId: a.id, jenis: "LANJUT" } })).toBe(1);
  });

  it("laporan untuk tugas yang tidak sedang dipinjam pelapornya tidak menambah percobaan", async () => {
    const [a, b] = [await perangkat("A"), await perangkat("B")];
    const id = await tugas();
    await laporMasalah({ perangkat: a, masalah: { kode: "GAGAL_MUAT", tugasId: id, pesan: null }, sekarang: SEKARANG, pengaturan: PG });
    await pinjam(b, id);
    await laporMasalah({ perangkat: a, masalah: { kode: "GAGAL_MUAT", tugasId: id, pesan: null }, sekarang: SEKARANG, pengaturan: PG });
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DIPINJAM", perangkatId: b.id, percobaan: 0 });
    expect(await prisma.kolLogPantau.count({ where: { tugasId: id } })).toBe(0);
  });

  it("TIDAK_DITEMUKAN pada tugas profil menandai akun dan waktu ceknya", async () => {
    const a = await perangkat();
    const id = await tugas();
    await pinjam(a, id);
    await laporMasalah({ perangkat: a, masalah: { kode: "TIDAK_DITEMUKAN", tugasId: id, pesan: null }, sekarang: SEKARANG, pengaturan: PG });
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "GAGAL" });
    const akun = await prisma.kolAccount.findUniqueOrThrow({ where: { id: akunId } });
    expect(akun.checkStatus).toBe("TIDAK_DITEMUKAN");
    expect(akun.lastCheckedAt?.getTime()).toBe(SEKARANG.getTime());
  });

  it("tiga kegagalan perangkat berturut-turut menjeda perangkat; LANJUT memutus deretnya", async () => {
    const a = await perangkat();
    const ids = [await tugas(), await tugas(), await tugas()];
    for (const [i, id] of ids.entries()) {
      await pinjam(a, id, tambahMenit(SEKARANG, i));
      await laporMasalah({ perangkat: a, masalah: { kode: "TIDAK_TERBACA", tugasId: id, pesan: null }, sekarang: tambahMenit(SEKARANG, i), pengaturan: PG });
    }
    expect(await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ alasanJeda: "GAGAL_BERUNTUN" });
    await lanjutkanPerangkat({ perangkatId: a.id, olehUserId: userId, sekarang: tambahMenit(SEKARANG, 5) });
    await pinjam(a, ids[0], tambahMenit(SEKARANG, 6));
    await laporMasalah({ perangkat: a, masalah: { kode: "TIDAK_TERBACA", tugasId: ids[0], pesan: null }, sekarang: tambahMenit(SEKARANG, 6), pengaturan: PG });
    expect(await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ dijedaSampai: null, alasanJeda: null });
  });
});

describe("tolakMuatan (hasil yang bentuknya tidak sah)", () => {
  it("dihitung satu percobaan per pinjaman: laporan TIDAK_TERBACA susulan tidak dihitung lagi", async () => {
    const a = await perangkat();
    const id = await tugas();
    await pinjam(a, id);
    await tolakMuatan({ perangkat: a, tugasId: id, sekarang: SEKARANG, pengaturan: PG });
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ANTRE", percobaan: 1, galatTerakhir: "MUATAN_TIDAK_SAH" });
    await laporMasalah({ perangkat: a, masalah: { kode: "TIDAK_TERBACA", tugasId: id, pesan: null }, sekarang: SEKARANG, pengaturan: PG });
    expect((await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).percobaan).toBe(1);
    expect(await prisma.kolLogPantau.count({ where: { tugasId: id, jenis: "MASALAH" } })).toBe(1);
  });

  it("muatan rusak berulang tidak berputar selamanya: percobaan ketiga → GAGAL", async () => {
    const a = await perangkat();
    const id = await tugas();
    for (let i = 0; i < 3; i++) {
      await pinjam(a, id, tambahMenit(SEKARANG, i));
      await tolakMuatan({ perangkat: a, tugasId: id, sekarang: tambahMenit(SEKARANG, i), pengaturan: { ...PG, maksGagalBeruntun: 20 } });
    }
    expect(await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "GAGAL", percobaan: 3 });
  });
});

describe("putuskanSendiri", () => {
  it("ekstensi mencabut tokennya sendiri; tugas pinjamannya kembali ke antrean", async () => {
    const a = await perangkat();
    const token = `${tag}z`.padEnd(43, "z");
    await prisma.kolPerangkat.update({ where: { id: a.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    const id = await tugas();
    await pinjam(a, id);
    expect(await putuskanSendiri({ perangkat: a, sekarang: SEKARANG })).toEqual({ ok: true });
    expect(await perangkatDariToken(token, SEKARANG)).toBeNull();
    expect((await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: a.id } })).dicabutAt?.getTime()).toBe(SEKARANG.getTime());
    expect((await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).status).toBe("ANTRE");
    expect(await prisma.kolLogPantau.count({ where: { perangkatId: a.id, jenis: "SAMBUNG", kode: "PUTUS" } })).toBe(1);
  });
});

describe("statusPerangkat", () => {
  it("membawa pengaturan jam, jeda, istirahat, dan jeda otomatis; jeda yang berlaku disebut", async () => {
    const a = await perangkat();
    const s = await statusPerangkat({ ...a, dijedaSampai: tambahMenit(SEKARANG, 30), alasanJeda: "CAPTCHA" }, { sekarang: SEKARANG, pengaturan: PG });
    expect(s.pengaturan).toEqual({
      jamMulai: "08:00",
      jamSelesai: "17:00",
      jedaMinDetik: 15,
      jedaMaksDetik: 40,
      istirahatSetiapMenit: 45,
      istirahatMinMenit: 5,
      istirahatMaksMenit: 10,
      jedaOtomatisMenit: 60,
    });
    expect(s).toMatchObject({ aktif: false, dijedaSampai: tambahMenit(SEKARANG, 30).toISOString(), alasanJeda: "CAPTCHA" });
  });

  it("menyebut berapa permintaan langsung (Cek sekarang) yang menunggu — ekstensi lalu tidak menunda", async () => {
    const a = await perangkat();
    const sebelum = (await statusPerangkat(a, { sekarang: SEKARANG, pengaturan: PG })).permintaanLangsung;
    await tugas({ prioritas: 99 });
    await tugasBerkunci(kunciMinta(kontenId, SEKARANG.getTime() - 5_000));
    expect((await statusPerangkat(a, { sekarang: SEKARANG, pengaturan: PG })).permintaanLangsung).toBe(sebelum + 1);
  });
});

describe("tindakan layar", () => {
  it("jeda, lanjutkan, cabut menulis AuditLog; cabut mematikan token dan mengembalikan tugas pinjaman", async () => {
    const a = await perangkat();
    const token = `${tag}y`.padEnd(43, "y");
    await prisma.kolPerangkat.update({ where: { id: a.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    const id = await tugas();
    await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [id] } });

    expect(await jedaPerangkat({ perangkatId: a.id, olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: true });
    expect((await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: a.id } })).alasanJeda).toBe("MANUAL");
    expect((await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).status).toBe("ANTRE");
    expect(await lanjutkanPerangkat({ perangkatId: a.id, olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: true });

    await pinjamTugas({ perangkatId: a.id, sekarang: SEKARANG, pengaturan: PG, cakupan: { tugasIds: [id] } });
    expect(await cabutPerangkat({ perangkatId: a.id, olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: true });
    expect(await perangkatDariToken(token, SEKARANG)).toBeNull();
    expect((await prisma.kolTugasPantau.findUniqueOrThrow({ where: { id } })).status).toBe("ANTRE");
    const aksi = (await prisma.auditLog.findMany({ where: { entityId: a.id }, select: { action: true } })).map((x) => x.action).sort();
    expect(aksi).toEqual(["KOL_MONITOR_DEVICE_PAUSED", "KOL_MONITOR_DEVICE_RESUMED", "KOL_MONITOR_DEVICE_REVOKED"]);
    expect(await jedaPerangkat({ perangkatId: a.id, olehUserId: userId })).toEqual({ ok: false, kode: "SUDAH_DICABUT" });
  });
});

describe("susunAntrean", () => {
  it("konten yang tayang 8 hari lalu mendapat titik H7; akun yang belum pernah dicek mendapat tugas berkunci hari WIB; tidak dobel", async () => {
    // 18.00 UTC = 01.00 WIB hari berikutnya: kunci profil memakai hari WIB.
    const malam = new Date(Date.UTC(SEKARANG.getUTCFullYear(), SEKARANG.getUTCMonth(), SEKARANG.getUTCDate(), 18));
    const r = await susunAntrean({ sekarang: malam, pengaturan: PG, cakupan: { kontenIds: [kontenId], akunIds: [akunId] } });
    expect(r).toEqual({ dibuat: 2, dilewati: 0 });
    const ada = await prisma.kolTugasPantau.findMany({ where: { OR: [{ accountId: akunId }, { contentId: kontenId }] }, orderBy: { kunci: "asc" } });
    expect(ada.map((t) => t.kunci)).toEqual([`KONTEN:${kontenId}:H7`, `PROFIL:${akunId}:${formatDateOnlyJakarta(malam)}`]);
    expect(formatDateOnlyJakarta(malam)).not.toBe(malam.toISOString().slice(0, 10));
    expect(ada.find((t) => t.jenis === "PROFIL")?.url).toBe(`https://www.tiktok.com/@${handle}`);

    expect(await susunAntrean({ sekarang: malam, pengaturan: PG, cakupan: { kontenIds: [kontenId], akunIds: [akunId] } })).toEqual({ dibuat: 0, dilewati: 0 });
  });

  it("sesudah H+30: cek berkala 7 hari sejak angka terakhir; tugas yang masih terbuka menahannya", async () => {
    const lingkup = { kontenIds: [kontenId], akunIds: [] };
    await prisma.kolContent.update({ where: { id: kontenId }, data: { liveAt: tambahHari(SEKARANG, -60) } });
    await prisma.kolContentMetric.create({ data: { contentId: kontenId, recordedAt: tambahHari(SEKARANG, -3), views: 10 } });
    expect(await susunAntrean({ sekarang: SEKARANG, pengaturan: PG, cakupan: lingkup })).toEqual({ dibuat: 0, dilewati: 0 });

    await prisma.kolContentMetric.updateMany({ where: { contentId: seededId(kontenId) }, data: { recordedAt: tambahHari(SEKARANG, -7) } });
    expect(await susunAntrean({ sekarang: SEKARANG, pengaturan: PG, cakupan: lingkup })).toEqual({ dibuat: 1, dilewati: 0 });
    const ada = await prisma.kolTugasPantau.findMany({ where: { contentId: kontenId } });
    expect(ada.map((t) => [t.kunci, t.prioritas, t.titikH])).toEqual([[`KONTEN:${kontenId}:B${formatDateOnlyJakarta(SEKARANG)}`, 60, null]]);
    // Tugas berkala kemarin belum dikerjakan: hari ini tidak ditambah lagi.
    expect(await susunAntrean({ sekarang: tambahHari(SEKARANG, 1), pengaturan: PG, cakupan: lingkup })).toEqual({ dibuat: 0, dilewati: 0 });
  });

  it("bacaan hari ini menutup titik H7 yang masih antre (dilewati), tanpa tugas baru", async () => {
    const lingkup = { kontenIds: [kontenId], akunIds: [] };
    await tugasBerkunci(`KONTEN:${kontenId}:H7`);
    await prisma.kolContentMetric.create({ data: { contentId: kontenId, recordedAt: tambahMenit(SEKARANG, -60), views: 10 } });
    expect(await susunAntrean({ sekarang: SEKARANG, pengaturan: PG, cakupan: lingkup })).toEqual({ dibuat: 0, dilewati: 1 });
    expect((await prisma.kolTugasPantau.findUniqueOrThrow({ where: { kunci: `KONTEN:${kontenId}:H7` } })).status).toBe("DILEWATI");
  });

  it("KOL diblokir tidak pernah dicek", async () => {
    await prisma.kol.update({ where: { id: kolId }, data: { blockedAt: SEKARANG } });
    expect(await susunAntrean({ sekarang: SEKARANG, pengaturan: PG, cakupan: { kontenIds: [kontenId], akunIds: [akunId] } })).toEqual({ dibuat: 0, dilewati: 0 });
  });
});

describe("simpanManual", () => {
  // KOL, akun, kolaborasi dan konten yang DIBUAT oleh "Simpan ke Elorae" — dibersihkan di sini.
  let kolBaruIds: string[] = [];
  let penggunaUjiId = "";
  beforeEach(() => {
    kolBaruIds = [];
    penggunaUjiId = "";
  });
  afterEach(async () => {
    const ids = seededIds(kolBaruIds);
    // Kolaborasi KOL baru, plus kolaborasi tambahan yang mungkin dibuat untuk KOL fixture (bukan briefId fixture).
    const brief = await prisma.kolBrief.findMany({ where: { OR: [{ kolId: { in: ids } }, { kolId: seededId(kolId), id: { not: seededId(briefId) } }] }, select: { id: true } });
    const briefIds = brief.map((b) => b.id);
    const kontenIds = (await prisma.kolContent.findMany({ where: { collabId: { in: seededIds(briefIds) } }, select: { id: true } })).map((k) => k.id);
    const akunIds = (await prisma.kolAccount.findMany({ where: { kolId: { in: ids } }, select: { id: true } })).map((a) => a.id);
    await prisma.kolContentMetric.deleteMany({ where: { contentId: { in: seededIds(kontenIds) } } });
    await prisma.kolTugasPantau.deleteMany({ where: { OR: [{ contentId: { in: seededIds(kontenIds) } }, { accountId: { in: seededIds(akunIds) } }] } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...seededIds(briefIds), ...seededIds(kontenIds)] } } });
    await prisma.kolContent.deleteMany({ where: { id: { in: seededIds(kontenIds) } } });
    await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(briefIds) } } });
    await prisma.kolFollowerSnapshot.deleteMany({ where: { accountId: { in: seededIds(akunIds) } } });
    await prisma.kolAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolBaruIds) } } });
    if (penggunaUjiId) await prisma.user.delete({ where: { id: penggunaUjiId } });
  });

  /** Perangkat yang dipasang ADMIN (izin `*`), supaya "Simpan ke Elorae" boleh membuat KOL. */
  async function perangkatAdmin(): Promise<PerangkatSah> {
    const admin = await prisma.user.findFirstOrThrow({ where: { roleDefinition: { isSystem: true } }, select: { id: true } });
    const p = await perangkat("Laptop admin");
    await prisma.kolPerangkat.update({ where: { id: p.id }, data: { dibuatOlehId: admin.id } });
    return { ...p, dibuatOlehId: admin.id };
  }

  it("profil dicocokkan lewat handle tanpa memandang huruf besar dan @; tidak memakan kuota", async () => {
    const a = await perangkat();
    const r = await simpanManual({ perangkat: a, url: `https://www.tiktok.com/@${handle}`, data: hasilProfil(20_000, handle.toUpperCase()), sekarang: SEKARANG });
    expect(r).toEqual({ ok: true, cocok: { kolId, nama: `${tag} KOL` }, dibuat: { kol: false, konten: false } });
    expect((await prisma.kolAccount.findUniqueOrThrow({ where: { id: akunId } })).followers).toBe(20_000);
    expect(await prisma.kolLogPantau.count({ where: { perangkatId: a.id, jenis: "HASIL", tugasId: null } })).toBe(1);
  });

  it("konten dicocokkan lewat id video di link", async () => {
    const a = await perangkat();
    const r = await simpanManual({
      perangkat: a,
      url: `https://www.tiktok.com/@${handle}/video/7301234567890123456`,
      data: { jenis: "KONTEN", videoId: "7301234567890123456", uniqueId: handle, views: 10, like: 1, komentar: 0, share: 0, save: 0 },
      sekarang: SEKARANG,
    });
    expect(r).toEqual({ ok: true, cocok: { kolId, nama: `${tag} KOL` }, dibuat: { kol: false, konten: false } });
  });

  it("ER dan rata-rata views KOL mengikuti akun TikTok utamanya, kecuali yang diketik tangan", async () => {
    const a = await perangkat();
    const simpan = (pengikut: number, menit: number, views = 1000) =>
      simpanManual({
        perangkat: a,
        url: `https://www.tiktok.com/@${handle}`,
        data: { ...hasilProfil(pengikut), posting: hasilProfil(pengikut).posting.map((p) => ({ ...p, views })) },
        sekarang: tambahMenit(SEKARANG, menit),
      });
    const kolNow = async () => {
      const k = await prisma.kol.findUniqueOrThrow({ where: { id: kolId }, select: { engagementRate: true, avgViews: true } });
      return { er: k.engagementRate === null ? null : Number(k.engagementRate), avgViews: k.avgViews };
    };

    // Kosong → terisi angka terukur (4 posting: (80+10+5+5)/1000 = 10%, rata-rata 1.000 views).
    expect((await simpan(20_000, 0)).ok).toBe(true);
    expect(await kolNow()).toEqual({ er: 10, avgViews: 1000 });

    // Masih sama dengan terukur sebelumnya → ikut angka baru (views 2.000 → ER 5%).
    await simpan(20_000, 5, 2000);
    expect(await kolNow()).toEqual({ er: 5, avgViews: 2000 });

    // Pemilik mengetik ER lain → ER dibiarkan, rata-rata views tetap mengikuti.
    await prisma.kol.update({ where: { id: kolId }, data: { engagementRate: 4.8 } });
    await simpan(20_000, 10, 4000);
    expect(await kolNow()).toEqual({ er: 4.8, avgViews: 4000 });

    // Akun TikTok kedua yang lebih kecil tidak menggeser angka KOL.
    const kecil = await prisma.kolAccount.create({ data: { kolId, platform: "TIKTOK", handle: `${handle}kecil`, followers: 5 }, select: { id: true } });
    try {
      await simpanManual({ perangkat: a, url: `https://www.tiktok.com/@${handle}kecil`, data: hasilProfil(5, `${handle}kecil`), sekarang: tambahMenit(SEKARANG, 15) });
      expect(await kolNow()).toEqual({ er: 4.8, avgViews: 4000 });
    } finally {
      await prisma.kolFollowerSnapshot.deleteMany({ where: { accountId: seededId(kecil.id) } });
      await prisma.kolAccount.delete({ where: { id: kecil.id } });
    }
  });

  it("profil yang belum ada → KOL baru \"@handle\" + akun TikTok-nya, angka langsung tersimpan, jejak bersumber EKSTENSI", async () => {
    const a = await perangkatAdmin();
    const baru = `${handle}baru`;
    const r = await simpanManual({ perangkat: a, url: `https://www.tiktok.com/@${baru}`, data: hasilProfil(33_000, baru), sekarang: SEKARANG });
    if (!r.ok) throw new Error(r.kode);
    kolBaruIds.push(r.cocok.kolId);
    expect(r).toEqual({ ok: true, cocok: { kolId: r.cocok.kolId, nama: `@${baru}` }, dibuat: { kol: true, konten: false } });
    const kol = await prisma.kol.findUniqueOrThrow({ where: { id: r.cocok.kolId }, select: { createdById: true, accounts: { select: { id: true, platform: true, handle: true, followers: true, url: true } } } });
    expect(kol.createdById).toBe(a.dibuatOlehId);
    expect(kol.accounts).toHaveLength(1);
    expect(kol.accounts[0]).toMatchObject({ platform: "TIKTOK", followers: 33_000, url: `https://www.tiktok.com/@${baru}` });
    expect(await prisma.kolFollowerSnapshot.count({ where: { accountId: kol.accounts[0].id } })).toBe(1);
    const jejak = await prisma.auditLog.findMany({ where: { entityId: r.cocok.kolId }, select: { metadata: true } });
    expect(JSON.stringify(jejak)).toContain("EKSTENSI");

    // Simpan kedua kali: KOL yang sama, tidak dibuat lagi.
    const r2 = await simpanManual({ perangkat: a, url: `https://www.tiktok.com/@${baru}`, data: hasilProfil(34_000, baru), sekarang: tambahMenit(SEKARANG, 5) });
    expect(r2).toEqual({ ok: true, cocok: { kolId: r.cocok.kolId, nama: `@${baru}` }, dibuat: { kol: false, konten: false } });
  });

  it("video baru dari akun yang sudah ada → konten di kolaborasi berjalan KOL itu, angkanya tersimpan, tanpa tugas segera", async () => {
    const a = await perangkatAdmin();
    const videoId = "7301234567890999999";
    const r = await simpanManual({
      perangkat: a,
      url: `https://www.tiktok.com/@${handle}/video/${videoId}?is_from_webapp=1`,
      data: { jenis: "KONTEN", videoId, uniqueId: handle, views: 500, like: 40, komentar: 3, share: 1, save: 2, dibuatPada: Math.floor(SEKARANG.getTime() / 1000) - 86_400 },
      sekarang: SEKARANG,
    });
    expect(r).toEqual({ ok: true, cocok: { kolId, nama: `${tag} KOL` }, dibuat: { kol: false, konten: true } });
    const k = await prisma.kolContent.findFirstOrThrow({ where: { link: { contains: videoId } }, select: { id: true, collabId: true, link: true, metrics: { select: { views: true } } } });
    expect(k.collabId).toBe(briefId); // kolaborasi TAYANG fixture masih berjalan → dipakai, bukan kolaborasi baru
    expect(k.link).toBe(`https://www.tiktok.com/@${handle}/video/${videoId}`);
    expect(k.metrics.map((m) => m.views)).toEqual([500]);
    expect(await prisma.kolTugasPantau.count({ where: { contentId: k.id } })).toBe(0);
    await prisma.kolContentMetric.deleteMany({ where: { contentId: k.id } });
    await prisma.auditLog.deleteMany({ where: { entityId: k.id } });
    await prisma.kolContent.delete({ where: { id: k.id } });
  });

  it("video dari akun yang belum ada → KOL, kolaborasi tanpa fee dan konten dibuat sekaligus", async () => {
    const a = await perangkatAdmin();
    const baru = `${handle}vid`;
    const videoId = "7301234567890888888";
    const r = await simpanManual({
      perangkat: a,
      url: `https://www.tiktok.com/@${baru}/video/${videoId}`,
      data: { jenis: "KONTEN", videoId, uniqueId: baru, views: 9, like: 1, komentar: 0, share: 0, save: 0 },
      sekarang: SEKARANG,
    });
    if (!r.ok) throw new Error(r.kode);
    kolBaruIds.push(r.cocok.kolId);
    expect(r.dibuat).toEqual({ kol: true, konten: true });
    const brief = await prisma.kolBrief.findMany({ where: { kolId: r.cocok.kolId }, select: { fee: true, jenis: true } });
    expect(brief).toHaveLength(1);
    expect(Number(brief[0].fee)).toBe(0);
    expect(brief[0].jenis).not.toBe("KOMISI");
  });

  it("pemasang perangkat tanpa creative:manage tidak bisa membuat KOL baru (TANPA_IZIN), dan tidak ada yang dibuat", async () => {
    penggunaUjiId = (await prisma.user.create({ data: { email: `${handle}@uji.invalid`, name: tag }, select: { id: true } })).id;
    const p = await perangkat("Laptop tanpa izin");
    await prisma.kolPerangkat.update({ where: { id: p.id }, data: { dibuatOlehId: penggunaUjiId } });
    const a = { ...p, dibuatOlehId: penggunaUjiId };
    const baru = `${handle}tolak`;
    expect(await simpanManual({ perangkat: a, url: `https://www.tiktok.com/@${baru}`, data: hasilProfil(1, baru), sekarang: SEKARANG })).toEqual({
      ok: false,
      kode: "TANPA_IZIN",
    });
    expect(await prisma.kolAccount.count({ where: { handle: { contains: baru } } })).toBe(0);
    // Yang SUDAH ada tetap boleh diperbarui angkanya tanpa izin itu.
    const r = await simpanManual({ perangkat: a, url: `https://www.tiktok.com/@${handle}`, data: hasilProfil(2, handle), sekarang: SEKARANG });
    expect(r.ok).toBe(true);
    await prisma.kolPerangkat.update({ where: { id: p.id }, data: { dibuatOlehId: userId } });
  });
});
