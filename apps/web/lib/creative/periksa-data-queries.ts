import { prisma, Prisma, sqlId } from "@elorae/db";
import { parseDateOnly } from "@/lib/date-only";
import { geserHari, hariIniWib } from "@/lib/tanggal-isian";
import {
  anomaliAngka,
  BATAS_BARIS_PERIKSA,
  grupPeriksa,
  kelompokKembarPeriksa,
  TAHAP_SUDAH_TAYANG,
  tautanCampaign,
  tautanKol,
  tautanKolaborasi,
  totalTemuan,
  URUTAN_PERIKSA,
  type BacaanAngka,
  type BarisPeriksa,
  type GrupPeriksa,
  type HasilPeriksa,
  type JenisPeriksa,
} from "./periksa-data";
import type { Tahap } from "./tahap";

/*
 * Periksa data Ruang KOL — pembaca, KHUSUS SERVER (klien hanya `import type`).
 *
 * Setiap pemeriksaan = satu hitungan (angka sebenarnya) + paling banyak
 * `BATAS_BARIS_PERIKSA` baris. SQL-nya satu salinan untuk MariaDB dan
 * PostgreSQL (`sqlId`); perbandingan antarkolom (tanggal terbalik, like >
 * views) dan "induk tidak ada" (`NOT EXISTS`) ditulis di SQL karena Prisma
 * tidak bisa menyatakannya tanpa membaca seluruh tabel.
 *
 * Kolaborasi TIDAK PERNAH dibaca dengan `include: { kol }`: relasinya wajib,
 * dan kolaborasi yang KOL-nya sudah tidak ada membuat Prisma melempar
 * "Inconsistent query result" — padahal justru baris itu yang dicari halaman ini.
 * Nama KOL dibaca terpisah lewat id (`infoKolaborasi`).
 *
 * `cakupan.ids` (id baris yang diperiksa; untuk angka janggal = id konten)
 * hanya untuk tes yang berbagi basis data.
 */

const I = sqlId;
const N = BATAS_BARIS_PERIKSA;

export type CakupanPeriksa = { ids?: readonly string[] };

function saringId(kolom: Prisma.Sql, c?: CakupanPeriksa): Prisma.Sql {
  if (!c?.ids) return Prisma.empty;
  if (!c.ids.length) return Prisma.sql` AND 1 = 0`;
  return Prisma.sql` AND ${kolom} IN (${Prisma.join([...c.ids])})`;
}

const angka = (x: unknown): number => (x === null || x === undefined ? 0 : Number(x));
const iso = (x: Date | string | null | undefined): string | null => (x === null || x === undefined ? null : new Date(x).toISOString());

async function hitung(dariWhere: Prisma.Sql): Promise<number> {
  const [r] = await prisma.$queryRaw<{ n: unknown }[]>(Prisma.sql`SELECT COUNT(*) AS ${I("n")} ${dariWhere}`);
  return angka(r?.n);
}

/* ─────────────────────────── yatim ─────────────────────────── */

type Yatim = {
  jenis: JenisPeriksa;
  anak: string;
  fk: string;
  induk: string;
  kolom: string[];
  judul: (r: Record<string, unknown>) => string;
};

const teks = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const YATIM: Yatim[] = [
  { jenis: "AKUN_TANPA_KOL", anak: "KolAccount", fk: "kolId", induk: "Kol", kolom: ["handle", "platform"], judul: (r) => `@${teks(r.handle)} · ${teks(r.platform)}` },
  { jenis: "KOLABORASI_TANPA_KOL", anak: "KolBrief", fk: "kolId", induk: "Kol", kolom: ["docNo"], judul: (r) => teks(r.docNo) },
  { jenis: "KOLABORASI_TANPA_CAMPAIGN", anak: "KolBrief", fk: "campaignId", induk: "KolCampaign", kolom: ["docNo", "kolId"], judul: (r) => teks(r.docNo) },
  { jenis: "KONTEN_TANPA_KOLABORASI", anak: "KolContent", fk: "collabId", induk: "KolBrief", kolom: ["platform", "link"], judul: (r) => teks(r.link) || teks(r.platform) },
  { jenis: "ANGKA_TANPA_KONTEN", anak: "KolContentMetric", fk: "contentId", induk: "KolContent", kolom: ["recordedAt", "views"], judul: (r) => `${angka(r.views)} views` },
  { jenis: "PENGIRIMAN_TANPA_KOLABORASI", anak: "KolShipment", fk: "collabId", induk: "KolBrief", kolom: ["courier", "trackingNo"], judul: (r) => [teks(r.courier), teks(r.trackingNo)].filter(Boolean).join(" · ") },
  { jenis: "TERMIN_TANPA_KOLABORASI", anak: "KolPaymentTerm", fk: "collabId", induk: "KolBrief", kolom: ["label"], judul: (r) => teks(r.label) },
  { jenis: "BRAND_TANPA_KOL", anak: "KolBrandCollab", fk: "kolId", induk: "Kol", kolom: ["brandHandle", "platform"], judul: (r) => `@${teks(r.brandHandle)} · ${teks(r.platform)}` },
];

