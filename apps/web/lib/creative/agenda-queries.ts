import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaChecklist, type ButirChecklist } from "./agenda-aturan";
import { bacaAmbangKreatif } from "./pengaturan";
import { TAHAP_BERJALAN, type JenisAgenda, type Tahap } from "./tahap";
import { tenggatKolaborasi, type JenisTenggat } from "./tenggat";
import { muatKolaborasiTugas, type CakupanTugas } from "./tugas-queries";

/*
 * Kalender Ruang KOL — KHUSUS SERVER (klien hanya `import type`).
 *
 * Satu bacaan per bulan berisi SEMUA yang dibutuhkan kisi dan panel hari:
 * tenggat turunan (`tenggatKolaborasi`, sama dengan Hari ini), kejadian yang
 * diringkas per jenis per hari, dan agenda pribadi. Memilih tanggal hanya
 * mengganti panel di klien — bulan tidak dibaca ulang (bug KOL Manager §6.14).
 *
 * Baris per kelompok per hari dibatasi `BATAS_BARIS`; `jumlah` selalu angka
 * sebenarnya, jadi layar bisa berkata jujur "menampilkan X dari Y".
 */

export const BATAS_BARIS = 200;

export type JenisKejadian = "KIRIM" | "SAMPAI" | "RENCANA_TAYANG" | "TAYANG" | "DIBAYAR" | "CAMPAIGN_MULAI" | "CAMPAIGN_SELESAI";

export const URUTAN_KEJADIAN: readonly JenisKejadian[] = [
  "KIRIM",
  "SAMPAI",
  "RENCANA_TAYANG",
  "TAYANG",
  "DIBAYAR",
  "CAMPAIGN_MULAI",
  "CAMPAIGN_SELESAI",
];

export type BarisKalender = {
  /** Kunci baris: id kolaborasi, campaign, pengiriman, atau konten. */
  id: string;
  kolaborasiId: string | null;
  campaignId: string | null;
  judul: string;
  sub: string | null;
  /** Views (konten tayang) atau rupiah (dibayar, jatuh tempo). */
  nilai: number | null;
  /** Untuk tenggat: sudah lewat. */
  lewat?: boolean;
};

export type GrupKalender<J extends string> = { jenis: J; jumlah: number; nilai: number | null; baris: BarisKalender[] };

export type AgendaKalender = {
  id: string;
  judul: string;
  tanggal: string;
  jam: string | null;
  jenis: JenisAgenda;
  checklist: ButirChecklist[];
  catatan: string | null;
  campaignId: string | null;
  campaignNama: string | null;
  kolId: string | null;
  kolNama: string | null;
  kolaborasiId: string | null;
  kolaborasiDocNo: string | null;
  ingatHari: number;
  selesai: boolean;
};

export type HariKalender = {
  tenggat: GrupKalender<JenisTenggat>[];
  kejadian: GrupKalender<JenisKejadian>[];
  agenda: AgendaKalender[];
};

export type KalenderKreatif = {
  dari: string;
  sampai: string;
  hari: Record<string, HariKalender>;
  /** Kolaborasi deal yang sampelnya belum berangkat — pengingat di panel hari ini. */
  dealBelumKirim: { jumlah: number; contoh: { id: string; judul: string }[] };
};

type Kumpulan<J extends string> = Map<string, Map<J, { nilai: number | null; baris: BarisKalender[] }>>;

function masukkan<J extends string>(peta: Kumpulan<J>, tanggal: string, jenis: J, baris: BarisKalender) {
  let perJenis = peta.get(tanggal);
  if (!perJenis) peta.set(tanggal, (perJenis = new Map()));
  let g = perJenis.get(jenis);
  if (!g) perJenis.set(jenis, (g = { nilai: null, baris: [] }));
  g.baris.push(baris);
  if (baris.nilai !== null) g.nilai = (g.nilai ?? 0) + baris.nilai;
}

