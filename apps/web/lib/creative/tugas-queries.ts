import { cache } from "react";
import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { geserHari, hariIniWib } from "@/lib/tanggal-isian";
import { bacaChecklist, jumlahBelum } from "./agenda-aturan";
import { angkaKolaborasi, jumlahAngkaKolaborasi, type AngkaKolaborasi, type Periode } from "./angka-queries";
import { bacaAmbangKreatif } from "./pengaturan";
import { TAHAP_BERJALAN, type StatusBayar, type StatusDraf, type Tahap } from "./tahap";
import {
  jumlahTugas,
  susunTugas,
  type AgendaTugas,
  type CampaignTugas,
  type KelompokTugas,
  type KolaborasiTugas,
  type MasukanTugas,
} from "./tugas";
import { normalisasiWa } from "./wa";

/*
 * Pembaca "Hari ini" Ruang KOL — KHUSUS SERVER (klien hanya `import type`).
 *
 * Membaca baris yang dibutuhkan `susunTugas` (aturan 13 kelompoknya murni, di
 * `tugas.ts`) dan angka KPI. Tidak ada tenggat atau status yang disimpan:
 * semuanya dihitung ulang dari tanggal-tanggal kolaborasi setiap kali dibaca.
 *
 * Kolaborasi yang dibaca:
 *   - semua yang masih berjalan (13 tahap tanpa SELESAI);
 *   - yang sudah selesai/keluar jalur tapi fee-nya belum lunas — fee yang
 *     sudah diakui tetap ditagih (`tenggat.ts`);
 *   - yang sampelnya SUDAH berangkat ke KOL atau nomor WA yang sama dengan
 *     kolaborasi yang mau dikirimi — bahan "kirim dobel". Tahap mereka tidak
 *     berjalan, jadi mereka tidak menambah kelompok lain.
 *
 * `cakupan` membatasi bacaan ke id tertentu. Dipakai tes, yang berbagi basis
 * data dengan data lain; layar tidak pernah mengirimnya.
 */

export type CakupanTugas = {
  kolaborasiIds?: readonly string[];
  agendaIds?: readonly string[];
  campaignIds?: readonly string[];
};

const TAHAP_RAWAN_DOBEL: readonly Tahap[] = ["DEAL", "BRIEF_DIKIRIM", "SAMPEL_DIKIRIM"];

const PILIH_KOLABORASI = {
  id: true,
  docNo: true,
  kolId: true,
  tahap: true,
  tahapAt: true,
  campaignId: true,
  dealAt: true,
  lastContactAt: true,
  plannedLiveAt: true,
  liveAt: true,
  fee: true,
  payStatus: true,
  kol: {
    select: {
      name: true,
      waNormal: true,
      phone: true,
      address: true,
      sizeProfile: true,
      blockedAt: true,
      accounts: { select: { platform: true, handle: true, followers: true } },
    },
  },
  shipments: { select: { id: true, sentAt: true, receivedAt: true, trackingNo: true, courier: true } },
  kolContents: {
    select: {
      id: true,
      link: true,
      liveAt: true,
      plannedAt: true,
      draftStatus: true,
      draftAt: true,
      draftLink: true,
      metrics: { select: { recordedAt: true }, orderBy: [{ recordedAt: "desc" as const }, { id: "desc" as const }], take: 1 },
    },
  },
} satisfies Prisma.KolBriefSelect;

type BarisKolaborasi = Prisma.KolBriefGetPayload<{ select: typeof PILIH_KOLABORASI }>;

const hari = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);

/** `sizeProfile` dianggap terisi bila ada satu nilai yang tidak kosong. */
export function ukuranTerisi(sizeProfile: string | null | undefined): boolean {
  const t = sizeProfile?.trim();
  if (!t) return false;
  try {
    const o = JSON.parse(t) as unknown;
    if (!o || typeof o !== "object") return Boolean(o);
    return Object.values(o as Record<string, unknown>).some((v) => (typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined));
  } catch {
    return true;
  }
}

/** Akun utama = pengikut terbanyak. */
function akunUtama(akun: readonly { platform: string; handle: string; followers: number }[]) {
  return [...akun].sort((a, b) => b.followers - a.followers || a.handle.localeCompare(b.handle))[0] ?? null;
}

