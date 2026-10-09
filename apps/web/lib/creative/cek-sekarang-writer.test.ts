import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { PRIORITAS_PANTAU } from "./pantau-antrean";
import { MAKS_CEK_SEKARANG, keadaanPemantau, mintaCekSekarang } from "./cek-sekarang-writer";
import { PANTAU_BAWAAN } from "./pantau-aturan";

/*
 * "Cek sekarang" di Performa video terhadap basis data sungguhan. Data di 2003; teardown lewat
 * `seededIds()`.
 */

const tag = `ujiceksekarang${Math.random().toString(36).slice(2, 7)}`;
const SEKARANG = new Date("2003-05-05T03:00:00Z");

let kolId = "";
let briefId = "";
const k: Record<"selesai" | "antre" | "dipinjam" | "ig" | "tanpaLink", string> = { selesai: "", antre: "", dipinjam: "", ig: "", tanpaLink: "" };
let tugasIds: string[] = [];
const perangkatIds: string[] = [];

const tugasKonten = (contentId: string) =>
  prisma.kolTugasPantau.findMany({ where: { contentId }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, prioritas: true, jatuhAt: true, kunci: true, url: true } });

beforeAll(async () => {
  tugasIds = [];
  kolId = (await prisma.kol.create({ data: { name: `${tag}` }, select: { id: true } })).id;
  briefId = (await prisma.kolBrief.create({ data: { docNo: `${tag}/1`, kolId, tahap: "TAYANG" }, select: { id: true } })).id;
  const konten = async (link: string | null, platform: "TIKTOK" | "INSTAGRAM" = "TIKTOK") =>
    (await prisma.kolContent.create({ data: { collabId: briefId, platform, format: "VIDEO", link, liveAt: SEKARANG }, select: { id: true } })).id;
  k.selesai = await konten(`https://www.tiktok.com/@${tag}/video/7301234567890123411?is_from_webapp=1`);
  k.antre = await konten(`https://www.tiktok.com/@${tag}/video/7301234567890123412`);
  k.dipinjam = await konten(`https://www.tiktok.com/@${tag}/video/7301234567890123413`);
  k.ig = await konten(`https://www.instagram.com/reel/${tag}`, "INSTAGRAM");
  k.tanpaLink = await konten(null);
  const tugas = (contentId: string, status: string, prioritas: number, jatuhAt: Date) =>
    prisma.kolTugasPantau.create({
      data: { kunci: `${tag}:${contentId}:${status}`, jenis: "KONTEN", platform: "TIKTOK", contentId, url: "x", status, prioritas, jatuhAt },
      select: { id: true },
    });
  tugasIds.push((await tugas(k.selesai, "SELESAI", 95, new Date("2003-05-01T00:00:00Z"))).id);
  tugasIds.push((await tugas(k.antre, "ANTRE", 70, new Date("2003-05-20T00:00:00Z"))).id);
  tugasIds.push((await tugas(k.dipinjam, "DIPINJAM", 80, new Date("2003-05-04T00:00:00Z"))).id);
});

afterAll(async () => {
  await prisma.kolPerangkat.deleteMany({ where: { id: { in: seededIds(perangkatIds) } } });
  await prisma.kolTugasPantau.deleteMany({ where: { contentId: { in: seededIds(Object.values(k).filter(Boolean)) } } });
  await prisma.kolTugasPantau.deleteMany({ where: { id: { in: seededIds(tugasIds) } } });
  await prisma.kolContent.deleteMany({ where: { id: { in: seededIds(Object.values(k).filter(Boolean)) } } });
  await prisma.kolBrief.delete({ where: { id: briefId } });
  await prisma.kol.delete({ where: { id: kolId } });
});

