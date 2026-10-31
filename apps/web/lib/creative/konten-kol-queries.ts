import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { hariIniWib } from "@/lib/tanggal-isian";
import { AMBANG_BAWAAN, type AmbangKreatif } from "./ambang";
import { engagementRate, type AngkaKonten } from "./angka-konten";
import {
  batasBulan,
  drafTerlambat,
  peringatanAngka,
  PER_HALAMAN_KONTEN_KOL,
  type ButirJadwal,
  type ChipDaftarKontenKol,
  type PeringatanAngka,
} from "./konten-kol";
import { TAHAP_BERJALAN, type StatusDraf, type Tahap } from "./tahap";
import { umurHari } from "./tenggat";

/*
 * Kueri Konten KOL (2026-10-07) — layar `/backoffice/kreatif/konten-kol` dan
 * panel Konten di rincian kolaborasi.
 *
 * Empat antrean, saling lepas (satu konten/kolaborasi hanya di satu chip):
 *   - menunggu  : kolaborasi SAMPEL_DITERIMA, atau DEAL/BRIEF_DIKIRIM yang
 *                 tidak memakai sampel (tanpa pengiriman dan tanpa rencana
 *                 barang), yang belum punya konten tayang maupun draf.
 *   - draf      : konten dengan draf MENUNGGU/REVISI, belum tayang, pada
 *                 kolaborasi yang masih berjalan.
 *   - disetujui : konten dengan draf DISETUJUI yang belum tayang — perbaikan
 *                 bug KOL Manager §6.3 (draf disetujui hilang dari kedua tab).
 *   - tayang    : konten yang punya link tayang.
 * Angka chip (`hitungKontenKol`) memakai `where` yang SAMA dengan daftarnya,
 * jadi angka dan isi daftar tidak bisa berbeda (dites).
 */

export type FilterKontenKol = { cari?: string | null; campaignId?: string | null; kolaborasiId?: string | null };

const ADA_LINK: Prisma.KolContentWhereInput = { AND: [{ link: { not: null } }, { NOT: { link: "" } }] };
const TANPA_LINK: Prisma.KolContentWhereInput = { OR: [{ link: null }, { link: "" }] };
const BERJALAN = { in: [...TAHAP_BERJALAN] as Tahap[] };

function saringKolaborasi(f: FilterKontenKol): Prisma.KolBriefWhereInput {
  const syarat: Prisma.KolBriefWhereInput[] = [];
  if (f.campaignId) syarat.push({ campaignId: f.campaignId });
  if (f.kolaborasiId) syarat.push({ id: f.kolaborasiId });
  const q = (f.cari ?? "").trim().replace(/^@/, "");
  if (q) {
    syarat.push({
      OR: [
        { docNo: cariTeks(q) },
        { kol: { name: cariTeks(q) } },
        { kol: { accounts: { some: { handle: cariTeks(q) } } } },
        { campaign: { name: cariTeks(q) } },
      ],
    });
  }
  return syarat.length ? { AND: syarat } : {};
}

export function whereMenunggu(f: FilterKontenKol): Prisma.KolBriefWhereInput {
  return {
    AND: [
      saringKolaborasi(f),
      {
        OR: [
          { tahap: "SAMPEL_DITERIMA" },
          { tahap: { in: ["DEAL", "BRIEF_DIKIRIM"] }, shipments: { none: {} }, items: { none: {} } },
        ],
      },
      { kolContents: { none: { OR: [ADA_LINK, { draftStatus: { not: null } }] } } },
    ],
  };
}

export function whereKonten(chip: Exclude<ChipDaftarKontenKol, "menunggu">, f: FilterKontenKol): Prisma.KolContentWhereInput {
  const kolab = saringKolaborasi(f);
  if (chip === "tayang") return { AND: [ADA_LINK, { collab: kolab }] };
  return {
    AND: [
      TANPA_LINK,
      { draftStatus: chip === "draf" ? { in: ["MENUNGGU", "REVISI"] } : "DISETUJUI" },
      { collab: { AND: [kolab, { tahap: BERJALAN }] } },
    ],
  };
}