export function keKolaborasiTugas(c: BarisKolaborasi): KolaborasiTugas {
  const akun = akunUtama(c.kol.accounts.map((a) => ({ platform: String(a.platform), handle: a.handle, followers: a.followers })));
  return {
    id: c.id,
    docNo: c.docNo,
    kolId: c.kolId,
    kolNama: c.kol.name,
    kolHandle: akun?.handle ?? null,
    platform: akun?.platform ?? null,
    waNormal: c.kol.waNormal ?? normalisasiWa(c.kol.phone),
    alamat: c.kol.address,
    ukuranAda: ukuranTerisi(c.kol.sizeProfile),
    kolDiblokir: c.kol.blockedAt !== null,
    campaignId: c.campaignId,
    tahap: c.tahap as Tahap,
    tahapAt: hari(c.tahapAt)!,
    dealAt: hari(c.dealAt),
    lastContactAt: hari(c.lastContactAt),
    plannedLiveAt: hari(c.plannedLiveAt),
    liveAt: hari(c.liveAt),
    fee: Number(c.fee),
    payStatus: c.payStatus as StatusBayar,
    pengiriman: c.shipments.map((p) => ({
      id: p.id,
      sentAt: hari(p.sentAt),
      receivedAt: hari(p.receivedAt),
      trackingNo: p.trackingNo,
      courier: p.courier,
    })),
    konten: c.kolContents.map((k) => ({
      id: k.id,
      link: k.link,
      liveAt: hari(k.liveAt),
      plannedAt: hari(k.plannedAt),
      draftStatus: (k.draftStatus as StatusDraf | null) ?? null,
      draftAt: hari(k.draftAt),
      draftLink: k.draftLink,
      angkaTerakhirHari: hari(k.metrics[0]?.recordedAt),
    })),
  };
}

const dalamCakupan = (ids: readonly string[] | undefined): Prisma.StringFilter | undefined =>
  ids ? { in: [...ids] } : undefined;

/** Kolaborasi bahan Hari ini dan kalender (lihat kepala berkas). */
export async function muatKolaborasiTugas(cakupan?: CakupanTugas): Promise<KolaborasiTugas[]> {
  const idCakupan = dalamCakupan(cakupan?.kolaborasiIds);
  const utama = await prisma.kolBrief.findMany({
    where: {
      ...(idCakupan ? { id: idCakupan } : {}),
      OR: [{ tahap: { in: [...TAHAP_BERJALAN] } }, { fee: { gt: 0 }, payStatus: { in: ["BELUM", "SEBAGIAN"] } }],
    },
    select: PILIH_KOLABORASI,
  });

  const rawan = utama.filter((c) => TAHAP_RAWAN_DOBEL.includes(c.tahap as Tahap));
  let pembanding: BarisKolaborasi[] = [];
  if (rawan.length) {
    const kolIds = [...new Set(rawan.map((c) => c.kolId))];
    const was = [...new Set(rawan.map((c) => c.kol.waNormal ?? normalisasiWa(c.kol.phone)).filter((w): w is string => Boolean(w)))];
    pembanding = await prisma.kolBrief.findMany({
      where: {
        AND: [
          { id: { notIn: utama.map((c) => c.id) } },
          ...(idCakupan ? [{ id: idCakupan }] : []),
          { shipments: { some: { OR: [{ sentAt: { not: null } }, { trackingNo: { not: null } }] } } },
          { OR: [{ kolId: { in: kolIds } }, ...(was.length ? [{ kol: { waNormal: { in: was } } }] : [])] },
        ],
      },
      select: PILIH_KOLABORASI,
    });
  }
  // `relationMode = "prisma"`: tidak ada foreign key, jadi kolaborasi bisa
  // sesaat menunjuk KOL yang sudah terhapus (mis. saat teardown tes atau
  // penghapusan yang belum selesai). Baris seperti itu dilewati — satu baris
  // yatim tidak boleh menjatuhkan lencana dan seluruh layar Hari ini.
  return [...utama, ...pembanding].filter((c) => c.kol != null).map(keKolaborasiTugas);
}