describe("mintaCekSekarang", () => {
  it("video yang sudah selesai dicek mendapat tugas baru berprioritas tertinggi, jatuh tempo sekarang, alamat baku", async () => {
    const r = await mintaCekSekarang({ kontenIds: [k.selesai], sekarang: SEKARANG, perangkatIds: [] });
    expect(r).toEqual({ ok: true, diantrekan: 1, sudahAntre: 0, dilewati: 0, perangkatDilanjutkan: 0 });
    const t = await tugasKonten(k.selesai);
    expect(t).toHaveLength(2);
    const baru = t.find((x) => x.status === "ANTRE")!;
    expect(baru).toMatchObject({ prioritas: PRIORITAS_PANTAU.KONTEN_SEGERA, jatuhAt: SEKARANG });
    expect(baru.kunci).toBe(`KONTEN:${k.selesai}:M${SEKARANG.getTime()}`);
    expect(baru.url).toBe(`https://www.tiktok.com/@${tag}/video/7301234567890123411`);
  });

  it("satu video paling banyak satu tugas terbuka: yang masih antre dinaikkan dan dimajukan, yang sedang dicek dibiarkan", async () => {
    const r = await mintaCekSekarang({ kontenIds: [k.antre, k.dipinjam], sekarang: SEKARANG, perangkatIds: [] });
    expect(r).toEqual({ ok: true, diantrekan: 0, sudahAntre: 2, dilewati: 0, perangkatDilanjutkan: 0 });
    const [antre] = await tugasKonten(k.antre);
    expect(antre).toMatchObject({ status: "ANTRE", prioritas: PRIORITAS_PANTAU.KONTEN_SEGERA, jatuhAt: SEKARANG });
    const dipinjam = await tugasKonten(k.dipinjam);
    expect(dipinjam).toHaveLength(1);
    expect(dipinjam[0]).toMatchObject({ status: "DIPINJAM", prioritas: 80 });
  });

  it("bukan video TikTok, tanpa link, atau tidak ada → dilewati; permintaan kembar dihitung sekali", async () => {
    const r = await mintaCekSekarang({ kontenIds: [k.ig, k.tanpaLink, "tidak-ada", k.ig], sekarang: SEKARANG, perangkatIds: [] });
    expect(r).toEqual({ ok: true, diantrekan: 0, sudahAntre: 0, dilewati: 3, perangkatDilanjutkan: 0 });
    expect(await tugasKonten(k.ig)).toHaveLength(0);
  });

  // Di PostgreSQL READ COMMITTED balapan ini jarang benar-benar menghasilkan tugas kembar, jadi tes
  // ini terutama membuktikan penulisnya tahan benturan: delapan klik serentak, tidak ada yang gagal,
  // tepat satu tugas baru.
  it("delapan klik serentak: semuanya berhasil, tepat satu tugas baru", async () => {
    const lagi = new Date(SEKARANG.getTime() + 1000);
    // Waktu berbeda 1 ms → kunci berbeda: hanya transaksi serializable yang mencegah tugas kembar.
    await prisma.kolTugasPantau.updateMany({ where: { contentId: k.selesai, status: "ANTRE" }, data: { status: "SELESAI" } });
    const hasil = await Promise.all(
      Array.from({ length: 8 }, (_, i) => mintaCekSekarang({ kontenIds: [k.selesai], sekarang: new Date(lagi.getTime() + i), perangkatIds: [] })),
    );
    expect(hasil.every((r) => r.ok)).toBe(true);
    expect(hasil.reduce((s, r) => s + (r.ok ? r.diantrekan : 0), 0)).toBe(1);
    const terbuka = (await tugasKonten(k.selesai)).filter((t) => t.status === "ANTRE");
    expect(terbuka).toHaveLength(1);
  });

  it("kosong atau terlalu banyak → ditolak", async () => {
    expect(await mintaCekSekarang({ kontenIds: [], sekarang: SEKARANG, perangkatIds: [] })).toEqual({ ok: false, kode: "KOSONG" });
    const banyak = Array.from({ length: MAKS_CEK_SEKARANG + 1 }, (_, i) => `x${i}`);
    expect(await mintaCekSekarang({ kontenIds: banyak, sekarang: SEKARANG, perangkatIds: [] })).toEqual({ ok: false, kode: "TERLALU_BANYAK" });
  });
});

