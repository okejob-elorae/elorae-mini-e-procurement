import { prisma, Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bulanWib, kunciBulan, STATUS_PERIODE } from "@/lib/finance/periode/periode";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import {
  bacaIdSumberBerulang,
  idSumberBerulang,
  keadaanTemplat,
  periodeJatuhTempo,
  postingBerikutnya,
  SUMBER_BERULANG,
  tanggalPostingBulan,
  type KeadaanTemplat,
} from "./aturan";
import { ENTITAS_BERULANG, JEJAK_BERULANG } from "./jejak";
import { persetujuanTemplat } from "./writer";

/*
 * Pembaca jurnal berulang (bagian D4) — KHUSUS SERVER. Komponen klien hanya
 * boleh `import type` dari berkas ini.
 */

const n = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

function bacaMeta(m: unknown): Record<string, unknown> | null {
  let v = m;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function namaPengguna(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unik.length) return new Map();
  const u = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(u.map((x) => [x.id, x.name ?? x.email]));
}

export type BarisTemplat = {
  id: string;
  nama: string;
  hari: number;
  mulai: string;
  selesai: string | null;
  balikOtomatis: boolean;
  total: number;
  keadaan: KeadaanTemplat;
  postingTerakhir: string | null;
  postingBerikutnya: string | null;
  /** Bulan jatuh tempo yang belum berjurnal (bulan tertutup tidak dihitung). */
  tertunda: number;
  pengubahTerakhir: string | null;
  pengubahTerakhirId: string | null;
  disetujuiOleh: string | null;
};

async function bulanTertutup(): Promise<Set<string>> {
  const p = await prisma.accountingPeriod.findMany({ where: { status: STATUS_PERIODE.TERTUTUP }, select: { year: true, month: true } });
  return new Set(p.map((x) => kunciBulan({ tahun: x.year, bulan: x.month })));
}

export async function daftarTemplat(sekarang: Date = new Date(), tanggalMulai?: Date | null): Promise<BarisTemplat[]> {
  const hariIni = hariIniWib(sekarang);
  const t = await prisma.recurringJournal.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 500,
    select: {
      id: true,
      name: true,
      dayOfMonth: true,
      startDate: true,
      endDate: true,
      autoReverse: true,
      active: true,
      lastRunPeriod: true,
      lines: { select: { debit: true } },
    },
  });
  if (!t.length) return [];
  const ids = t.map((x) => x.id);
  const [setuju, tertutup, mulaiBuku, terposting] = await Promise.all([
    persetujuanTemplat(prisma, ids),
    bulanTertutup(),
    tanggalMulai !== undefined ? tanggalMulai : readGlCutover(),
    prisma.journal.findMany({
      where: { sourceType: SUMBER_BERULANG.POSTING, OR: ids.map((id) => ({ sourceId: { startsWith: `${id}/` } })) },
      select: { sourceId: true },
    }),
  ]);
  const sudah = new Set(terposting.map((j) => j.sourceId));
  const lantai = mulaiBuku ? bulanWib(mulaiBuku) : null;
  const nama = await namaPengguna([...setuju.values()].flatMap((s) => [s.pengubahTerakhir, s.disetujuiOleh]));
  return t.map((x) => {
    const s = setuju.get(x.id)!;
    const mulai = formatDateOnlyJakarta(x.startDate);
    const selesai = x.endDate ? formatDateOnlyJakarta(x.endDate) : null;
    const jadwal = { hari: x.dayOfMonth, mulai, selesai };
    const tertunda = x.active
      ? periodeJatuhTempo(jadwal, hariIni, lantai).filter((tb) => !tertutup.has(kunciBulan(tb)) && !sudah.has(idSumberBerulang(x.id, kunciBulan(tb)))).length
      : 0;
    return {
      id: x.id,
      nama: x.name,
      hari: x.dayOfMonth,
      mulai,
      selesai,
      balikOtomatis: x.autoReverse,
      total: x.lines.reduce((sum, l) => sum + Math.round(n(l.debit) * 100), 0) / 100,
      keadaan: keadaanTemplat({ aktif: x.active, sudahDisetujui: s.disetujuiOleh != null, selesai, hariIni }),
      postingTerakhir: x.lastRunPeriod,
      postingBerikutnya: x.active ? postingBerikutnya(jadwal, hariIni) : null,
      tertunda,
      pengubahTerakhir: s.pengubahTerakhir ? (nama.get(s.pengubahTerakhir) ?? null) : null,
      pengubahTerakhirId: s.pengubahTerakhir,
      disetujuiOleh: s.disetujuiOleh ? (nama.get(s.disetujuiOleh) ?? null) : null,
    };
  });
}

