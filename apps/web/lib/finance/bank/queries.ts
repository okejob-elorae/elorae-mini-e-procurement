// Bukan aksi server — pembaca rekonsiliasi bank. KHUSUS SERVER: komponen klien
// hanya boleh `import type` dari berkas ini.

import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { idDokumenDariSumber } from "@/app/backoffice/finance/journals/_sumber/tautan";
import { jumlahSenBarisBank, selisihHari } from "./cocok";
import { ringkasRekonsiliasi, saldoBankPadaTanggal, type RingkasanRekonsiliasi } from "./rekonsiliasi";
import { STATUS_MUTASI } from "./mutasi-writer";
import { jurnalTerbatalkan, PILIH_JURNAL_CEK } from "./jurnal-batal";

type Klien = Prisma.TransactionClient | typeof prisma;
const sen = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);

export type RekeningRekonsiliasi = {
  id: string;
  kode: string;
  nama: string;
  belumCocok: number;
  imporTerakhir: string | null;
  mutasiTerakhir: string | null;
};

/** Rekening kas/bank beserta jumlah baris mutasi yang belum cocok. */
export async function daftarRekeningRekonsiliasi(klien: Klien = prisma): Promise<RekeningRekonsiliasi[]> {
  const rek = await rekeningKasBank(klien);
  if (rek.length === 0) return [];
  const ids = rek.map((r) => r.id);
  const [belum, impor, terakhir] = await Promise.all([
    klien.bankStatementLine.groupBy({ by: ["chartAccountId"], where: { chartAccountId: { in: ids }, status: STATUS_MUTASI.BELUM }, _count: { _all: true } }),
    klien.bankStatementImport.groupBy({ by: ["chartAccountId"], where: { chartAccountId: { in: ids } }, _max: { createdAt: true } }),
    klien.bankStatementLine.groupBy({ by: ["chartAccountId"], where: { chartAccountId: { in: ids } }, _max: { date: true } }),
  ]);
  const b = new Map(belum.map((x) => [x.chartAccountId, x._count._all]));
  const im = new Map(impor.map((x) => [x.chartAccountId, x._max.createdAt]));
  const tr = new Map(terakhir.map((x) => [x.chartAccountId, x._max.date]));
  return rek.map((r) => ({
    id: r.id,
    kode: r.kode,
    nama: r.nama,
    belumCocok: b.get(r.id) ?? 0,
    imporTerakhir: im.get(r.id)?.toISOString() ?? null,
    mutasiTerakhir: tr.get(r.id) ? formatDateOnlyJakarta(tr.get(r.id) as Date) : null,
  }));
}

export type BarisMutasiTampil = {
  id: string;
  tanggal: string;
  keterangan: string;
  jumlah: number;
  saldo: number | null;
  referensi: string | null;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  catatan: string | null;
  dariVoucher: boolean;
  cocokDengan: { journalId: string; tanggal: string; uraian: string; sourceType: string | null; dokumenId: string | null } | null;
};

export type HalamanMutasi = { baris: BarisMutasiTampil[]; total: number; halaman: number; ukuran: number; jumlahPerStatus: Record<string, number> };

export async function daftarMutasi(
  opsi: { akunId: string; status?: string | null; dari?: string | null; sampai?: string | null; halaman?: number; ukuran?: number },
  klien: Klien = prisma,
): Promise<HalamanMutasi> {
  const ukuran = Math.min(Math.max(opsi.ukuran ?? 50, 10), 200);
  const halaman = Math.max(1, opsi.halaman ?? 1);
  const tanggal: Prisma.DateTimeFilter = {};
  if (opsi.dari) tanggal.gte = parseDateOnly(opsi.dari);
  if (opsi.sampai) tanggal.lte = parseDateOnlyEnd(opsi.sampai);
  const dasar: Prisma.BankStatementLineWhereInput = { chartAccountId: opsi.akunId, ...(opsi.dari || opsi.sampai ? { date: tanggal } : {}) };
  const where: Prisma.BankStatementLineWhereInput = { ...dasar, ...(opsi.status ? { status: opsi.status } : {}) };
  const [baris, total, perStatus] = await Promise.all([
    klien.bankStatementLine.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (halaman - 1) * ukuran, take: ukuran }),
    klien.bankStatementLine.count({ where }),
    klien.bankStatementLine.groupBy({ by: ["status"], where: dasar, _count: { _all: true } }),
  ]);
  const jurnalBarisIds = baris.map((b) => b.matchedJournalLineId).filter((x): x is string => Boolean(x));
  const barisJurnal = jurnalBarisIds.length
    ? await klien.journalLine.findMany({
        where: { id: { in: jurnalBarisIds } },
        select: { id: true, journal: { select: { id: true, date: true, description: true, sourceType: true, sourceId: true } } },
      })
    : [];
  const perBaris = new Map(barisJurnal.map((b) => [b.id, b.journal]));
  return {
    halaman,
    ukuran,
    total,
    jumlahPerStatus: Object.fromEntries(perStatus.map((s) => [s.status, s._count._all])),
    baris: baris.map((b) => {
      const j = b.matchedJournalLineId ? perBaris.get(b.matchedJournalLineId) : null;
      return {
        id: b.id,
        tanggal: formatDateOnlyJakarta(b.date),
        keterangan: b.description,
        jumlah: Number(b.amount),
        saldo: b.balance == null ? null : Number(b.balance),
        referensi: b.externalRef,
        status: b.status as BarisMutasiTampil["status"],
        catatan: b.note,
        dariVoucher: Boolean(b.createdJournalId),
        cocokDengan: j
          ? { journalId: j.id, tanggal: formatDateOnlyJakarta(j.date), uraian: j.description, sourceType: j.sourceType, dokumenId: idDokumenDariSumber(j.sourceType, j.sourceId) }
          : null,
      };
    }),
  };
}