/** Agenda milik `userId` yang belum selesai dan bisa masuk masa ingat (≤ H-30). */
async function muatAgendaTugas(userId: string | null, hariIni: string, cakupan?: CakupanTugas): Promise<AgendaTugas[]> {
  if (!userId) return [];
  const batas = parseDateOnlyEnd(geserHari(hariIni, 30));
  const idCakupan = dalamCakupan(cakupan?.agendaIds);
  const rows = await prisma.kolAgenda.findMany({
    where: { ownerId: userId, doneAt: null, ...(batas ? { date: { lte: batas } } : {}), ...(idCakupan ? { id: idCakupan } : {}) },
    select: { id: true, title: true, date: true, time: true, remindDaysBefore: true, doneAt: true, checklist: true },
  });
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    date: formatDateOnlyJakarta(a.date),
    time: a.time,
    remindDaysBefore: a.remindDaysBefore,
    doneAt: hari(a.doneAt),
    checklistBelum: jumlahBelum(bacaChecklist(a.checklist)),
  }));
}

/**
 * Biaya terpakai per campaign = jumlah biaya seluruh kolaborasinya (fee +
 * boost + ongkir + modal sampel + komisi), lewat `angkaKolaborasi` — satu
 * cara hitung untuk semua layar.
 */
export async function terpakaiCampaign(campaignIds: readonly string[]): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  if (!campaignIds.length) return hasil;
  const kolab = await prisma.kolBrief.findMany({
    where: { campaignId: { in: [...campaignIds] } },
    select: { id: true, campaignId: true },
  });
  const angka = await angkaKolaborasi(kolab.map((k) => k.id));
  for (const id of campaignIds) {
    const milik = kolab.filter((k) => k.campaignId === id).map((k) => angka.get(k.id)).filter((a): a is AngkaKolaborasi => Boolean(a));
    hasil.set(id, jumlahAngkaKolaborasi(milik).biaya.total);
  }
  return hasil;
}

async function muatCampaignTugas(cakupan?: CakupanTugas): Promise<CampaignTugas[]> {
  const idCakupan = dalamCakupan(cakupan?.campaignIds);
  const rows = await prisma.kolCampaign.findMany({
    where: { archivedAt: null, budget: { gt: 0 }, ...(idCakupan ? { id: idCakupan } : {}) },
    select: { id: true, name: true, budget: true, archivedAt: true },
  });
  const terpakai = await terpakaiCampaign(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    budget: r.budget === null ? null : Number(r.budget),
    terpakai: terpakai.get(r.id) ?? 0,
    archivedAt: hari(r.archivedAt),
  }));
}

export async function muatMasukanTugas(o: { userId: string | null; hariIni?: string; cakupan?: CakupanTugas }): Promise<MasukanTugas> {
  const hariIni = o.hariIni ?? hariIniWib();
  const [kolaborasi, agenda, campaign, ambang] = await Promise.all([
    muatKolaborasiTugas(o.cakupan),
    muatAgendaTugas(o.userId, hariIni, o.cakupan),
    muatCampaignTugas(o.cakupan),
    bacaAmbangKreatif(),
  ]);
  return { kolaborasi, agenda, campaign, hariIni, ambang };
}

/**
 * 13 kelompok Hari ini untuk satu orang (agendanya pribadi). Dibungkus `cache`
 * supaya tata letak Kreatif (lencana tab) dan halaman Hari ini dalam satu
 * permintaan hanya membaca sekali.
 */
export const tugasKreatif = cache(async (userId: string | null, hariIni: string): Promise<KelompokTugas[]> =>
  susunTugas(await muatMasukanTugas({ userId, hariIni })),
);

/** Total untuk lencana tab dan menu — jumlah yang sama dengan kepala kartu Hari ini. */
export async function hitungTugasKreatif(userId: string | null): Promise<number> {
  return jumlahTugas(await tugasKreatif(userId, hariIniWib()));
}

// ── KPI ────────────────────────────────────────────────────────────────────

export type PosisiTahap = { tahap: Tahap; jumlah: number };

