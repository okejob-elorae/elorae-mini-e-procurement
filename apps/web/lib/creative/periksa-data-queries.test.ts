import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { URUTAN_PERIKSA, type GrupPeriksa, type JenisPeriksa } from "./periksa-data";
import { periksaDataKreatif } from "./periksa-data-queries";

/*
 * Periksa data terhadap basis data sungguhan. Baris yatim dibuat dengan id
 * induk yang tidak ada (`relationMode = "prisma"` tidak memasang foreign key).
 * Setiap pemeriksaan dicakup ke id fixture (`cakupan`), jadi data lain di basis
 * data bersama tidak memengaruhi hasilnya. Konten fixture ber-platform LAINNYA
 * tanpa link: antrean pemantau tidak pernah menjadikannya tugas.
 */

const tag = `UJIPERIKSA${Math.random().toString(36).slice(2, 7)}`;
const hilang = (s: string) => `${tag.toLowerCase()}hilang${s}`;
const HARI = 86_400_000;

const id = {
  kolA: "",
  kolB: "",
  akunB: "",
  akunYatim: "",
  campaign: "",
  briefTanpaKol: "",
  briefTanpaCampaign: "",
  briefTerbalik: "",
  briefKontenDepan: "",
  briefAngka: "",
  kontenDepan: "",
  kontenAngka: "",
  kontenYatim: "",
  angkaYatim: "",
  kirimYatim: "",
  terminYatim: "",
  brandYatim: "",
};

function semuaId(): string[] {
  return Object.values(id).filter(Boolean);
}