export type KandidatJurnal = { barisId: string; journalId: string; tanggal: string; uraian: string; jumlah: number; selisihHari: number; sourceType: string | null };

/**
 * Baris jurnal akun bank yang belum dicocokkan dengan jumlah sama, paling jauh
 * 31 hari dari tanggal mutasi — untuk cocok manual (terdekat dulu).
 */
export async function kandidatJurnal(mutasiId: string, klien: Klien = prisma): Promise<KandidatJurnal[]> {
  const m = await klien.bankStatementLine.findUnique({ where: { id: mutasiId }, select: { chartAccountId: true, amount: true, date: true } });
  if (!m) return [];
  const target = sen(m.amount);
  const dari = new Date(m.date.getTime() - 32 * 86_400_000);
  const sampai = new Date(m.date.getTime() + 32 * 86_400_000);
  const baris = await klien.journalLine.findMany({
    where: {
      chartAccountId: m.chartAccountId,
      journal: { status: "POSTED", date: { gte: dari, lte: sampai } },
      ...(target >= 0 ? { debit: target / 100 } : { credit: -target / 100 }),
    },
    select: { id: true, debit: true, credit: true, journal: { select: { date: true, description: true, ...PILIH_JURNAL_CEK } } },
    take: 200,
  });
  // Voucher/pembayaran yang dibatalkan (asli dan pembaliknya) bukan pasangan mutasi.
  const batal = await jurnalTerbatalkan(klien, [...new Map(baris.map((b) => [b.journal.id, b.journal])).values()]);
  const terpakai = new Set(
    (
      await klien.bankStatementLine.findMany({ where: { matchedJournalLineId: { in: baris.map((b) => b.id) } }, select: { matchedJournalLineId: true } })
    ).map((x) => x.matchedJournalLineId),
  );
  const tMutasi = formatDateOnlyJakarta(m.date);
  return baris
    .filter((b) => !terpakai.has(b.id) && !batal.has(b.journal.id) && jumlahSenBarisBank(b.debit.toString(), b.credit.toString()) === target)
    .map((b) => {
      const t = formatDateOnlyJakarta(b.journal.date);
      return { barisId: b.id, journalId: b.journal.id, tanggal: t, uraian: b.journal.description, jumlah: target / 100, selisihHari: selisihHari(tMutasi, t), sourceType: b.journal.sourceType };
    })
    .sort((a, b) => a.selisihHari - b.selisihHari || a.tanggal.localeCompare(b.tanggal))
    .slice(0, 50);
}

export type ItemRekonsiliasi = { id: string; tanggal: string; uraian: string; jumlah: number; journalId?: string };

export type LaporanRekonsiliasi = {
  akunId: string;
  tanggal: string;
  /** Tanggal mutasi pertama yang diimpor — jurnal sebelum ini tidak dicocokkan. */
  sejak: string | null;
  ringkasan: RingkasanRekonsiliasi;
  jurnalBelumCocok: ItemRekonsiliasi[];
  mutasiBelumCocok: ItemRekonsiliasi[];
  /** Banyak item di luar 200 yang ditampilkan. */
  terpotong: { jurnal: number; mutasi: number };
  adaMutasi: boolean;
};