function keGrup<J extends string>(perJenis: Map<J, { nilai: number | null; baris: BarisKalender[] }> | undefined, urutan: readonly J[]): GrupKalender<J>[] {
  if (!perJenis) return [];
  return urutan
    .filter((j) => perJenis.has(j))
    .map((jenis) => {
      const g = perJenis.get(jenis)!;
      const baris = [...g.baris].sort((a, b) => a.judul.localeCompare(b.judul) || a.id.localeCompare(b.id));
      return { jenis, jumlah: baris.length, nilai: g.nilai, baris: baris.slice(0, BATAS_BARIS) };
    });
}

const URUTAN_TENGGAT: readonly JenisTenggat[] = [
  "FOLLOW_UP",
  "KIRIM_SAMPEL",
  "RESI_NYANGKUT",
  "BATAS_TAYANG",
  "REVIEW_DRAF",
  "ANGKA_H1",
  "ANGKA_H3",
  "ANGKA_H7",
  "JATUH_TEMPO_BAYAR",
];

const hari = (d: Date) => formatDateOnlyJakarta(d);
const labelKol = (handle: string | null | undefined, nama: string) => (handle?.trim() ? `@${handle.trim().replace(/^@+/, "")}` : nama);

/**
 * Isi kalender untuk rentang `dari`–`sampai` (hari WIB, inklusif) — biasanya
 * seluruh kisi bulan termasuk hari tetangga. Agenda hanya milik `userId`.
 */