beforeEach(async () => {
  for (const k of Object.keys(id) as (keyof typeof id)[]) id[k] = "";
  const wa = `62812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  id.kolA = (await prisma.kol.create({ data: { name: `${tag} A`, waNormal: wa }, select: { id: true } })).id;
  id.kolB = (await prisma.kol.create({ data: { name: `${tag} B`, waNormal: wa }, select: { id: true } })).id;
  id.akunB = (await prisma.kolAccount.create({ data: { kolId: id.kolB, platform: "LAINNYA", handle: `${tag.toLowerCase()}b` }, select: { id: true } })).id;
  id.akunYatim = (await prisma.kolAccount.create({ data: { kolId: hilang("kol"), platform: "LAINNYA", handle: `${tag.toLowerCase()}yatim` }, select: { id: true } })).id;

  const sekarang = Date.now();
  id.campaign = (
    await prisma.kolCampaign.create({
      data: { name: `${tag} campaign`, startDate: new Date(sekarang), endDate: new Date(sekarang - 5 * HARI) },
      select: { id: true },
    })
  ).id;

  const brief = async (n: string, data: Record<string, unknown> = {}) =>
    (await prisma.kolBrief.create({ data: { docNo: `${tag}-${n}`, kolId: id.kolB, ...data }, select: { id: true } })).id;
  id.briefTanpaKol = await brief("1", { kolId: hilang("kol2") });
  id.briefTanpaCampaign = await brief("2", { campaignId: hilang("campaign") });
  id.briefTerbalik = await brief("3", { startDate: new Date(sekarang), dueDate: new Date(sekarang - 2 * HARI), tahap: "TAYANG" });
  id.briefKontenDepan = await brief("4", { tahap: "DRAF" });
  id.briefAngka = await brief("5", { tahap: "DRAF" });

  id.kontenDepan = (
    await prisma.kolContent.create({
      data: { collabId: id.briefKontenDepan, platform: "LAINNYA", format: "VIDEO", liveAt: new Date(sekarang + 3 * HARI) },
      select: { id: true },
    })
  ).id;
  id.kontenAngka = (await prisma.kolContent.create({ data: { collabId: id.briefAngka, platform: "LAINNYA", format: "VIDEO" }, select: { id: true } })).id;
  await prisma.kolContentMetric.createMany({
    data: [
      { contentId: id.kontenAngka, recordedAt: new Date("2026-10-01T01:00:00Z"), views: 100, likes: 150 },
      { contentId: id.kontenAngka, recordedAt: new Date("2026-10-02T01:00:00Z"), views: 80, likes: 10 },
    ],
  });
  id.kontenYatim = (await prisma.kolContent.create({ data: { collabId: hilang("brief"), platform: "LAINNYA", format: "VIDEO" }, select: { id: true } })).id;
  id.angkaYatim = (
    await prisma.kolContentMetric.create({ data: { contentId: hilang("konten"), recordedAt: new Date("2026-10-03T01:00:00Z"), views: 7 }, select: { id: true } })
  ).id;
  id.kirimYatim = (await prisma.kolShipment.create({ data: { collabId: hilang("brief2"), courier: "JNE", trackingNo: `${tag}RESI` }, select: { id: true } })).id;
  id.terminYatim = (await prisma.kolPaymentTerm.create({ data: { collabId: hilang("brief3"), label: `${tag} termin` }, select: { id: true } })).id;
  id.brandYatim = (
    await prisma.kolBrandCollab.create({
      data: { kunci: `${tag}:brand`, kolId: hilang("kol3"), platform: "TIKTOK", brandHandle: "contoh.brand", jenis: "TAG", sumber: "MANUAL" },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  await prisma.kolContentMetric.deleteMany({ where: { contentId: { in: [seededId(id.kontenAngka), hilang("konten")] } } });
  await prisma.kolContent.deleteMany({ where: { id: { in: [seededId(id.kontenDepan), seededId(id.kontenAngka), seededId(id.kontenYatim)] } } });
  await prisma.kolShipment.deleteMany({ where: { id: seededId(id.kirimYatim) } });
  await prisma.kolPaymentTerm.deleteMany({ where: { id: seededId(id.terminYatim) } });
  await prisma.kolBrandCollab.deleteMany({ where: { id: seededId(id.brandYatim) } });
  await prisma.kolBrief.deleteMany({
    where: { id: { in: [id.briefTanpaKol, id.briefTanpaCampaign, id.briefTerbalik, id.briefKontenDepan, id.briefAngka].map((x) => seededId(x)) } },
  });
  await prisma.kolCampaign.deleteMany({ where: { id: seededId(id.campaign) } });
  await prisma.kolAccount.deleteMany({ where: { id: { in: [seededId(id.akunB), seededId(id.akunYatim)] } } });
  await prisma.kol.deleteMany({ where: { id: { in: [seededId(id.kolA), seededId(id.kolB)] } } });
});

const grup = (g: GrupPeriksa[], j: JenisPeriksa) => g.find((x) => x.jenis === j)!;

describe("periksaDataKreatif (dicakup ke fixture)", () => {
  it("menemukan setiap jenis masalah dan menautkan ke halaman yang aman dibuka", async () => {
    const h = await periksaDataKreatif({ cakupan: { ids: semuaId() } });
    expect(h.grup.map((g) => g.jenis)).toEqual(URUTAN_PERIKSA);

    const kembar = grup(h.grup, "KOL_KEMBAR");
    expect(kembar.jumlah).toBe(1);
    expect(kembar.baris[0].rincian).toMatchObject({ macam: "KEMBAR", sebab: ["WA"], anggota: [{ id: id.kolA }, { id: id.kolB }] });

    const tanpaAkun = grup(h.grup, "KOL_TANPA_AKUN");
    expect(tanpaAkun.baris.map((b) => b.id)).toEqual([id.kolA]);
    expect(tanpaAkun.baris[0].tautan).toBe(`/backoffice/kreatif/kol/${id.kolA}`);

    const akunYatim = grup(h.grup, "AKUN_TANPA_KOL");
    expect(akunYatim.jumlah).toBe(1);
    expect(akunYatim.baris[0]).toMatchObject({ id: id.akunYatim, tautan: null, rincian: { macam: "YATIM", indukId: hilang("kol") } });

    const tanpaKol = grup(h.grup, "KOLABORASI_TANPA_KOL");
    expect(tanpaKol.baris.map((b) => [b.id, b.tautan])).toEqual([[id.briefTanpaKol, null]]);

    const tanpaCampaign = grup(h.grup, "KOLABORASI_TANPA_CAMPAIGN");
    expect(tanpaCampaign.baris.map((b) => [b.id, b.tautan])).toEqual([[id.briefTanpaCampaign, `/backoffice/kreatif/kolaborasi/${id.briefTanpaCampaign}`]]);

    expect(grup(h.grup, "KONTEN_TANPA_KOLABORASI").baris.map((b) => b.id)).toEqual([id.kontenYatim]);
    const angkaYatim = grup(h.grup, "ANGKA_TANPA_KONTEN");
    expect(angkaYatim.baris[0]).toMatchObject({ id: id.angkaYatim, judul: "7 views", rincian: { macam: "YATIM", waktu: "2026-10-03T01:00:00.000Z" } });
    expect(grup(h.grup, "PENGIRIMAN_TANPA_KOLABORASI").baris[0]).toMatchObject({ id: id.kirimYatim, judul: `JNE · ${tag}RESI` });
    expect(grup(h.grup, "TERMIN_TANPA_KOLABORASI").baris[0]).toMatchObject({ id: id.terminYatim, judul: `${tag} termin` });
    expect(grup(h.grup, "BRAND_TANPA_KOL").baris[0]).toMatchObject({ id: id.brandYatim, judul: "@contoh.brand · TIKTOK" });

    const campaign = grup(h.grup, "CAMPAIGN_TANGGAL_TERBALIK");
    expect(campaign.baris[0]).toMatchObject({ id: id.campaign, tautan: `/backoffice/kreatif/campaign/${id.campaign}`, rincian: { macam: "TANGGAL" } });

    const terbalik = grup(h.grup, "KOLABORASI_TANGGAL_TERBALIK");
    expect(terbalik.baris[0]).toMatchObject({ id: id.briefTerbalik, judul: `${tag}-3 · ${tag} B`, tautan: `/backoffice/kreatif/kolaborasi/${id.briefTerbalik}` });

    const depan = grup(h.grup, "KONTEN_TAYANG_MASA_DEPAN");
    expect(depan.baris.map((b) => b.id)).toEqual([id.kontenDepan]);
    expect(depan.baris[0].tautan).toBe(`/backoffice/kreatif/kolaborasi/${id.briefKontenDepan}?tab=konten`);

    const like = grup(h.grup, "LIKE_LEBIH_DARI_VIEWS");
    expect(like.baris[0]).toMatchObject({ id: id.kontenAngka, rincian: { macam: "LIKE_VIEWS", likes: 150, views: 100, kali: 1 } });
    const turun = grup(h.grup, "VIEWS_TURUN");
    expect(turun.baris[0]).toMatchObject({ id: id.kontenAngka, rincian: { macam: "VIEWS_TURUN", sebelum: 100, sesudah: 80, kali: 1 } });

    const tayang = grup(h.grup, "TAYANG_TANPA_KONTEN");
    expect(tayang.baris.map((b) => b.id)).toEqual([id.briefTerbalik]);
    expect(tayang.baris[0].rincian).toEqual({ macam: "TAHAP", tahap: "TAYANG" });

    // Setiap kelompok tepat satu temuan (kembar: satu kelompok).
    expect(h.total).toBe(16);
  });

  it("kolaborasi DRAF tanpa konten bukan temuan; konten tayang hari ini bukan masa depan", async () => {
    await prisma.kolContent.update({ where: { id: id.kontenDepan }, data: { liveAt: new Date() } });
    const h = await periksaDataKreatif({ cakupan: { ids: [id.briefKontenDepan, id.kontenDepan] } });
    expect(h.total).toBe(0);
  });

  it("cakupan kosong = tidak ada temuan; tanpa cakupan seluruh basis data terbaca tanpa galat", async () => {
    expect((await periksaDataKreatif({ cakupan: { ids: [] } })).total).toBe(0);
    const semua = await periksaDataKreatif();
    expect(semua.grup).toHaveLength(URUTAN_PERIKSA.length);
    for (const g of semua.grup) expect(g.baris.length).toBeLessThanOrEqual(50);
    expect(grup(semua.grup, "AKUN_TANPA_KOL").jumlah).toBeGreaterThanOrEqual(1);
  });
});