describe("keadaanPemantau", () => {
  const menit = (n: number) => new Date(SEKARANG.getTime() + n * 60_000);
  async function perangkat(isi: { lapor: Date | null; jedaSampai?: Date | null; alasan?: string }) {
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
    const p = await prisma.kolPerangkat.create({
      data: {
        nama: `${tag} perangkat`,
        dibuatOlehId: user.id,
        tokenHash: `${tag}${Math.random()}`,
        tersambungAt: menit(-60),
        terakhirLaporAt: isi.lapor,
        dijedaSampai: isi.jedaSampai ?? null,
        alasanJeda: isi.jedaSampai ? (isi.alasan ?? "GAGAL_BERUNTUN") : null,
      },
      select: { id: true },
    });
    perangkatIds.push(p.id);
    return p.id;
  }
  const keadaan = (ids: string[], lain: { sekarang?: Date; aktif?: boolean } = {}) =>
    keadaanPemantau({ sekarang: lain.sekarang ?? SEKARANG, pengaturan: { ...PANTAU_BAWAAN, aktif: lain.aktif ?? true }, perangkatIds: ids });

  it("tidak ada perangkat yang melapor 10 menit terakhir → TANPA_PERANGKAT", async () => {
    const lama = await perangkat({ lapor: menit(-11) });
    expect(await keadaan([lama])).toEqual({ keadaan: "TANPA_PERANGKAT" });
  });

  it("perangkat hidup tapi semuanya dijeda → DIJEDA dengan alasan dan waktu jeda paling cepat berakhir", async () => {
    const a = await perangkat({ lapor: menit(-1), jedaSampai: menit(40), alasan: "CAPTCHA" });
    const b = await perangkat({ lapor: menit(-2), jedaSampai: menit(25), alasan: "MANUAL" });
    expect(await keadaan([a, b])).toEqual({ keadaan: "DIJEDA", sampai: menit(25).toISOString(), alasan: "MANUAL" });
  });

  it("ada satu perangkat hidup tanpa jeda → SIAP, juga di luar jam kerja (permintaan langsung tidak menunggu jam kerja)", async () => {
    const a = await perangkat({ lapor: menit(-1), jedaSampai: menit(40) });
    const b = await perangkat({ lapor: menit(-3) });
    expect(await keadaan([a, b])).toEqual({ keadaan: "SIAP" });
    // 2003-05-05 20.00 WIB, perangkat melapor semenit sebelumnya.
    const malam = await perangkat({ lapor: new Date("2003-05-05T12:59:00Z") });
    expect(await keadaan([malam], { sekarang: new Date("2003-05-05T13:00:00Z") })).toEqual({ keadaan: "SIAP" });
  });

  it("Cek sekarang melepas jeda karena gagal beruntun, tidak melapor, atau diblokir TikTok; captcha, login, dan jeda manual tetap", async () => {
    const gagal = await perangkat({ lapor: menit(-1), jedaSampai: menit(40), alasan: "GAGAL_BERUNTUN" });
    const diam = await perangkat({ lapor: menit(-1), jedaSampai: menit(40), alasan: "TIDAK_LAPOR" });
    const blokir = await perangkat({ lapor: menit(-1), jedaSampai: menit(40), alasan: "DIBLOKIR_TIKTOK" });
    const captcha = await perangkat({ lapor: menit(-1), jedaSampai: menit(40), alasan: "CAPTCHA" });
    const manual = await perangkat({ lapor: menit(-1), jedaSampai: menit(40), alasan: "MANUAL" });
    const r = await mintaCekSekarang({ kontenIds: [k.antre], sekarang: SEKARANG, perangkatIds: [gagal, diam, blokir, captcha, manual] });
    expect(r).toMatchObject({ ok: true, perangkatDilanjutkan: 3 });
    const baris = await prisma.kolPerangkat.findMany({ where: { id: { in: [gagal, diam, blokir, captcha, manual] } }, select: { id: true, dijedaSampai: true } });
    const jeda = Object.fromEntries(baris.map((b) => [b.id, b.dijedaSampai]));
    expect(jeda[gagal]).toBeNull();
    expect(jeda[diam]).toBeNull();
    expect(jeda[blokir]).toBeNull();
    expect(jeda[captcha]).toEqual(menit(40));
    expect(jeda[manual]).toEqual(menit(40));
    const log = await prisma.kolLogPantau.findMany({ where: { perangkatId: { in: [gagal, diam, blokir] }, jenis: "LANJUT" }, select: { kode: true } });
    expect(log.map((l) => l.kode)).toEqual(["CEK_SEKARANG", "CEK_SEKARANG", "CEK_SEKARANG"]);
    await prisma.kolLogPantau.deleteMany({ where: { perangkatId: { in: seededIds([gagal, diam, blokir]) } } });
  });

  it("tanpa video yang benar-benar diantrekan, jeda tidak dilepas", async () => {
    const gagal = await perangkat({ lapor: menit(-1), jedaSampai: menit(40), alasan: "GAGAL_BERUNTUN" });
    const r = await mintaCekSekarang({ kontenIds: [k.ig], sekarang: SEKARANG, perangkatIds: [gagal] });
    expect(r).toMatchObject({ ok: true, dilewati: 1, perangkatDilanjutkan: 0 });
    expect((await prisma.kolPerangkat.findUniqueOrThrow({ where: { id: gagal } })).dijedaSampai).toEqual(menit(40));
  });

  it("pemantauan otomatis dimatikan → NONAKTIF", async () => {
    const a = await perangkat({ lapor: menit(-1) });
    expect(await keadaan([a], { aktif: false })).toEqual({ keadaan: "NONAKTIF" });
  });
});