export async function kalenderKreatif(o: {
  dari: string;
  sampai: string;
  userId: string | null;
  hariIni?: string;
  cakupan?: CakupanTugas;
}): Promise<KalenderKreatif> {
  const hariIni = o.hariIni ?? hariIniWib();
  const awal = parseDateOnly(o.dari);
  const akhir = parseDateOnlyEnd(o.sampai);
  if (!awal || !akhir) return { dari: o.dari, sampai: o.sampai, hari: {}, dealBelumKirim: { jumlah: 0, contoh: [] } };
  const rentang = { gte: awal, lte: akhir };
  const idCakupan = o.cakupan?.kolaborasiIds ? { in: [...o.cakupan.kolaborasiIds] } : undefined;
  const cpCakupan = o.cakupan?.campaignIds ? { in: [...o.cakupan.campaignIds] } : undefined;
  const agCakupan = o.cakupan?.agendaIds ? { in: [...o.cakupan.agendaIds] } : undefined;
  const kolab = idCakupan ? { id: idCakupan } : {};

  const [kolaborasi, ambang, kiriman, konten, bayar, campaign, agenda, rencanaKolab] = await Promise.all([
    muatKolaborasiTugas(o.cakupan),
    bacaAmbangKreatif(),
    prisma.kolShipment.findMany({
      where: { collab: kolab, OR: [{ sentAt: rentang }, { receivedAt: rentang }] },
      select: {
        id: true,
        sentAt: true,
        receivedAt: true,
        courier: true,
        trackingNo: true,
        collab: { select: { id: true, docNo: true, kol: { select: { name: true, accounts: { select: { handle: true, followers: true } } } } } },
      },
    }),
    prisma.kolContent.findMany({
      where: { collab: kolab, OR: [{ liveAt: rentang, link: { not: null } }, { plannedAt: rentang, link: null }] },
      select: {
        id: true,
        platform: true,
        link: true,
        liveAt: true,
        plannedAt: true,
        metrics: { select: { views: true }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1 },
        collab: { select: { id: true, docNo: true, kol: { select: { name: true, accounts: { select: { handle: true, followers: true } } } } } },
      },
    }),
    prisma.kolBrief.findMany({
      where: { ...kolab, paidAt: rentang, paidAmount: { gt: 0 } },
      select: { id: true, docNo: true, paidAt: true, paidAmount: true, kol: { select: { name: true, accounts: { select: { handle: true, followers: true } } } } },
    }),
    prisma.kolCampaign.findMany({
      where: { ...(cpCakupan ? { id: cpCakupan } : {}), OR: [{ startDate: rentang }, { endDate: rentang }] },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
    o.userId
      ? prisma.kolAgenda.findMany({
          where: { ownerId: o.userId, date: rentang, ...(agCakupan ? { id: agCakupan } : {}) },
          orderBy: [{ date: "asc" }, { time: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            title: true,
            date: true,
            time: true,
            kind: true,
            checklist: true,
            note: true,
            remindDaysBefore: true,
            doneAt: true,
            campaignId: true,
            kolId: true,
            collabId: true,
            campaign: { select: { name: true } },
            kol: { select: { name: true } },
            collab: { select: { docNo: true } },
          },
        })
      : Promise.resolve([]),
    // Rencana tayang di kolaborasi tanpa rencana per konten (lihat tugas.ts).
    prisma.kolBrief.findMany({
      where: {
        ...kolab,
        tahap: { in: [...TAHAP_BERJALAN] },
        plannedLiveAt: rentang,
        kolContents: { none: { OR: [{ plannedAt: { not: null } }, { link: { not: null } }] } },
      },
      select: { id: true, docNo: true, plannedLiveAt: true, kol: { select: { name: true, accounts: { select: { handle: true, followers: true } } } } },
    }),
  ]);

  const handleUtama = (akun: { handle: string; followers: number }[]) =>
    [...akun].sort((a, b) => b.followers - a.followers)[0]?.handle ?? null;

  const tenggat: Kumpulan<JenisTenggat> = new Map();
  for (const c of kolaborasi) {
    for (const t of tenggatKolaborasi(c, ambang, hariIni)) {
      if (t.tanggal < o.dari || t.tanggal > o.sampai) continue;
      masukkan(tenggat, t.tanggal, t.jenis, {
        id: `${c.id}:${t.jenis}:${t.refId ?? ""}`,
        kolaborasiId: c.id,
        campaignId: c.campaignId,
        judul: labelKol(c.kolHandle, c.kolNama),
        sub: c.docNo,
        nilai: t.jenis === "JATUH_TEMPO_BAYAR" ? (c.termin?.find((x) => x.id === t.refId)?.jumlah ?? c.fee) : null,
        lewat: t.lewat,
      });
    }
  }

  const kejadian: Kumpulan<JenisKejadian> = new Map();
  for (const p of kiriman) {
    const judul = labelKol(handleUtama(p.collab.kol.accounts), p.collab.kol.name);
    const sub = [p.courier, p.trackingNo].filter(Boolean).join(" · ") || p.collab.docNo;
    const dasar = { kolaborasiId: p.collab.id, campaignId: null, judul, sub, nilai: null };
    if (p.sentAt && p.sentAt >= awal && p.sentAt <= akhir) masukkan(kejadian, hari(p.sentAt), "KIRIM", { ...dasar, id: `kirim:${p.id}` });
    if (p.receivedAt && p.receivedAt >= awal && p.receivedAt <= akhir) masukkan(kejadian, hari(p.receivedAt), "SAMPAI", { ...dasar, id: `sampai:${p.id}` });
  }
  for (const k of konten) {
    const judul = labelKol(handleUtama(k.collab.kol.accounts), k.collab.kol.name);
    if (k.link && k.liveAt) {
      masukkan(kejadian, hari(k.liveAt), "TAYANG", {
        id: `tayang:${k.id}`,
        kolaborasiId: k.collab.id,
        campaignId: null,
        judul,
        sub: k.collab.docNo,
        nilai: k.metrics[0]?.views ?? 0,
      });
    } else if (!k.link && k.plannedAt) {
      masukkan(kejadian, hari(k.plannedAt), "RENCANA_TAYANG", {
        id: `rencana:${k.id}`,
        kolaborasiId: k.collab.id,
        campaignId: null,
        judul,
        sub: k.collab.docNo,
        nilai: null,
      });
    }
  }
  for (const c of rencanaKolab) {
    masukkan(kejadian, hari(c.plannedLiveAt!), "RENCANA_TAYANG", {
      id: `rencana:${c.id}`,
      kolaborasiId: c.id,
      campaignId: null,
      judul: labelKol(handleUtama(c.kol.accounts), c.kol.name),
      sub: c.docNo,
      nilai: null,
    });
  }
  for (const b of bayar) {
    masukkan(kejadian, hari(b.paidAt!), "DIBAYAR", {
      id: `bayar:${b.id}`,
      kolaborasiId: b.id,
      campaignId: null,
      judul: labelKol(handleUtama(b.kol.accounts), b.kol.name),
      sub: b.docNo,
      nilai: Number(b.paidAmount),
    });
  }
  for (const c of campaign) {
    const dasar = { kolaborasiId: null, campaignId: c.id, judul: c.name, sub: null, nilai: null };
    if (c.startDate && c.startDate >= awal && c.startDate <= akhir) masukkan(kejadian, hari(c.startDate), "CAMPAIGN_MULAI", { ...dasar, id: `mulai:${c.id}` });
    if (c.endDate && c.endDate >= awal && c.endDate <= akhir) masukkan(kejadian, hari(c.endDate), "CAMPAIGN_SELESAI", { ...dasar, id: `selesai:${c.id}` });
  }

  const agendaPerHari = new Map<string, AgendaKalender[]>();
  for (const a of agenda) {
    const tanggal = hari(a.date);
    const isi: AgendaKalender = {
      id: a.id,
      judul: a.title,
      tanggal,
      jam: a.time,
      jenis: a.kind as JenisAgenda,
      checklist: bacaChecklist(a.checklist),
      catatan: a.note,
      campaignId: a.campaignId,
      campaignNama: a.campaign?.name ?? null,
      kolId: a.kolId,
      kolNama: a.kol?.name ?? null,
      kolaborasiId: a.collabId,
      kolaborasiDocNo: a.collab?.docNo ?? null,
      ingatHari: a.remindDaysBefore,
      selesai: a.doneAt !== null,
    };
    agendaPerHari.set(tanggal, [...(agendaPerHari.get(tanggal) ?? []), isi]);
  }

  const semuaTanggal = new Set([...tenggat.keys(), ...kejadian.keys(), ...agendaPerHari.keys()]);
  const hasilHari: Record<string, HariKalender> = {};
  for (const tgl of [...semuaTanggal].sort()) {
    hasilHari[tgl] = {
      tenggat: keGrup(tenggat.get(tgl), URUTAN_TENGGAT),
      kejadian: keGrup(kejadian.get(tgl), URUTAN_KEJADIAN),
      agenda: (agendaPerHari.get(tgl) ?? []).sort((a, b) => (a.jam ?? "99:99").localeCompare(b.jam ?? "99:99")),
    };
  }

  const belumKirim = kolaborasi
    .filter((c) => (c.tahap === "DEAL" || c.tahap === "BRIEF_DIKIRIM") && !c.pengiriman.some((p) => p.sentAt || p.trackingNo?.trim()))
    .sort((a, b) => (a.dealAt ?? a.tahapAt).localeCompare(b.dealAt ?? b.tahapAt));

  return {
    dari: o.dari,
    sampai: o.sampai,
    hari: hasilHari,
    dealBelumKirim: {
      jumlah: belumKirim.length,
      contoh: belumKirim.slice(0, 5).map((c) => ({ id: c.id, judul: labelKol(c.kolHandle, c.kolNama) })),
    },
  };
}

export type OpsiAgenda = {
  campaign: { id: string; nama: string }[];
  kolaborasi: { id: string; label: string; kolId: string }[];
  kol: { id: string; nama: string }[];
};

/** Pilihan kaitan di dialog agenda: campaign aktif, kolaborasi berjalan, KOL aktif. */
export async function opsiAgenda(): Promise<OpsiAgenda> {
  const [campaign, kolaborasi, kol] = await Promise.all([
    prisma.kolCampaign.findMany({ where: { archivedAt: null }, orderBy: [{ createdAt: "desc" }], select: { id: true, name: true } }),
    prisma.kolBrief.findMany({
      where: { tahap: { in: [...TAHAP_BERJALAN] as Tahap[] } },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, docNo: true, kolId: true, kol: { select: { name: true } } },
    }),
    prisma.kol.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }], select: { id: true, name: true } }),
  ]);
  return {
    campaign: campaign.map((c) => ({ id: c.id, nama: c.name })),
    kolaborasi: kolaborasi.map((c) => ({ id: c.id, label: `${c.docNo} · ${c.kol.name}`, kolId: c.kolId })),
    kol: kol.map((k) => ({ id: k.id, nama: k.name })),
  };
}