export async function hitungKontenKol(f: FilterKontenKol = {}): Promise<Record<ChipDaftarKontenKol, number>> {
  const [menunggu, draf, disetujui, tayang] = await Promise.all([
    prisma.kolBrief.count({ where: whereMenunggu(f) }),
    prisma.kolContent.count({ where: whereKonten("draf", f) }),
    prisma.kolContent.count({ where: whereKonten("disetujui", f) }),
    prisma.kolContent.count({ where: whereKonten("tayang", f) }),
  ]);
  return { menunggu, draf, disetujui, tayang };
}

/* ──────────────────────────── Baris ──────────────────────────── */

export type DasarBaris = {
  kolaborasiId: string;
  docNo: string;
  tahap: Tahap;
  kolId: string;
  kolNama: string;
  /** Akun dengan pengikut terbanyak, tanpa "@". */
  handle: string | null;
  campaignNama: string | null;
};

export type BarisMenunggu = DasarBaris & {
  /** Hari WIB jam hitungnya mulai: terima terakhir, atau deal/tahap bila tanpa sampel. */
  sejak: string;
  umurHari: number;
  merah: boolean;
  tanpaSampel: boolean;
  /** Konten tanpa link dan tanpa draf yang akan diisi link yang ditempel (bila ada). */
  kontenKosongId: string | null;
  rencanaTayang: string | null;
};

export type BarisDraf = DasarBaris & {
  kontenId: string;
  platform: string;
  format: string;
  draftLink: string | null;
  draftStatus: StatusDraf;
  draftNote: string | null;
  drafHari: string | null;
  menungguHari: number;
  merah: boolean;
  rencanaTayang: string | null;
};

export type BarisDisetujui = DasarBaris & {
  kontenId: string;
  platform: string;
  format: string;
  draftLink: string | null;
  disetujuiHari: string | null;
  penyetuju: string | null;
  /** Rencana tayang konten (bisa diubah di baris). */
  rencanaKonten: string | null;
  /** Rencana tayang kolaborasi — cadangan tampilan bila konten belum punya. */
  rencanaKolaborasi: string | null;
};

export type AngkaTerakhir = AngkaKonten & { hari: string; recordedAt: string };

export type BarisTayang = DasarBaris & {
  kontenId: string;
  platform: string;
  format: string;
  link: string;
  tayangHari: string | null;
  angkaTerakhir: AngkaTerakhir | null;
  jumlahAngka: number;
  er: number | null;
  peringatan: PeringatanAngka;
};

export type HasilDaftarKontenKol = { total: number; halaman: number; perHalaman: number } & (
  | { chip: "menunggu"; baris: BarisMenunggu[] }
  | { chip: "draf"; baris: BarisDraf[] }
  | { chip: "disetujui"; baris: BarisDisetujui[] }
  | { chip: "tayang"; baris: BarisTayang[] }
);

const PILIH_KOLAB = {
  id: true,
  docNo: true,
  tahap: true,
  tahapAt: true,
  dealAt: true,
  plannedLiveAt: true,
  kolId: true,
  kol: { select: { name: true, accounts: { select: { platform: true, handle: true, followers: true }, orderBy: { followers: "desc" as const } } } },
  campaign: { select: { name: true } },
} satisfies Prisma.KolBriefSelect;

type KolabTerpilih = Prisma.KolBriefGetPayload<{ select: typeof PILIH_KOLAB }>;

const hariWib = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);

function dasar(c: KolabTerpilih): DasarBaris {
  return {
    kolaborasiId: c.id,
    docNo: c.docNo,
    tahap: c.tahap as Tahap,
    kolId: c.kolId,
    kolNama: c.kol.name,
    handle: c.kol.accounts[0]?.handle?.replace(/^@/, "") ?? null,
    campaignNama: c.campaign?.name ?? null,
  };
}

function pengikutUntuk(c: KolabTerpilih, platform: string): number {
  const sama = c.kol.accounts.filter((a) => a.platform === platform);
  return (sama[0] ?? c.kol.accounts[0])?.followers ?? 0;
}

