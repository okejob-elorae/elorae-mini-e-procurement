import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { angkaKolaborasi, jumlahAngkaKolaborasi } from "./angka-queries";
import { SARING_KOL_BAWAAN, type SaringKol } from "./kol-saring";
import { catatanDanRiwayat, daftarKolHalaman, kelompokKembarKol, pratinjauTempelan, profilKol } from "./kol-queries";
import { uraiTempelan } from "./kol-aturan";
import { AMBANG_TIER_BAWAAN } from "./tier";
import { blokirKol, buatCatatanKol, simpanProfilKol, type IsiKol } from "./kol-writer";

/*
 * Kueri database KOL terhadap basis data sungguhan (Postgres lokal).
 *
 * Setiap pencarian dipersempit dengan `tag` supaya hanya baris tes ini yang
 * terhitung — daftar KOL dibaca seluruhnya oleh kuerinya, dan baris milik
 * orang lain di basis data yang sama tidak boleh mengubah hasilnya.
 */

const tag = `v1q${Math.random().toString(36).slice(2, 8)}`;
let userId = "";
let kolIds: string[] = [];
let briefIds: string[] = [];
let catatanIds: string[] = [];
let A = "";
let B = "";
let C = "";
let briefAselesai = "";
let briefAdeal = "";
let briefB = "";

const h = (s: string) => `${tag}${s}`;

async function kol(isi: Partial<IsiKol> & Pick<IsiKol, "akun">) {
  const r = await simpanProfilKol({ isi: { name: "", ...isi }, olehUserId: userId, periksaKembar: false });
  if (!r.ok) throw new Error(`seed KOL: ${r.alasan}`);
  kolIds.push(r.id);
  return r.id;
}

async function brief(kolId: string, n: number, data: { tahap: "SELESAI" | "DEAL" | "TAYANG"; fee?: number; plannedLiveAt?: Date; createdAt?: Date }) {
  const b = await prisma.kolBrief.create({
    data: { docNo: `TEST/${tag}/${n}`, kolId, tahap: data.tahap, fee: data.fee ?? 0, plannedLiveAt: data.plannedLiveAt ?? null, createdAt: data.createdAt },
    select: { id: true },
  });
  briefIds.push(b.id);
  return b.id;
}