async function periksaYatim(y: Yatim, c?: CakupanPeriksa): Promise<{ jumlah: number; baris: (BarisPeriksa & { mentah: Record<string, unknown> })[] }> {
  const dari = Prisma.sql`FROM ${I(y.anak)} c
    WHERE c.${I(y.fk)} IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${I(y.induk)} p WHERE p.${I("id")} = c.${I(y.fk)})${saringId(Prisma.sql`c.${I("id")}`, c)}`;
  const kolom = Prisma.join(
    y.kolom.map((k) => Prisma.sql`c.${I(k)} AS ${I(k)}`),
    ", ",
  );
  const [jumlah, mentah] = await Promise.all([
    hitung(dari),
    prisma.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`SELECT c.${I("id")} AS ${I("id")}, c.${I(y.fk)} AS ${I("indukId")}, ${kolom} ${dari} ORDER BY c.${I("id")} LIMIT ${N}`,
    ),
  ]);
  return {
    jumlah,
    baris: mentah.map((r) => ({
      id: teks(r.id),
      judul: y.judul(r) || teks(r.id),
      sub: null,
      tautan: null,
      rincian: { macam: "YATIM" as const, indukId: teks(r.indukId), waktu: y.kolom.includes("recordedAt") ? iso(r.recordedAt as Date | string | null) : null },
      mentah: r,
    })),
  };
}

/* ───────────────────── nama kolaborasi tanpa include ───────────────────── */

type InfoKolaborasi = { docNo: string; kolNama: string | null; kolAda: boolean };

/** docNo + nama KOL per kolaborasi, dibaca terpisah supaya KOL yang hilang tidak membuat Prisma melempar. */
async function infoKolaborasi(ids: readonly string[]): Promise<Map<string, InfoKolaborasi>> {
  const unik = [...new Set(ids)];
  if (!unik.length) return new Map();
  const kolab = await prisma.kolBrief.findMany({ where: { id: { in: unik } }, select: { id: true, docNo: true, kolId: true } });
  const kol = await prisma.kol.findMany({ where: { id: { in: [...new Set(kolab.map((k) => k.kolId))] } }, select: { id: true, name: true } });
  const namaKol = new Map(kol.map((k) => [k.id, k.name]));
  return new Map(kolab.map((k) => [k.id, { docNo: k.docNo, kolNama: namaKol.get(k.kolId) ?? null, kolAda: namaKol.has(k.kolId) }]));
}

/** Tautan ke kolaborasi hanya bila kolaborasi dan KOL-nya ada (halaman rincian butuh KOL-nya). */
function tautanAman(info: InfoKolaborasi | undefined, id: string, tab?: string): string | null {
  return info?.kolAda ? tautanKolaborasi(id, tab) : null;
}

const judulKolaborasi = (info: InfoKolaborasi | undefined, cadangan: string) => (info ? (info.kolNama ? `${info.docNo} · ${info.kolNama}` : info.docNo) : cadangan);

/* ───────────────────────────── pemeriksaan ───────────────────────────── */