/** Laporan rekonsiliasi satu rekening per akhir hari `tanggal` (WIB). */
export async function laporanRekonsiliasi(akunId: string, tanggal: string, klien: Klien = prisma): Promise<LaporanRekonsiliasi> {
  const akhir = parseDateOnlyEnd(tanggal) as Date;
  const [bukuAgg, pertama, mutasi, impor] = await Promise.all([
    klien.journalLine.aggregate({ where: { chartAccountId: akunId, journal: { status: "POSTED", date: { lte: akhir } } }, _sum: { debit: true, credit: true } }),
    klien.bankStatementLine.findFirst({ where: { chartAccountId: akunId }, orderBy: { date: "asc" }, select: { date: true } }),
    klien.bankStatementLine.findMany({
      where: { chartAccountId: akunId, date: { lte: akhir } },
      select: { id: true, date: true, description: true, amount: true, balance: true, status: true, createdAt: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    klien.bankStatementImport.findFirst({
      where: { chartAccountId: akunId, openingBalance: { not: null }, periodFrom: { not: null } },
      orderBy: { periodFrom: "asc" },
      select: { periodFrom: true, openingBalance: true },
    }),
  ]);
  const saldoBukuSen = sen(bukuAgg._sum.debit) - sen(bukuAgg._sum.credit);
  const sejak = pertama ? formatDateOnlyJakarta(pertama.date) : null;
  const saldoBankSen = saldoBankPadaTanggal(
    mutasi.map((m, i) => ({ tanggal: formatDateOnlyJakarta(m.date), jumlahSen: sen(m.amount), saldoSen: m.balance == null ? null : sen(m.balance), urutan: i })),
    tanggal,
    impor?.periodFrom && impor.openingBalance != null ? { tanggal: formatDateOnlyJakarta(impor.periodFrom), sen: sen(impor.openingBalance) } : null,
  );
  const mutasiBelum = mutasi.filter((m) => m.status === STATUS_MUTASI.BELUM);

  let jurnalBelum: ItemRekonsiliasi[] = [];
  if (sejak) {
    const barisJurnal = await klien.journalLine.findMany({
      where: { chartAccountId: akunId, journal: { status: "POSTED", date: { gte: parseDateOnly(sejak), lte: akhir } } },
      select: { id: true, debit: true, credit: true, journal: { select: { id: true, date: true, description: true } } },
      orderBy: { journal: { date: "asc" } },
    });
    const terpakai = new Set<string>();
    for (let i = 0; i < barisJurnal.length; i += 1000) {
      const r = await klien.bankStatementLine.findMany({ where: { matchedJournalLineId: { in: barisJurnal.slice(i, i + 1000).map((b) => b.id) } }, select: { matchedJournalLineId: true } });
      for (const x of r) if (x.matchedJournalLineId) terpakai.add(x.matchedJournalLineId);
    }
    jurnalBelum = barisJurnal
      .filter((b) => !terpakai.has(b.id))
      .map((b) => ({
        id: b.id,
        journalId: b.journal.id,
        tanggal: formatDateOnlyJakarta(b.journal.date),
        uraian: b.journal.description,
        jumlah: jumlahSenBarisBank(b.debit.toString(), b.credit.toString()) / 100,
      }))
      .filter((b) => b.jumlah !== 0);
  }
  const ringkasan = ringkasRekonsiliasi({
    saldoBukuSen,
    saldoBankSen,
    jurnalBelumCocok: jurnalBelum.map((j) => ({ jumlahSen: Math.round(j.jumlah * 100) })),
    mutasiBelumCocok: mutasiBelum.map((m) => ({ jumlahSen: sen(m.amount) })),
  });
  const MAKS = 200;
  return {
    akunId,
    tanggal,
    sejak,
    ringkasan,
    jurnalBelumCocok: jurnalBelum.slice(0, MAKS),
    mutasiBelumCocok: mutasiBelum.slice(0, MAKS).map((m) => ({ id: m.id, tanggal: formatDateOnlyJakarta(m.date), uraian: m.description, jumlah: Number(m.amount) })),
    terpotong: { jurnal: Math.max(0, jurnalBelum.length - MAKS), mutasi: Math.max(0, mutasiBelum.length - MAKS) },
    adaMutasi: mutasi.length > 0 || Boolean(pertama),
  };
}

export type ImporMutasiTampil = { id: string; berkas: string; format: string | null; periodeDari: string | null; periodeSampai: string | null; baris: number; diimpor: string; cocok: number };

export async function daftarImporMutasi(akunId: string, klien: Klien = prisma): Promise<ImporMutasiTampil[]> {
  const impor = await klien.bankStatementImport.findMany({
    where: { chartAccountId: akunId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, fileName: true, bankFormat: true, periodFrom: true, periodTo: true, lineCount: true, createdAt: true },
  });
  const cocok = impor.length
    ? await klien.bankStatementLine.groupBy({ by: ["importId"], where: { importId: { in: impor.map((i) => i.id) }, status: STATUS_MUTASI.COCOK }, _count: { _all: true } })
    : [];
  const c = new Map(cocok.map((x) => [x.importId, x._count._all]));
  return impor.map((i) => ({
    id: i.id,
    berkas: i.fileName,
    format: i.bankFormat,
    periodeDari: i.periodFrom ? formatDateOnlyJakarta(i.periodFrom) : null,
    periodeSampai: i.periodTo ? formatDateOnlyJakarta(i.periodTo) : null,
    baris: i.lineCount,
    diimpor: i.createdAt.toISOString(),
    cocok: c.get(i.id) ?? 0,
  }));
}