export type BarisTemplatRinci = {
  akunId: string;
  akunKode: string;
  akunNama: string;
  debit: number;
  kredit: number;
  memo: string | null;
  kanal: string | null;
};

export type JurnalTemplat = { id: string; periode: string; jenis: string; tanggal: string; total: number };

export type BulanTemplat = { periode: string; tanggal: string; keadaan: "DIPOSTING" | "TERTUNDA" | "DILEWATI" };

export type RiwayatTemplat = { aksi: string; waktu: string; olehNama: string | null; alasan: string | null };

export type RincianTemplat = BarisTemplat & {
  keterangan: string | null;
  dibuatOleh: string | null;
  dibuatOlehId: string;
  baris: BarisTemplatRinci[];
  jurnal: JurnalTemplat[];
  bulan: BulanTemplat[];
  riwayat: RiwayatTemplat[];
};

export async function rincianTemplat(id: string, sekarang: Date = new Date(), tanggalMulai?: Date | null): Promise<RincianTemplat | null> {
  const t = await prisma.recurringJournal.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      dayOfMonth: true,
      startDate: true,
      endDate: true,
      autoReverse: true,
      active: true,
      lastRunPeriod: true,
      createdById: true,
      lines: {
        orderBy: { sortOrder: "asc" },
        select: { chartAccountId: true, debit: true, credit: true, memo: true, channel: true },
      },
    },
  });
  if (!t) return null;
  const hariIni = hariIniWib(sekarang);
  const akunIds = [...new Set(t.lines.map((l) => l.chartAccountId))];
  const [akun, setuju, jurnal, jejak, tertutup, mulaiBuku] = await Promise.all([
    prisma.chartAccount.findMany({ where: { id: { in: akunIds } }, select: { id: true, code: true, name: true } }),
    persetujuanTemplat(prisma, [t.id]),
    prisma.journal.findMany({
      where: { sourceType: { in: [SUMBER_BERULANG.POSTING, SUMBER_BERULANG.BALIK] }, sourceId: { startsWith: `${t.id}/` } },
      orderBy: [{ date: "desc" }],
      take: 120,
      select: { id: true, sourceType: true, sourceId: true, date: true, lines: { select: { debit: true } } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_BERULANG, entityId: t.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
      select: { action: true, createdAt: true, userId: true, reason: true, metadata: true },
    }),
    bulanTertutup(),
    tanggalMulai !== undefined ? tanggalMulai : readGlCutover(),
  ]);
  const peta = new Map(akun.map((a) => [a.id, a]));
  const s = setuju.get(t.id)!;
  const nama = await namaPengguna([t.createdById, s.pengubahTerakhir, s.disetujuiOleh, ...jejak.map((j) => j.userId)]);
  const mulai = formatDateOnlyJakarta(t.startDate);
  const selesai = t.endDate ? formatDateOnlyJakarta(t.endDate) : null;
  const jadwal = { hari: t.dayOfMonth, mulai, selesai };
  const lantai = mulaiBuku ? bulanWib(mulaiBuku) : null;
  const terposting = new Set(jurnal.filter((j) => j.sourceType === SUMBER_BERULANG.POSTING).map((j) => bacaIdSumberBerulang(j.sourceId)?.periode));
  const dilewati = new Set(
    jejak.filter((j) => j.action === JEJAK_BERULANG.DILEWATI).map((j) => String(bacaMeta(j.metadata)?.periode ?? "")),
  );
  const bulan: BulanTemplat[] = periodeJatuhTempo(jadwal, hariIni, lantai)
    .map((tb) => {
      const p = kunciBulan(tb);
      const keadaan: BulanTemplat["keadaan"] = terposting.has(p) ? "DIPOSTING" : tertutup.has(p) || dilewati.has(p) ? "DILEWATI" : "TERTUNDA";
      return { periode: p, tanggal: tanggalPostingBulan(tb, t.dayOfMonth), keadaan };
    })
    .reverse()
    .slice(0, 36);

  return {
    id: t.id,
    nama: t.name,
    hari: t.dayOfMonth,
    mulai,
    selesai,
    balikOtomatis: t.autoReverse,
    total: t.lines.reduce((sum, l) => sum + Math.round(n(l.debit) * 100), 0) / 100,
    keadaan: keadaanTemplat({ aktif: t.active, sudahDisetujui: s.disetujuiOleh != null, selesai, hariIni }),
    postingTerakhir: t.lastRunPeriod,
    postingBerikutnya: t.active ? postingBerikutnya(jadwal, hariIni) : null,
    tertunda: t.active ? bulan.filter((b) => b.keadaan === "TERTUNDA").length : 0,
    pengubahTerakhir: s.pengubahTerakhir ? (nama.get(s.pengubahTerakhir) ?? null) : null,
    pengubahTerakhirId: s.pengubahTerakhir,
    disetujuiOleh: s.disetujuiOleh ? (nama.get(s.disetujuiOleh) ?? null) : null,
    keterangan: t.description,
    dibuatOleh: nama.get(t.createdById) ?? null,
    dibuatOlehId: t.createdById,
    baris: t.lines.map((l) => ({
      akunId: l.chartAccountId,
      akunKode: peta.get(l.chartAccountId)?.code ?? "",
      akunNama: peta.get(l.chartAccountId)?.name ?? l.chartAccountId,
      debit: n(l.debit),
      kredit: n(l.credit),
      memo: l.memo,
      kanal: l.channel,
    })),
    jurnal: jurnal.map((j) => ({
      id: j.id,
      periode: bacaIdSumberBerulang(j.sourceId)?.periode ?? "",
      jenis: j.sourceType ?? "",
      tanggal: j.date.toISOString(),
      total: j.lines.reduce((sum, l) => sum + Math.round(n(l.debit) * 100), 0) / 100,
    })),
    bulan,
    riwayat: jejak.map((j) => ({ aksi: j.action, waktu: j.createdAt.toISOString(), olehNama: nama.get(j.userId) ?? null, alasan: j.reason })),
  };
}

/** Nama templat untuk sumber jurnal `RECURRING*` (halaman Jurnal / Integritas). */
export async function infoDokumenBerulang(pasangan: Array<{ jenis: string; id: string }>): Promise<Map<string, { templatId: string; nomor: string }>> {
  const hasil = new Map<string, { templatId: string; nomor: string }>();
  const relevan = pasangan.filter((p) => p.jenis === SUMBER_BERULANG.POSTING || p.jenis === SUMBER_BERULANG.BALIK);
  const ids = [...new Set(relevan.map((p) => bacaIdSumberBerulang(p.id)?.templatId).filter((x): x is string => !!x))];
  if (!ids.length) return hasil;
  const t = await prisma.recurringJournal.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nama = new Map(t.map((x) => [x.id, x.name]));
  for (const p of relevan) {
    const b = bacaIdSumberBerulang(p.id);
    const nm = b ? nama.get(b.templatId) : undefined;
    if (b && nm) hasil.set(`${p.jenis}|${p.id}`, { templatId: b.templatId, nomor: `${nm} · ${b.periode}` });
  }
  return hasil;
}