export type KpiKreatif = {
  /** KOL yang dibuat di periode (dalam campaign bila disaring). */
  kolBaru: number;
  /** Semua KOL (dalam campaign bila disaring). */
  kolTotal: number;
  /** Kolaborasi di tahap berjalan — tidak mengikuti periode. */
  berjalan: number;
  angka: AngkaKolaborasi;
  /** Banyak kolaborasi per tahap berjalan, urut tahap. */
  posisi: PosisiTahap[];
};

export type CakupanKpi = { kolaborasiIds?: readonly string[]; kolIds?: readonly string[] };

/**
 * Baris angka Hari ini. GMV, order, views, dan biaya mengikuti periode lewat
 * `angkaKolaborasi` (penjualan menurut tanggalnya, konten menurut tanggal
 * tayang, kiriman menurut tanggal berangkat, fee menurut tanggal deal);
 * kolaborasi berjalan dan posisi tahap adalah keadaan SEKARANG.
 */
export async function kpiKreatif(o: { periode: Periode; campaignId?: string | null; cakupan?: CakupanKpi }): Promise<KpiKreatif> {
  const dari = parseDateOnly(o.periode.dari);
  const sampai = parseDateOnlyEnd(o.periode.sampai);
  const rentang = dari && sampai ? { gte: dari, lte: sampai } : undefined;
  const idCakupan = dalamCakupan(o.cakupan?.kolaborasiIds);
  const dasar: Prisma.KolBriefWhereInput = {
    ...(o.campaignId ? { campaignId: o.campaignId } : {}),
    ...(idCakupan ? { id: idCakupan } : {}),
  };

  const [calon, posisiMentah, kol] = await Promise.all([
    rentang
      ? prisma.kolBrief.findMany({
          where: {
            ...dasar,
            OR: [
              { sales: { some: { date: rentang } } },
              { kolContents: { some: { liveAt: rentang, link: { not: null } } } },
              { shipments: { some: { stockIssuedAt: { not: null }, OR: [{ sentAt: rentang }, { sentAt: null, stockIssuedAt: rentang }] } } },
              { dealAt: rentang },
              { dealAt: null, createdAt: rentang },
            ],
          },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
    prisma.kolBrief.groupBy({ by: ["tahap"], where: { ...dasar, tahap: { in: [...TAHAP_BERJALAN] } }, _count: { _all: true } }),
    hitungKol(o.campaignId ?? null, rentang, o.cakupan?.kolIds),
  ]);

  const peta = await angkaKolaborasi(
    calon.map((c) => c.id),
    { periode: o.periode },
  );
  const jumlahPerTahap = new Map(posisiMentah.map((p) => [p.tahap as Tahap, p._count._all]));
  const posisi = TAHAP_BERJALAN.map((tahap) => ({ tahap, jumlah: jumlahPerTahap.get(tahap) ?? 0 }));
  return {
    kolBaru: kol.baru,
    kolTotal: kol.total,
    berjalan: posisi.reduce((s, p) => s + p.jumlah, 0),
    angka: jumlahAngkaKolaborasi(peta.values()),
    posisi,
  };
}

async function hitungKol(
  campaignId: string | null,
  rentang: { gte: Date; lte: Date } | undefined,
  kolIds?: readonly string[],
): Promise<{ baru: number; total: number }> {
  const where: Prisma.KolWhereInput = {
    ...(campaignId ? { briefs: { some: { campaignId } } } : {}),
    ...(kolIds ? { id: { in: [...kolIds] } } : {}),
  };
  const [total, baru] = await Promise.all([
    prisma.kol.count({ where }),
    rentang ? prisma.kol.count({ where: { ...where, createdAt: rentang } }) : Promise.resolve(0),
  ]);
  return { baru, total };
}

/** Pilihan saringan campaign: yang belum diarsip, ditambah yang sedang dipilih walau sudah diarsip. */
export async function pilihanCampaignKreatif(terpilih?: string | null): Promise<{ id: string; nama: string }[]> {
  const rows = await prisma.kolCampaign.findMany({
    where: { OR: [{ archivedAt: null }, ...(terpilih ? [{ id: terpilih }] : [])] },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: { id: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, nama: r.name }));
}