beforeEach(async () => {
  userId = "";
  kolIds = [];
  briefIds = [];
  catatanIds = [];
  A = "";
  B = "";
  C = "";
  briefAselesai = "";
  briefAdeal = "";
  briefB = "";
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;

  A = await kol({
    name: `${tag} Ani`,
    niche: "hijab",
    city: "Bandung",
    phone: "0812-5550-0001",
    label: "favorit",
    engagementRate: 4.5,
    akun: [
      { platform: "INSTAGRAM", handle: h("ani"), followers: 50_000 },
      { platform: "TIKTOK", handle: h("anitt"), followers: 5_000 },
    ],
  });
  B = await kol({ name: `${tag} Budi`, label: "hati-hati", akun: [{ platform: "TIKTOK", handle: h("budi"), followers: 200_000 }] });
  C = await kol({ name: `${tag} Citra`, akun: [{ platform: "YOUTUBE", handle: h("citra"), followers: 2_000 }] });
  await blokirKol({ kolId: B, alasan: "uji", olehUserId: userId });

  briefAselesai = await brief(A, 1, { tahap: "SELESAI", fee: 500_000, createdAt: new Date("2026-09-01T03:00:00Z") });
  briefAdeal = await brief(A, 2, { tahap: "DEAL", fee: 750_000, plannedLiveAt: new Date("2026-10-05T00:00:00+07:00"), createdAt: new Date("2026-10-01T03:00:00Z") });
  briefB = await brief(B, 3, { tahap: "TAYANG" });

  await prisma.kolSale.create({ data: { collabId: briefAselesai, date: new Date("2026-09-10T03:00:00Z"), orders: 2, gmv: 250_000 } });
  await prisma.kolSale.create({ data: { collabId: briefB, date: new Date("2026-10-02T03:00:00Z"), orders: 3, gmv: 1_000_000 } });
  const kontenB = await prisma.kolContent.create({
    data: { collabId: briefB, platform: "TIKTOK", format: "VIDEO", link: "https://t/1", liveAt: new Date("2026-10-01T03:00:00Z") },
  });
  await prisma.kolContentMetric.create({ data: { contentId: kontenB.id, views: 10_000, likes: 500 } });
  await prisma.kolContent.create({
    data: { collabId: briefAdeal, platform: "INSTAGRAM", format: "REELS", link: "https://i/1", liveAt: new Date("2026-10-04T05:00:00Z") },
  });
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...kolIds, ...briefIds, ...catatanIds]) } } });
  await prisma.kolNote.deleteMany({ where: { kolId: { in: seededIds(kolIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(briefIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

const saring = (s: Partial<SaringKol>): SaringKol => ({ ...SARING_KOL_BAWAAN, cari: tag, ...s });
const ids = async (s: Partial<SaringKol>) => (await daftarKolHalaman(saring(s), { ambangTier: AMBANG_TIER_BAWAAN })).baris.map((b) => b.id);

describe("daftarKolHalaman — cari & saring", () => {
  it("mencari nama, handle, kota, dan nomor WA dalam bentuk apa pun", async () => {
    expect((await daftarKolHalaman(saring({}))).total).toBe(3);
    expect(await ids({ cari: `@${h("budi")}` })).toEqual([B]);
    expect(await ids({ cari: `https://www.tiktok.com/@${h("anitt")}` })).toEqual([A]);
    expect(await ids({ cari: "+62 812-5550-0001" })).toEqual([A]);
  });

  it("menyaring platform, tier, label, belum ada kolaborasi, diblokir, dan tahap TERAKHIR", async () => {
    expect((await ids({ platform: "TIKTOK" })).sort()).toEqual([A, B].sort());
    // B 200 rb = "mid" menurut bawaan (100 rb–500 rb); makro baru mulai 500 rb.
    expect(await ids({ tier: "mid" })).toEqual([B]);
    expect(await ids({ tier: "makro" })).toEqual([]);
    expect(await ids({ tier: "mikro" })).toEqual([A]);
    // Ambang dari setelan menggeser tingkatnya: dengan makro mulai 150 rb, B menjadi makro.
    const ambang = { mikro: 10_000, mid: 60_000, makro: 150_000, mega: 1_000_000 };
    expect((await daftarKolHalaman(saring({ tier: "makro" }), { ambangTier: ambang })).baris.map((b) => b.id)).toEqual([B]);
    expect((await daftarKolHalaman(saring({ tier: "mikro" }), { ambangTier: ambang })).baris.map((b) => b.id)).toEqual([A]);
    expect(await ids({ label: "FAVORIT" })).toEqual([A]);
    expect(await ids({ label: "fav" })).toEqual([]);
    expect(await ids({ status: "BELUM" })).toEqual([C]);
    expect(await ids({ status: "DIBLOKIR" })).toEqual([B]);
    // Kolaborasi terakhir A adalah DEAL; yang SELESAI lebih lama.
    expect(await ids({ status: "DEAL" })).toEqual([A]);
    expect(await ids({ status: "SELESAI" })).toEqual([]);
  });
});

describe("daftarKolHalaman — urut & halaman", () => {
  it("mengurut nama, pengikut, ER (kosong di belakang), dan GMV", async () => {
    expect(await ids({ urut: "nama" })).toEqual([A, B, C]);
    expect(await ids({ urut: "pengikut" })).toEqual([B, A, C]);
    expect((await ids({ urut: "er" }))[0]).toBe(A);
    expect(await ids({ urut: "gmv" })).toEqual([B, A, C]);
  });

  it("memotong per halaman, membawa total, dan menjepit halaman yang kelewat", async () => {
    const h2 = await daftarKolHalaman(saring({ urut: "nama", ukuran: 2, halaman: 2 }));
    expect(h2).toMatchObject({ total: 3, halaman: 2, ukuran: 2 });
    expect(h2.baris.map((b) => b.id)).toEqual([C]);
    const jauh = await daftarKolHalaman(saring({ urut: "nama", ukuran: 2, halaman: 99 }));
    expect(jauh.halaman).toBe(2);
  });

  it("GMV dan views per KOL = jumlah angkaKolaborasi atas kolaborasinya", async () => {
    const baris = (await daftarKolHalaman(saring({ urut: "nama" }))).baris;
    const angka = await angkaKolaborasi([briefAselesai, briefAdeal, briefB]);
    const ani = jumlahAngkaKolaborasi([angka.get(briefAselesai)!, angka.get(briefAdeal)!]);
    expect(baris[0]).toMatchObject({ id: A, gmv: ani.gmv, views: ani.angka.views, jumlahKolaborasi: 2, tahapTerakhir: "DEAL" });
    expect(ani.gmv).toBe(250_000);
    expect(baris[1]).toMatchObject({ id: B, gmv: 1_000_000, views: 10_000, diblokir: true, alasanBlokir: "uji" });
    expect(baris[2]).toMatchObject({ id: C, gmv: 0, jumlahKolaborasi: 0, tahapTerakhir: null });
    expect(baris[0].akunUtama).toMatchObject({ platform: "INSTAGRAM", followers: 50_000 });
  });
});

describe("profilKol", () => {
  it("ringkasan kolaborasi, GMV, fee terakhir, dan persen tepat waktu", async () => {
    const p = await profilKol(A, { ambangTier: AMBANG_TIER_BAWAAN });
    expect(p).not.toBeNull();
    expect(p!.tier).toBe("mikro");
    // Ambang dari setelan diteruskan ke tier profil: 50 rb jadi "mid" bila mid mulai 40 rb.
    expect((await profilKol(A, { ambangTier: { mikro: 10_000, mid: 40_000, makro: 500_000, mega: 1_000_000 } }))!.tier).toBe("mid");
    expect(p!.ringkas).toMatchObject({ total: 2, selesai: 1, berjalan: 1, ghosting: 0, gmv: 250_000, feeTerakhir: 750_000 });
    expect(p!.ringkas.tepatWaktu).toEqual({ tepat: 1, dinilai: 1, persen: 100 });
    expect(p!.kolaborasi.map((k) => k.id)).toEqual([briefAdeal, briefAselesai]);
    expect(p!.akun[0].riwayat.map((r) => r.followers)).toEqual([50_000]);
    expect(p!.form).toMatchObject({ name: `${tag} Ani`, label: "favorit", city: "Bandung" });
    expect(p!.form.rateFormat).toEqual({});
    expect(p!.konten).toHaveLength(1);
    expect(await profilKol("tidak-ada")).toBeNull();
  });
});

describe("kembar & tempelan", () => {
  it("Cek kembar mengelompokkan nomor WA yang sama", async () => {
    const D = await kol({ name: `${tag} Dobel`, phone: "+6281255500001", akun: [{ platform: "TIKTOK", handle: h("dobel"), followers: 0 }] });
    const { kelompok } = await kelompokKembarKol();
    const g = kelompok.find((x) => x.anggota.some((a) => a.id === A));
    expect(g).toBeDefined();
    expect(g!.anggota.map((a) => a.id).sort()).toEqual([A, D].sort());
    expect(g!).toMatchObject({ sebab: ["WA"], nomorSama: "6281255500001" });
  });

  it("pratinjau tempelan menandai KOL yang sudah ada dan akun sama di platformnya", async () => {
    const baris = uraiTempelan([`@${h("anitt")}, Ani, 6k`, `${h("ani")}, Ani IG`, `${h("barusekali")}, Baru`].join("\n"));
    const p = await pratinjauTempelan(baris, "TIKTOK");
    expect(p[0].kembar).toEqual([{ id: A, nama: `${tag} Ani`, sebab: ["HANDLE"], diblokir: false, akunSama: { handle: h("anitt"), followers: 5_000 } }]);
    expect(p[1].kembar[0]).toMatchObject({ id: A, akunSama: null });
    expect(p[2].kembar).toEqual([]);
  });
});

describe("catatanDanRiwayat", () => {
  it("menggabung catatan manual dan riwayat otomatis, terbaru dulu", async () => {
    const c = await buatCatatanKol({ kolId: A, isi: "Balas besok", olehUserId: userId });
    if (!c.ok) throw new Error(c.alasan);
    catatanIds.push(c.id);
    const n = await buatCatatanKol({ kolaborasiId: briefAdeal, isi: "Brief dikirim lewat WA", olehUserId: userId });
    if (!n.ok) throw new Error(n.alasan);
    catatanIds.push(n.id);

    const kolSaja = await catatanDanRiwayat({ kolId: A });
    expect(kolSaja.filter((i) => i.jenis === "MANUAL").map((i) => (i.jenis === "MANUAL" ? i.isi : ""))).toEqual([
      "Brief dikirim lewat WA",
      "Balas besok",
    ]);
    expect(kolSaja.some((i) => i.jenis === "OTOMATIS" && i.aksi === "KOL_CREATED")).toBe(true);
    // Jejak catatan ditulis di KolNote — tidak menggandakan catatannya di linimasa.
    expect(kolSaja.some((i) => i.jenis === "OTOMATIS" && i.aksi === "KOL_NOTE_CREATED")).toBe(false);

    const kolab = await catatanDanRiwayat({ kolaborasiId: briefAdeal });
    expect(kolab.map((i) => (i.jenis === "MANUAL" ? i.isi : i.aksi))).toEqual(["Brief dikirim lewat WA"]);
    expect(kolab[0]).toMatchObject({ docNo: `TEST/${tag}/2` });

    const blok = await catatanDanRiwayat({ kolId: B });
    expect(blok.find((i) => i.jenis === "OTOMATIS" && i.aksi === "KOL_BLOCKED")).toMatchObject({ alasan: "uji" });
  });
});
