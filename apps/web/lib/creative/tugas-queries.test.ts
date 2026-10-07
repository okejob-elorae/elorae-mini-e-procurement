import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { geserHari } from "@/lib/tanggal-isian";
import { kpiKreatif, muatMasukanTugas, ukuranTerisi } from "./tugas-queries";
import { jumlahTugas, susunTugas, URUTAN_TUGAS, type KunciTugas } from "./tugas";

/*
 * Terhadap basis data sungguhan, dibatasi ke baris tes lewat `cakupan`.
 * Aturan 13 kelompoknya diuji murni di tugas.test.ts; yang diuji di sini
 * adalah BACAANNYA: setiap kelompok muncul dari fakta di tabel dan hilang
 * begitu faktanya berubah, tanggal dibaca sebagai hari WIB, dan pembanding
 * "kirim dobel" ikut terbaca walau kolaborasinya sudah selesai.
 */

const HARI_INI = "2026-10-20";
const tag = `TUGASUJI-${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let kolIds: string[] = [];
let kolabIds: string[] = [];
let agendaIds: string[] = [];
let campaignIds: string[] = [];
let urut = 0;

/** Pukul 12.00 WIB pada hari `HARI_INI + n`. */
const hari = (n: number) => new Date(`${geserHari(HARI_INI, n)}T05:00:00Z`);
const waAcak = () => `62813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function kol(isi: Partial<{ address: string | null; waNormal: string | null; sizeProfile: string | null; blockedAt: Date | null }> = {}) {
  const k = await prisma.kol.create({
    data: {
      name: `${tag} KOL ${++urut}`,
      address: "Jl. Mawar 1, Bandung",
      waNormal: waAcak(),
      sizeProfile: JSON.stringify({ atasan: "M" }),
      accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}-${urut}`, followers: 10_000 }] },
      ...isi,
    },
    select: { id: true },
  });
  kolIds.push(k.id);
  return k.id;
}

async function kolab(isi: Record<string, unknown> & { kolId?: string } = {}) {
  const kolId = isi.kolId ?? (await kol());
  const c = await prisma.kolBrief.create({
    data: { docNo: `${tag}-${++urut}`, tahap: "PROSPEK", tahapAt: hari(-1), ...isi, kolId } as never,
    select: { id: true },
  });
  kolabIds.push(c.id);
  return c.id;
}

async function baca() {
  const m = await muatMasukanTugas({ userId, hariIni: HARI_INI, cakupan: { kolaborasiIds: kolabIds, agendaIds, campaignIds } });
  const k = susunTugas(m);
  return {
    k,
    ada: (kunci: KunciTugas, id: string) => k.find((x) => x.kunci === kunci)!.baris.some((b) => b.id === id),
    baris: (kunci: KunciTugas, id: string) => k.find((x) => x.kunci === kunci)!.baris.find((b) => b.id === id),
  };
}

beforeEach(async () => {
  userId = "";
  kolIds = [];
  kolabIds = [];
  agendaIds = [];
  campaignIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.kolAgenda.deleteMany({ where: { id: { in: seededIds(agendaIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  await prisma.kolCampaign.deleteMany({ where: { id: { in: seededIds(campaignIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

describe("muatMasukanTugas → 13 kelompok", () => {
  it("agenda pribadi muncul hari H dan hilang saat selesai; agenda orang lain tidak", async () => {
    const a = await prisma.kolAgenda.create({ data: { title: `${tag} meeting`, date: hari(0), ownerId: userId }, select: { id: true } });
    agendaIds.push(a.id);
    expect((await baca()).ada("AGENDA", a.id)).toBe(true);
    await prisma.kolAgenda.update({ where: { id: a.id }, data: { doneAt: new Date() } });
    expect((await baca()).ada("AGENDA", a.id)).toBe(false);

    const lain = await prisma.user.findFirst({ where: { id: { not: userId } }, select: { id: true } });
    if (lain) {
      const b = await prisma.kolAgenda.create({ data: { title: `${tag} punya orang`, date: hari(0), ownerId: lain.id }, select: { id: true } });
      agendaIds.push(b.id);
      expect((await baca()).ada("AGENDA", b.id)).toBe(false);
    }
  });

  it("deal belum kirim → hilang begitu resi diisi", async () => {
    const id = await kolab({ tahap: "DEAL", dealAt: hari(-5) });
    expect((await baca()).ada("DEAL_BELUM_KIRIM", id)).toBe(true);
    await prisma.kolShipment.create({ data: { collabId: id, trackingNo: "JNE123", sentAt: hari(0) } });
    expect((await baca()).ada("DEAL_BELUM_KIRIM", id)).toBe(false);
  });

  it("resi nyangkut → hilang begitu tanggal terima diisi; membawa kurir dan resi", async () => {
    const id = await kolab({ tahap: "SAMPEL_DIKIRIM" });
    const p = await prisma.kolShipment.create({ data: { collabId: id, courier: "JNE", trackingNo: "R-9", sentAt: hari(-10) }, select: { id: true } });
    const r = await baca();
    expect(r.baris("RESI_NYANGKUT", id)?.info).toMatchObject({ resi: "R-9", kurir: "JNE", refId: p.id });
    await prisma.kolShipment.update({ where: { id: p.id }, data: { receivedAt: hari(0) } });
    expect((await baca()).ada("RESI_NYANGKUT", id)).toBe(false);
  });

  it("diterima belum tayang → hilang begitu ada link konten", async () => {
    const id = await kolab({ tahap: "SAMPEL_DITERIMA" });
    await prisma.kolShipment.create({ data: { collabId: id, trackingNo: "R", sentAt: hari(-12), receivedAt: hari(-8) } });
    expect((await baca()).ada("DITERIMA_BELUM_TAYANG", id)).toBe(true);
    await prisma.kolContent.create({ data: { collabId: id, platform: "TIKTOK", format: "VIDEO", link: "https://contoh.test/v", liveAt: hari(0) } });
    expect((await baca()).ada("DITERIMA_BELUM_TAYANG", id)).toBe(false);
  });

  it("draf menunggu review → hilang begitu disetujui", async () => {
    const id = await kolab({ tahap: "DRAF" });
    const k = await prisma.kolContent.create({
      data: { collabId: id, platform: "TIKTOK", format: "VIDEO", draftLink: "https://contoh.test/d", draftStatus: "MENUNGGU", draftAt: hari(-4) },
      select: { id: true },
    });
    expect((await baca()).baris("DRAF_MENUNGGU", id)?.info.draftLink).toBe("https://contoh.test/d");
    await prisma.kolContent.update({ where: { id: k.id }, data: { draftStatus: "DISETUJUI" } });
    expect((await baca()).ada("DRAF_MENUNGGU", id)).toBe(false);
  });

  it("jadwal tayang lewat → hilang begitu link konten diisi", async () => {
    const id = await kolab({ tahap: "DRAF_DISETUJUI" });
    const k = await prisma.kolContent.create({ data: { collabId: id, platform: "TIKTOK", format: "VIDEO", plannedAt: hari(-2) }, select: { id: true } });
    expect((await baca()).ada("JADWAL_TAYANG_LEWAT", id)).toBe(true);
    await prisma.kolContent.update({ where: { id: k.id }, data: { link: "https://contoh.test/v", liveAt: hari(0) } });
    expect((await baca()).ada("JADWAL_TAYANG_LEWAT", id)).toBe(false);
  });

  it("belum dibalas → hilang begitu kontak terakhir diperbarui; lama sekali = saran ghosting", async () => {
    const id = await kolab({ tahap: "DIHUBUNGI", tahapAt: hari(-6), lastContactAt: hari(-6) });
    const lama = await kolab({ tahap: "NEGO", tahapAt: hari(-30), lastContactAt: hari(-30) });
    const r = await baca();
    expect(r.baris("BELUM_DIBALAS", id)?.saranGhosting).toBe(false);
    expect(r.baris("BELUM_DIBALAS", lama)?.saranGhosting).toBe(true);
    await prisma.kolBrief.update({ where: { id }, data: { lastContactAt: hari(0) } });
    expect((await baca()).ada("BELUM_DIBALAS", id)).toBe(false);
  });

  it("tayang belum ada angka → hilang begitu angka dicatat", async () => {
    const id = await kolab({ tahap: "TAYANG" });
    const k = await prisma.kolContent.create({
      data: { collabId: id, platform: "TIKTOK", format: "VIDEO", link: "https://contoh.test/v", liveAt: hari(-4) },
      select: { id: true },
    });
    expect((await baca()).baris("ANGKA_BELUM_ADA", id)?.info.titik).toBe("ANGKA_H3");
    await prisma.kolContentMetric.create({ data: { contentId: k.id, recordedAt: hari(0), views: 1000 } });
    expect((await baca()).ada("ANGKA_BELUM_ADA", id)).toBe(false);
  });

  it("belum dibayar lewat jatuh tempo — juga sesudah SELESAI — hilang begitu lunas", async () => {
    const id = await kolab({ tahap: "SELESAI", fee: 500_000, payStatus: "BELUM" });
    await prisma.kolContent.create({ data: { collabId: id, platform: "TIKTOK", format: "VIDEO", link: "https://contoh.test/v", liveAt: hari(-20) } });
    expect((await baca()).baris("BELUM_DIBAYAR", id)?.info.fee).toBe(500_000);
    await prisma.kolBrief.update({ where: { id }, data: { payStatus: "LUNAS" } });
    expect((await baca()).ada("BELUM_DIBAYAR", id)).toBe(false);
  });

  it("dengan termin: DP yang jatuh tempo sesudah deal muncul sebelum tayang, nilainya jumlah termin — hilang begitu termin dibayar", async () => {
    const id = await kolab({ tahap: "DEAL", dealAt: hari(-10), fee: 2_000_000, payStatus: "BELUM" });
    const [dp] = await Promise.all([
      prisma.kolPaymentTerm.create({ data: { collabId: id, urutan: 1, label: "DP", neto: 1_000_000, bruto: 1_000_000, pemicu: "DEAL", hariSesudah: 3 } }),
      prisma.kolPaymentTerm.create({ data: { collabId: id, urutan: 2, label: "Pelunasan", neto: 1_000_000, bruto: 1_000_000, pemicu: "TAYANG", hariSesudah: 14 } }),
    ]);
    const b = (await baca()).baris("BELUM_DIBAYAR", id);
    expect(b?.info.fee).toBe(1_000_000);
    expect(b?.info.tanggal).toBe(geserHari(HARI_INI, -7));
    await prisma.kolPaymentTerm.update({ where: { id: dp.id }, data: { status: "DIBAYAR", dibayarAt: hari(-1) } });
    // Pelunasan belum punya jatuh tempo (belum tayang), walau payStatus kolaborasinya masih BELUM.
    expect((await baca()).ada("BELUM_DIBAYAR", id)).toBe(false);
  });

  it("kirim dobel: KOL sama di campaign sama yang sampelnya SUDAH berangkat, walau kolaborasinya selesai", async () => {
    const cp = (await prisma.kolCampaign.create({ data: { name: `${tag} cp` }, select: { id: true } })).id;
    campaignIds.push(cp);
    const kolId = await kol();
    const baru = await kolab({ kolId, tahap: "DEAL", dealAt: hari(0), campaignId: cp });
    const lama = await kolab({ kolId, tahap: "SELESAI", campaignId: cp });
    const p = await prisma.kolShipment.create({ data: { collabId: lama, trackingNo: "X1", sentAt: hari(-40) }, select: { id: true } });
    expect((await baca()).baris("KIRIM_DOBEL", baru)?.info.dobelDengan?.map((d) => d.id)).toEqual([lama]);
    await prisma.kolShipment.delete({ where: { id: p.id } });
    expect((await baca()).ada("KIRIM_DOBEL", baru)).toBe(false);
  });

  it("kirim dobel lewat nomor WA yang sama di KOL lain", async () => {
    const wa = waAcak();
    const a = await kolab({ kolId: await kol({ waNormal: wa }), tahap: "DEAL", dealAt: hari(0) });
    const b = await kolab({ kolId: await kol({ waNormal: wa }), tahap: "BATAL" });
    await prisma.kolShipment.create({ data: { collabId: b, trackingNo: "X2", sentAt: hari(-3) } });
    expect((await baca()).ada("KIRIM_DOBEL", a)).toBe(true);
  });

  it("data kirim kurang → hilang begitu alamat, HP, dan ukuran lengkap", async () => {
    const kolId = await kol({ address: null, waNormal: null, sizeProfile: JSON.stringify({ atasan: "" }) });
    const id = await kolab({ kolId, tahap: "DEAL", dealAt: hari(0) });
    expect((await baca()).baris("DATA_KIRIM_KURANG", id)?.info.kurang).toEqual(["ALAMAT", "HP", "UKURAN"]);
    await prisma.kol.update({ where: { id: kolId }, data: { address: "Jl. Melati 2", waNormal: waAcak(), sizeProfile: JSON.stringify({ atasan: "L" }) } });
    expect((await baca()).ada("DATA_KIRIM_KURANG", id)).toBe(false);
  });

  it("KOL diblokir dengan kolaborasi berjalan → hilang begitu blokir dibuka", async () => {
    const kolId = await kol({ blockedAt: hari(-1) });
    const id = await kolab({ kolId, tahap: "NEGO", lastContactAt: hari(0), tahapAt: hari(0) });
    expect((await baca()).ada("KOL_DIBLOKIR", id)).toBe(true);
    await prisma.kol.update({ where: { id: kolId }, data: { blockedAt: null } });
    expect((await baca()).ada("KOL_DIBLOKIR", id)).toBe(false);
  });

  it("budget campaign ≥ 80% → hilang begitu budget dinaikkan; terpakai = biaya kolaborasinya", async () => {
    const cp = (await prisma.kolCampaign.create({ data: { name: `${tag} budget`, budget: 100_000 }, select: { id: true } })).id;
    campaignIds.push(cp);
    await kolab({ tahap: "DEAL", dealAt: hari(0), campaignId: cp, fee: 80_000, boostCost: 5_000 });
    const r = await baca();
    const b = r.k.find((x) => x.kunci === "BUDGET_CAMPAIGN")!.baris.find((x) => x.id === cp);
    expect(b?.info).toMatchObject({ persen: 85, lewatBudget: false, sisa: 15_000 });
    await prisma.kolCampaign.update({ where: { id: cp }, data: { budget: 1_000_000 } });
    expect((await baca()).k.find((x) => x.kunci === "BUDGET_CAMPAIGN")!.baris.some((x) => x.id === cp)).toBe(false);
  });

  it("jumlah setiap kelompok = banyak barisnya, dan total = jumlah semua kelompok", async () => {
    await kolab({ tahap: "DEAL", dealAt: hari(-5) });
    await kolab({ tahap: "DIHUBUNGI", tahapAt: hari(-6), lastContactAt: hari(-6) });
    const { k } = await baca();
    expect(k.map((x) => x.kunci)).toEqual(URUTAN_TUGAS);
    for (const x of k) expect(x.jumlah).toBe(x.baris.length);
    expect(jumlahTugas(k)).toBe(k.reduce((s, x) => s + x.baris.length, 0));
    expect(jumlahTugas(k)).toBeGreaterThanOrEqual(2);
  });
});

describe("ukuranTerisi", () => {
  it("JSON dengan satu nilai terisi = terisi", () => {
    expect(ukuranTerisi(JSON.stringify({ atasan: "M", bawahan: "" }))).toBe(true);
    expect(ukuranTerisi(JSON.stringify({ atasan: "", tinggiCm: null }))).toBe(false);
    expect(ukuranTerisi(JSON.stringify({ tinggiCm: 160 }))).toBe(true);
    expect(ukuranTerisi("")).toBe(false);
    expect(ukuranTerisi(null)).toBe(false);
  });
});

describe("kpiKreatif", () => {
  it("angka mengikuti periode; berjalan dan posisi adalah keadaan sekarang", async () => {
    const kolA = await kol();
    const dalam = await kolab({ kolId: kolA, tahap: "TAYANG", dealAt: hari(-2), fee: 300_000 });
    const luar = await kolab({ tahap: "NEGO", dealAt: hari(-60), fee: 900_000 });
    await prisma.kolSale.create({ data: { collabId: dalam, date: hari(-1), orders: 4, gmv: 600_000 } });
    const konten = await prisma.kolContent.create({
      data: { collabId: dalam, platform: "TIKTOK", format: "VIDEO", link: "https://contoh.test/v", liveAt: hari(-1) },
      select: { id: true },
    });
    await prisma.kolContentMetric.create({ data: { contentId: konten.id, recordedAt: hari(0), views: 12_000 } });

    const k = await kpiKreatif({
      periode: { dari: geserHari(HARI_INI, -6), sampai: HARI_INI },
      cakupan: { kolaborasiIds: [dalam, luar], kolIds },
    });
    expect(k.angka.gmv).toBe(600_000);
    expect(k.angka.orders).toBe(4);
    expect(k.angka.angka.views).toBe(12_000);
    expect(k.angka.biaya.fee).toBe(300_000);
    expect(k.angka.roas).toBe(2);
    expect(k.berjalan).toBe(2);
    expect(k.posisi.find((p) => p.tahap === "NEGO")?.jumlah).toBe(1);
    expect(k.posisi.find((p) => p.tahap === "TAYANG")?.jumlah).toBe(1);
    expect(k.kolTotal).toBe(kolIds.length);
    expect(seededId(kolA)).toBe(kolA);
  });
});