async function periksaKembar(c?: CakupanPeriksa): Promise<GrupPeriksa> {
  const kol = await prisma.kol.findMany({
    where: { isActive: true, ...(c?.ids ? { id: { in: [...c.ids] } } : {}) },
    select: { id: true, name: true, waNormal: true, accounts: { select: { handle: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const baris = kelompokKembarPeriksa(kol.map((k) => ({ id: k.id, nama: k.name, waNormal: k.waNormal, handles: k.accounts.map((a) => a.handle) })));
  return grupPeriksa("KOL_KEMBAR", baris.length, baris);
}

async function periksaCampaignTerbalik(c?: CakupanPeriksa): Promise<GrupPeriksa> {
  const dari = Prisma.sql`FROM ${I("KolCampaign")} c
    WHERE c.${I("startDate")} IS NOT NULL AND c.${I("endDate")} IS NOT NULL AND c.${I("endDate")} < c.${I("startDate")}${saringId(Prisma.sql`c.${I("id")}`, c)}`;
  const [jumlah, mentah] = await Promise.all([
    hitung(dari),
    prisma.$queryRaw<{ id: string; name: string; startDate: Date | string; endDate: Date | string }[]>(
      Prisma.sql`SELECT c.${I("id")} AS ${I("id")}, c.${I("name")} AS ${I("name")}, c.${I("startDate")} AS ${I("startDate")}, c.${I("endDate")} AS ${I("endDate")}
        ${dari} ORDER BY c.${I("startDate")} DESC, c.${I("id")} LIMIT ${N}`,
    ),
  ]);
  return grupPeriksa(
    "CAMPAIGN_TANGGAL_TERBALIK",
    jumlah,
    mentah.map((r) => ({
      id: r.id,
      judul: r.name,
      sub: null,
      tautan: tautanCampaign(r.id),
      rincian: { macam: "TANGGAL", mulai: iso(r.startDate)!, selesai: iso(r.endDate)! },
    })),
  );
}

async function periksaKolaborasiTerbalik(c?: CakupanPeriksa): Promise<GrupPeriksa> {
  const dari = Prisma.sql`FROM ${I("KolBrief")} c
    WHERE c.${I("startDate")} IS NOT NULL AND c.${I("dueDate")} IS NOT NULL AND c.${I("dueDate")} < c.${I("startDate")}${saringId(Prisma.sql`c.${I("id")}`, c)}`;
  const [jumlah, mentah] = await Promise.all([
    hitung(dari),
    prisma.$queryRaw<{ id: string; startDate: Date | string; dueDate: Date | string }[]>(
      Prisma.sql`SELECT c.${I("id")} AS ${I("id")}, c.${I("startDate")} AS ${I("startDate")}, c.${I("dueDate")} AS ${I("dueDate")}
        ${dari} ORDER BY c.${I("startDate")} DESC, c.${I("id")} LIMIT ${N}`,
    ),
  ]);
  const info = await infoKolaborasi(mentah.map((r) => r.id));
  return grupPeriksa(
    "KOLABORASI_TANGGAL_TERBALIK",
    jumlah,
    mentah.map((r) => ({
      id: r.id,
      judul: judulKolaborasi(info.get(r.id), r.id),
      sub: null,
      tautan: tautanAman(info.get(r.id), r.id),
      rincian: { macam: "TANGGAL", mulai: iso(r.startDate)!, selesai: iso(r.dueDate)! },
    })),
  );
}

async function periksaTayangDepan(hariIni: string, c?: CakupanPeriksa): Promise<GrupPeriksa> {
  const besok = parseDateOnly(geserHari(hariIni, 1))!;
  const dari = Prisma.sql`FROM ${I("KolContent")} c
    WHERE c.${I("liveAt")} IS NOT NULL AND c.${I("liveAt")} >= ${besok}${saringId(Prisma.sql`c.${I("id")}`, c)}`;
  const [jumlah, mentah] = await Promise.all([
    hitung(dari),
    prisma.$queryRaw<{ id: string; collabId: string; liveAt: Date | string; link: string | null }[]>(
      Prisma.sql`SELECT c.${I("id")} AS ${I("id")}, c.${I("collabId")} AS ${I("collabId")}, c.${I("liveAt")} AS ${I("liveAt")}, c.${I("link")} AS ${I("link")}
        ${dari} ORDER BY c.${I("liveAt")} DESC, c.${I("id")} LIMIT ${N}`,
    ),
  ]);
  const info = await infoKolaborasi(mentah.map((r) => r.collabId));
  return grupPeriksa(
    "KONTEN_TAYANG_MASA_DEPAN",
    jumlah,
    mentah.map((r) => ({
      id: r.id,
      judul: judulKolaborasi(info.get(r.collabId), r.collabId),
      sub: r.link,
      tautan: tautanAman(info.get(r.collabId), r.collabId, "konten"),
      rincian: { macam: "TAYANG", tayang: iso(r.liveAt)! },
    })),
  );
}

/** Konten dengan angka janggal: id + jumlah sebenarnya; rinciannya dihitung `anomaliAngka`. */
async function kontenJanggal(syaratBacaan: Prisma.Sql, c?: CakupanPeriksa): Promise<{ jumlah: number; ids: string[] }> {
  const dari = Prisma.sql`FROM ${I("KolContentMetric")} m WHERE ${syaratBacaan}${saringId(Prisma.sql`m.${I("contentId")}`, c)}`;
  const [r] = await prisma.$queryRaw<{ n: unknown }[]>(Prisma.sql`SELECT COUNT(DISTINCT m.${I("contentId")}) AS ${I("n")} ${dari}`);
  const ids = await prisma.$queryRaw<{ contentId: string }[]>(
    Prisma.sql`SELECT m.${I("contentId")} AS ${I("contentId")} ${dari}
      GROUP BY m.${I("contentId")} ORDER BY MAX(m.${I("recordedAt")}) DESC, m.${I("contentId")} LIMIT ${N}`,
  );
  return { jumlah: angka(r?.n), ids: ids.map((x) => x.contentId) };
}

async function periksaAngka(c?: CakupanPeriksa): Promise<[GrupPeriksa, GrupPeriksa]> {
  const [like, turun] = await Promise.all([
    kontenJanggal(Prisma.sql`m.${I("views")} > 0 AND m.${I("likes")} > m.${I("views")}`, c),
    kontenJanggal(
      Prisma.sql`EXISTS (SELECT 1 FROM ${I("KolContentMetric")} e
        WHERE e.${I("contentId")} = m.${I("contentId")} AND e.${I("recordedAt")} < m.${I("recordedAt")} AND e.${I("views")} > m.${I("views")})`,
      c,
    ),
  ]);
  const semua = [...new Set([...like.ids, ...turun.ids])];
  const [bacaan, konten] = semua.length
    ? await Promise.all([
        prisma.kolContentMetric.findMany({ where: { contentId: { in: semua } }, select: { id: true, contentId: true, recordedAt: true, views: true, likes: true } }),
        prisma.kolContent.findMany({ where: { id: { in: semua } }, select: { id: true, collabId: true, link: true } }),
      ])
    : [[], []];
  const perKonten = new Map<string, BacaanAngka[]>();
  for (const b of bacaan) perKonten.set(b.contentId, [...(perKonten.get(b.contentId) ?? []), b]);
  const kontenPer = new Map(konten.map((k) => [k.id, k]));
  const info = await infoKolaborasi(konten.map((k) => k.collabId));

  const dasar = (id: string): Pick<BarisPeriksa, "id" | "judul" | "sub" | "tautan"> => {
    const k = kontenPer.get(id);
    const i = k ? info.get(k.collabId) : undefined;
    return { id, judul: k ? judulKolaborasi(i, k.collabId) : id, sub: k?.link ?? null, tautan: k ? tautanAman(i, k.collabId, "konten") : null };
  };

  const barisLike: BarisPeriksa[] = [];
  for (const id of like.ids) {
    const a = anomaliAngka(perKonten.get(id) ?? []).likeLebih;
    if (a) barisLike.push({ ...dasar(id), rincian: { macam: "LIKE_VIEWS", ...a } });
  }
  const barisTurun: BarisPeriksa[] = [];
  for (const id of turun.ids) {
    const a = anomaliAngka(perKonten.get(id) ?? []).turun;
    if (a) barisTurun.push({ ...dasar(id), rincian: { macam: "VIEWS_TURUN", ...a } });
  }
  return [grupPeriksa("LIKE_LEBIH_DARI_VIEWS", like.jumlah, barisLike), grupPeriksa("VIEWS_TURUN", turun.jumlah, barisTurun)];
}

async function periksaKolTanpaAkun(c?: CakupanPeriksa): Promise<GrupPeriksa> {
  const where = { isActive: true, accounts: { none: {} }, ...(c?.ids ? { id: { in: [...c.ids] } } : {}) };
  const [jumlah, kol] = await Promise.all([
    prisma.kol.count({ where }),
    prisma.kol.findMany({ where, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: N }),
  ]);
  return grupPeriksa(
    "KOL_TANPA_AKUN",
    jumlah,
    kol.map((k) => ({ id: k.id, judul: k.name, sub: null, tautan: tautanKol(k.id), rincian: { macam: "KOSONG" } })),
  );
}

async function periksaTayangTanpaKonten(c?: CakupanPeriksa): Promise<GrupPeriksa> {
  const where = { tahap: { in: [...TAHAP_SUDAH_TAYANG] as Tahap[] }, kolContents: { none: {} }, ...(c?.ids ? { id: { in: [...c.ids] } } : {}) };
  const [jumlah, kolab] = await Promise.all([
    prisma.kolBrief.count({ where }),
    prisma.kolBrief.findMany({ where, select: { id: true, tahap: true }, orderBy: [{ tahapAt: "desc" }, { id: "asc" }], take: N }),
  ]);
  const info = await infoKolaborasi(kolab.map((k) => k.id));
  return grupPeriksa(
    "TAYANG_TANPA_KONTEN",
    jumlah,
    kolab.map((k) => ({
      id: k.id,
      judul: judulKolaborasi(info.get(k.id), k.id),
      sub: null,
      tautan: tautanAman(info.get(k.id), k.id, "konten"),
      rincian: { macam: "TAHAP", tahap: k.tahap as Tahap },
    })),
  );
}

async function periksaSemuaYatim(c?: CakupanPeriksa): Promise<GrupPeriksa[]> {
  const hasil = await Promise.all(YATIM.map((y) => periksaYatim(y, c)));
  // Kolaborasi yang campaign-nya hilang masih punya halaman — bila KOL-nya ada.
  const iCampaign = YATIM.findIndex((y) => y.jenis === "KOLABORASI_TANPA_CAMPAIGN");
  const kolIds = [...new Set(hasil[iCampaign].baris.map((b) => teks(b.mentah.kolId)).filter(Boolean))];
  const kolAda = new Set(kolIds.length ? (await prisma.kol.findMany({ where: { id: { in: kolIds } }, select: { id: true } })).map((k) => k.id) : []);
  return YATIM.map((y, i) =>
    grupPeriksa(
      y.jenis,
      hasil[i].jumlah,
      hasil[i].baris.map(({ mentah, ...b }) =>
        i === iCampaign && kolAda.has(teks(mentah.kolId)) ? { ...b, tautan: tautanKolaborasi(b.id) } : b,
      ),
    ),
  );
}

/** Semua pemeriksaan, dalam urutan `URUTAN_PERIKSA` — termasuk yang nol, supaya terlihat apa saja yang sudah diperiksa. */
export async function periksaDataKreatif(opsi: { sekarang?: Date; cakupan?: CakupanPeriksa } = {}): Promise<HasilPeriksa> {
  const sekarang = opsi.sekarang ?? new Date();
  const c = opsi.cakupan;
  const [kembar, yatim, campaign, kolaborasi, tayang, [like, turun], tanpaAkun, tanpaKonten] = await Promise.all([
    periksaKembar(c),
    periksaSemuaYatim(c),
    periksaCampaignTerbalik(c),
    periksaKolaborasiTerbalik(c),
    periksaTayangDepan(hariIniWib(sekarang), c),
    periksaAngka(c),
    periksaKolTanpaAkun(c),
    periksaTayangTanpaKonten(c),
  ]);
  const per = new Map<JenisPeriksa, GrupPeriksa>(
    [kembar, ...yatim, campaign, kolaborasi, tayang, like, turun, tanpaAkun, tanpaKonten].map((g) => [g.jenis, g]),
  );
  const grup = URUTAN_PERIKSA.map((j) => per.get(j) ?? grupPeriksa(j, 0, []));
  return { grup, total: totalTemuan(grup), diperiksaPada: sekarang.toISOString() };
}
