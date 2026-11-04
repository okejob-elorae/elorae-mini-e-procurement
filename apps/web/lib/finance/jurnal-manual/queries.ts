import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { STATUS_JURNAL } from "@/lib/finance/journals/status-jurnal";

/*
 * Pembaca persetujuan jurnal manual — KHUSUS SERVER. Komponen klien hanya
 * boleh `import type` dari berkas ini.
 */

export type InfoPersetujuanJurnal = {
  id: string;
  status: string;
  isManual: boolean;
  sourceType: string | null;
  /** "YYYY-MM-DD" (WIB) — batas bawah tanggal pembalik. */
  tanggal: string;
  pembuatId: string;
  pembuatNama: string | null;
  disetujuiNama: string | null;
  disetujuiPada: string | null;
  ditolakNama: string | null;
  ditolakPada: string | null;
  alasanTolak: string | null;
  /** Jurnal yang dibalik oleh jurnal ini. */
  pembalikDari: { id: string; keterangan: string } | null;
  /** Jurnal pembalik (draf atau terposting) yang menunjuk jurnal ini. */
  dibalikOleh: { id: string; status: string; keterangan: string } | null;
};

export async function infoPersetujuanJurnal(id: string): Promise<InfoPersetujuanJurnal | null> {
  const j = await prisma.journal.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isManual: true,
      sourceType: true,
      date: true,
      postedById: true,
      approvedById: true,
      approvedAt: true,
      rejectedById: true,
      rejectedAt: true,
      rejectReason: true,
      reversalOfId: true,
    },
  });
  if (!j) return null;
  const [asli, pembalik] = await Promise.all([
    j.reversalOfId ? prisma.journal.findUnique({ where: { id: j.reversalOfId }, select: { id: true, description: true } }) : Promise.resolve(null),
    prisma.journal.findFirst({ where: { reversalOfId: j.id }, select: { id: true, status: true, description: true } }),
  ]);
  const ids = [j.postedById, j.approvedById, j.rejectedById].filter((x): x is string => !!x);
  const pengguna = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  const nama = new Map(pengguna.map((u) => [u.id, u.name ?? u.email]));
  return {
    id: j.id,
    status: j.status,
    isManual: j.isManual,
    sourceType: j.sourceType,
    tanggal: formatDateOnlyJakarta(j.date),
    pembuatId: j.postedById,
    pembuatNama: nama.get(j.postedById) ?? null,
    disetujuiNama: j.approvedById ? (nama.get(j.approvedById) ?? null) : null,
    disetujuiPada: j.approvedAt?.toISOString() ?? null,
    ditolakNama: j.rejectedById ? (nama.get(j.rejectedById) ?? null) : null,
    ditolakPada: j.rejectedAt?.toISOString() ?? null,
    alasanTolak: j.rejectReason,
    pembalikDari: asli ? { id: asli.id, keterangan: asli.description } : null,
    dibalikOleh: pembalik ? { id: pembalik.id, status: pembalik.status, keterangan: pembalik.description } : null,
  };
}

/** Jumlah jurnal manual yang menunggu persetujuan (tab Jurnal, baris Beranda). */
export async function hitungDrafJurnal(): Promise<number> {
  return prisma.journal.count({ where: { status: STATUS_JURNAL.DRAFT, isManual: true } });
}