function halamanSah(h: number | undefined, total: number, per: number): number {
  const maks = Math.max(1, Math.ceil(total / per));
  return Math.min(Math.max(1, Math.trunc(h ?? 1) || 1), maks);
}

export async function daftarKontenKol(
  chip: ChipDaftarKontenKol,
  f: FilterKontenKol = {},
  opsi: { halaman?: number; perHalaman?: number; hariIni?: string; ambang?: AmbangKreatif } = {},
): Promise<HasilDaftarKontenKol> {
  const per = Math.min(Math.max(1, opsi.perHalaman ?? PER_HALAMAN_KONTEN_KOL), 200);
  const hariIni = opsi.hariIni ?? hariIniWib();
  const ambang = opsi.ambang ?? AMBANG_BAWAAN;

  if (chip === "menunggu") {
    const rows = await prisma.kolBrief.findMany({
      where: whereMenunggu(f),
      select: {
        ...PILIH_KOLAB,
        shipments: { select: { receivedAt: true } },
        kolContents: {
          where: { AND: [TANPA_LINK, { draftStatus: null }] },
          select: { id: true, plannedAt: true },
          orderBy: [{ plannedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          take: 1,
        },
      },
    });
    const semua = rows
      .map((c): BarisMenunggu => {
        const terima = c.shipments.reduce<string | null>((m, s) => {
          const h = hariWib(s.receivedAt);
          return h && (!m || h > m) ? h : m;
        }, null);
        const tanpaSampel = c.tahap !== "SAMPEL_DITERIMA" && c.shipments.length === 0;
        const sejak = terima ?? hariWib(tanpaSampel ? (c.dealAt ?? c.tahapAt) : c.tahapAt)!;
        const umur = umurHari(sejak, hariIni);
        return {
          ...dasar(c),
          sejak,
          umurHari: umur,
          merah: umur > ambang.terimaKeTayangHari,
          tanpaSampel,
          kontenKosongId: c.kolContents[0]?.id ?? null,
          rencanaTayang: hariWib(c.kolContents[0]?.plannedAt) ?? hariWib(c.plannedLiveAt),
        };
      })
      .sort((a, b) => a.sejak.localeCompare(b.sejak) || a.docNo.localeCompare(b.docNo));
    const halaman = halamanSah(opsi.halaman, semua.length, per);
    return { chip, total: semua.length, halaman, perHalaman: per, baris: semua.slice((halaman - 1) * per, halaman * per) };
  }

  if (chip === "draf" || chip === "disetujui") {
    const rows = await prisma.kolContent.findMany({
      where: whereKonten(chip, f),
      select: {
        id: true,
        platform: true,
        format: true,
        draftLink: true,
        draftStatus: true,
        draftNote: true,
        draftAt: true,
        createdAt: true,
        plannedAt: true,
        approvedAt: true,
        approvedBy: { select: { name: true } },
        collab: { select: PILIH_KOLAB },
      },
    });
    if (chip === "draf") {
      const semua = rows
        .map((k): BarisDraf => {
          const drafHari = hariWib(k.draftAt ?? k.createdAt);
          const menunggu = drafHari ? Math.max(0, umurHari(drafHari, hariIni)) : 0;
          const status = k.draftStatus as StatusDraf;
          return {
            ...dasar(k.collab),
            kontenId: k.id,
            platform: String(k.platform),
            format: String(k.format),
            draftLink: k.draftLink,
            draftStatus: status,
            draftNote: k.draftNote,
            drafHari,
            menungguHari: menunggu,
            merah: drafTerlambat(status, menunggu, ambang),
            rencanaTayang: hariWib(k.plannedAt) ?? hariWib(k.collab.plannedLiveAt),
          };
        })
        // Giliran kita (MENUNGGU) di atas, yang terlama dulu.
        .sort((a, b) => (a.draftStatus === b.draftStatus ? (a.drafHari ?? "").localeCompare(b.drafHari ?? "") : a.draftStatus === "MENUNGGU" ? -1 : 1));
      const halaman = halamanSah(opsi.halaman, semua.length, per);
      return { chip, total: semua.length, halaman, perHalaman: per, baris: semua.slice((halaman - 1) * per, halaman * per) };
    }
    const semua = rows
      .map(
        (k): BarisDisetujui => ({
          ...dasar(k.collab),
          kontenId: k.id,
          platform: String(k.platform),
          format: String(k.format),
          draftLink: k.draftLink,
          disetujuiHari: hariWib(k.approvedAt),
          penyetuju: k.approvedBy?.name ?? null,
          rencanaKonten: hariWib(k.plannedAt),
          rencanaKolaborasi: hariWib(k.collab.plannedLiveAt),
        }),
      )
      .sort((a, b) => {
        const ra = a.rencanaKonten ?? a.rencanaKolaborasi ?? "9999";
        const rb = b.rencanaKonten ?? b.rencanaKolaborasi ?? "9999";
        return ra.localeCompare(rb) || (a.disetujuiHari ?? "").localeCompare(b.disetujuiHari ?? "");
      });
    const halaman = halamanSah(opsi.halaman, semua.length, per);
    return { chip, total: semua.length, halaman, perHalaman: per, baris: semua.slice((halaman - 1) * per, halaman * per) };
  }

  const where = whereKonten("tayang", f);
  const total = await prisma.kolContent.count({ where });
  const halaman = halamanSah(opsi.halaman, total, per);
  const rows = await prisma.kolContent.findMany({
    where,
    orderBy: [{ liveAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
    skip: (halaman - 1) * per,
    take: per,
    select: {
      id: true,
      platform: true,
      format: true,
      link: true,
      liveAt: true,
      collab: { select: PILIH_KOLAB },
      metrics: {
        select: { recordedAt: true, views: true, likes: true, comments: true, shares: true, saves: true },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 1,
      },
      _count: { select: { metrics: true } },
    },
  });
  const baris = rows.map((k): BarisTayang => {
    const m = k.metrics[0];
    const angka: AngkaTerakhir | null = m
      ? { views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves, hari: formatDateOnlyJakarta(m.recordedAt), recordedAt: m.recordedAt.toISOString() }
      : null;
    const tayangHari = hariWib(k.liveAt);
    return {
      ...dasar(k.collab),
      kontenId: k.id,
      platform: String(k.platform),
      format: String(k.format),
      link: k.link ?? "",
      tayangHari,
      angkaTerakhir: angka,
      jumlahAngka: k._count.metrics,
      er: angka ? engagementRate(angka, pengikutUntuk(k.collab, String(k.platform))) : null,
      peringatan: peringatanAngka(
        {
          tahap: k.collab.tahap as Tahap,
          tahapAt: formatDateOnlyJakarta(k.collab.tahapAt),
          kontenId: k.id,
          link: k.link,
          liveAt: tayangHari,
          angkaTerakhirHari: angka?.hari ?? null,
        },
        hariIni,
        ambang,
      ),
    };
  });
  return { chip: "tayang", total, halaman, perHalaman: per, baris };
}

/* ──────────────────────────── Riwayat angka ──────────────────────────── */

export type BarisAngka = AngkaKonten & {
  id: string;
  recordedAt: string;
  hari: string;
  sumber: string | null;
  catatan: string | null;
  pencatat: string | null;
};

async function namaPengguna(ids: (string | null)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unik.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? ""]));
}

function keBarisAngka(
  m: { id: string; recordedAt: Date; views: number; likes: number; comments: number; shares: number; saves: number; source: string | null; note: string | null; createdById: string | null },
  nama: Map<string, string>,
): BarisAngka {
  return {
    id: m.id,
    recordedAt: m.recordedAt.toISOString(),
    hari: formatDateOnlyJakarta(m.recordedAt),
    views: m.views,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    saves: m.saves,
    sumber: m.source,
    catatan: m.note,
    pencatat: m.createdById ? (nama.get(m.createdById) ?? null) : null,
  };
}

const PILIH_ANGKA = {
  id: true,
  recordedAt: true,
  views: true,
  likes: true,
  comments: true,
  shares: true,
  saves: true,
  source: true,
  note: true,
  createdById: true,
} satisfies Prisma.KolContentMetricSelect;

/** Semua baris angka satu konten, terbaru dulu. */
export async function riwayatAngka(kontenId: string): Promise<BarisAngka[]> {
  if (!kontenId) return [];
  const rows = await prisma.kolContentMetric.findMany({
    where: { contentId: kontenId },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: PILIH_ANGKA,
  });
  const nama = await namaPengguna(rows.map((r) => r.createdById));
  return rows.map((r) => keBarisAngka(r, nama));
}

/* ──────────────────────────── Jadwal tayang ──────────────────────────── */

/**
 * Butir Jadwal tayang satu bulan, menurut HARI WIB:
 *   - konten tayang pada tanggal tayangnya (hijau);
 *   - konten belum tayang yang punya rencana tayang (aksen);
 *   - kolaborasi berjalan dengan rencana tayang tapi belum punya konten
 *     tayang maupun konten berencana (aksen) — supaya rencana dari dialog
 *     kolaborasi ikut terlihat tanpa dihitung dua kali.
 */
export async function jadwalTayang(bulan: string, f: FilterKontenKol = {}): Promise<ButirJadwal[]> {
  const batas = batasBulan(bulan);
  if (!batas) return [];
  const dari = parseDateOnly(batas.dari)!;
  const sampai = parseDateOnlyEnd(batas.sampai)!;
  const kolab = saringKolaborasi(f);

  const [tayang, rencana, rencanaKolab] = await Promise.all([
    prisma.kolContent.findMany({
      where: { AND: [ADA_LINK, { liveAt: { gte: dari, lte: sampai } }, { collab: kolab }] },
      select: { id: true, collabId: true, platform: true, liveAt: true, collab: { select: { kol: { select: { name: true, accounts: { select: { handle: true }, orderBy: { followers: "desc" }, take: 1 } } } } } },
    }),
    prisma.kolContent.findMany({
      where: { AND: [TANPA_LINK, { plannedAt: { gte: dari, lte: sampai } }, { collab: { AND: [kolab, { tahap: BERJALAN }] } }] },
      select: { id: true, collabId: true, platform: true, plannedAt: true, collab: { select: { kol: { select: { name: true, accounts: { select: { handle: true }, orderBy: { followers: "desc" }, take: 1 } } } } } },
    }),
    prisma.kolBrief.findMany({
      where: {
        AND: [
          kolab,
          { tahap: BERJALAN },
          { plannedLiveAt: { gte: dari, lte: sampai } },
          { kolContents: { none: { OR: [ADA_LINK, { plannedAt: { not: null } }] } } },
        ],
      },
      select: { id: true, plannedLiveAt: true, kol: { select: { name: true, accounts: { select: { handle: true, platform: true }, orderBy: { followers: "desc" }, take: 1 } } } },
    }),
  ]);

  const label = (kol: { name: string; accounts: { handle: string }[] }) => {
    const h = kol.accounts[0]?.handle?.replace(/^@/, "");
    return h ? `@${h}` : kol.name;
  };
  return [
    ...tayang.map((k) => ({ id: k.id, kolaborasiId: k.collabId, tanggal: formatDateOnlyJakarta(k.liveAt!), jenis: "TAYANG" as const, label: label(k.collab.kol), platform: String(k.platform) })),
    ...rencana.map((k) => ({ id: k.id, kolaborasiId: k.collabId, tanggal: formatDateOnlyJakarta(k.plannedAt!), jenis: "RENCANA" as const, label: label(k.collab.kol), platform: String(k.platform) })),
    ...rencanaKolab.map((c) => ({
      id: c.id,
      kolaborasiId: c.id,
      tanggal: formatDateOnlyJakarta(c.plannedLiveAt!),
      jenis: "RENCANA" as const,
      label: label(c.kol),
      platform: c.kol.accounts[0] ? String(c.kol.accounts[0].platform) : null,
    })),
  ];
}

/* ──────────────────────────── Panel kolaborasi ──────────────────────────── */

export type KontenPanel = {
  id: string;
  platform: string;
  format: string;
  link: string | null;
  tayangHari: string | null;
  rencanaHari: string | null;
  draftLink: string | null;
  draftStatus: StatusDraf | null;
  draftNote: string | null;
  drafHari: string | null;
  disetujuiOleh: string | null;
  disetujuiHari: string | null;
  adCode: string | null;
  adCodeSampai: string | null;
  /** Semua baris angka, terbaru dulu. */
  angka: BarisAngka[];
  er: number | null;
  peringatan: PeringatanAngka;
};

export type DataPanelKonten = {
  kolaborasiId: string;
  docNo: string;
  tahap: Tahap;
  kolId: string;
  konten: KontenPanel[];
};

export async function kontenKolaborasi(
  kolaborasiId: string,
  opsi: { hariIni?: string; ambang?: AmbangKreatif } = {},
): Promise<DataPanelKonten | null> {
  if (!kolaborasiId) return null;
  const hariIni = opsi.hariIni ?? hariIniWib();
  const ambang = opsi.ambang ?? AMBANG_BAWAAN;
  const c = await prisma.kolBrief.findUnique({
    where: { id: kolaborasiId },
    select: {
      ...PILIH_KOLAB,
      kolContents: {
        orderBy: [{ liveAt: { sort: "desc", nulls: "last" } }, { plannedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        select: {
          id: true,
          platform: true,
          format: true,
          link: true,
          liveAt: true,
          plannedAt: true,
          draftLink: true,
          draftStatus: true,
          draftNote: true,
          draftAt: true,
          approvedAt: true,
          approvedBy: { select: { name: true } },
          adCode: true,
          adCodeUntil: true,
          metrics: { select: PILIH_ANGKA, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 100 },
        },
      },
    },
  });
  if (!c) return null;
  const nama = await namaPengguna(c.kolContents.flatMap((k) => k.metrics.map((m) => m.createdById)));
  return {
    kolaborasiId: c.id,
    docNo: c.docNo,
    tahap: c.tahap as Tahap,
    kolId: c.kolId,
    konten: c.kolContents.map((k) => {
      const angka = k.metrics.map((m) => keBarisAngka(m, nama));
      const tayangHari = hariWib(k.liveAt);
      return {
        id: k.id,
        platform: String(k.platform),
        format: String(k.format),
        link: k.link?.trim() ? k.link : null,
        tayangHari,
        rencanaHari: hariWib(k.plannedAt),
        draftLink: k.draftLink,
        draftStatus: (k.draftStatus as StatusDraf | null) ?? null,
        draftNote: k.draftNote,
        drafHari: hariWib(k.draftAt),
        disetujuiOleh: k.approvedBy?.name ?? null,
        disetujuiHari: hariWib(k.approvedAt),
        adCode: k.adCode,
        adCodeSampai: hariWib(k.adCodeUntil),
        angka,
        er: angka[0] ? engagementRate(angka[0], pengikutUntuk(c, String(k.platform))) : null,
        peringatan: peringatanAngka(
          {
            tahap: c.tahap as Tahap,
            tahapAt: formatDateOnlyJakarta(c.tahapAt),
            kontenId: k.id,
            link: k.link,
            liveAt: tayangHari,
            angkaTerakhirHari: angka[0]?.hari ?? null,
          },
          hariIni,
          ambang,
        ),
      };
    }),
  };
}

/** Label kolaborasi untuk saringan `?kolaborasi=` ("Nadia · BRIEF/2026/0004"), atau null bila tidak ada. */
export async function labelKolaborasi(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const c = await prisma.kolBrief.findUnique({ where: { id }, select: { docNo: true, kol: { select: { name: true } } } });
  return c ? `${c.kol.name} · ${c.docNo}` : null;
}

/** Campaign untuk saringan layar (yang belum diarsipkan, terbaru dulu). */
export async function campaignUntukSaringan(): Promise<{ id: string; name: string }[]> {
  return prisma.kolCampaign.findMany({
    where: { archivedAt: null },
    orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, name: true },
    take: 300,
  });
}
