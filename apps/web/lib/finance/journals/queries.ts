import { prisma, Prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import type { AccountType } from "@/lib/constants/enums";
import { signedDelta } from "./normal-side";
import { SARING_JURNAL_BERLAKU, STATUS_JURNAL } from "./status-jurnal";

const toNum = (v: Prisma.Decimal | number): number => Number(v);

export type JournalListFilter = {
  from?: Date;
  to?: Date;
  sourceType?: string;
  manualOnly?: boolean;
  search?: string;
  /**
   * Status jurnal. Bawaan `POSTED`: daftar jurnal adalah daftar yang
   * MEMBENTUK buku besar — draf menunggu persetujuan dan yang ditolak tidak
   * ikut kecuali diminta.
   */
  status?: string;
};

export type JournalListRow = {
  id: string;
  date: string;
  description: string;
  sourceType: string | null;
  isManual: boolean;
  total: number;
  lineCount: number;
};

export async function listJournals(
  filter: JournalListFilter,
  paging: { page: number; pageSize: number },
): Promise<{ items: JournalListRow[]; totalCount: number }> {
  const where: Prisma.JournalWhereInput = {
    status: filter.status ?? STATUS_JURNAL.POSTED,
    ...(filter.from || filter.to
      ? {
          date: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
    ...(filter.sourceType ? { sourceType: filter.sourceType } : {}),
    ...(filter.manualOnly ? { isManual: true } : {}),
    ...(filter.search ? { description: cariTeks(filter.search) } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.journal.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (paging.page - 1) * paging.pageSize,
      take: paging.pageSize,
      select: {
        id: true,
        date: true,
        description: true,
        sourceType: true,
        isManual: true,
        lines: { select: { debit: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.journal.count({ where }),
  ]);

  const items: JournalListRow[] = rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString(),
    description: r.description,
    sourceType: r.sourceType,
    isManual: r.isManual,
    total: r.lines.reduce((sum, l) => sum + toNum(l.debit), 0),
    lineCount: r._count.lines,
  }));

  return { items, totalCount };
}

export type JournalDetailLine = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string | null;
};

export type JournalDetail = {
  id: string;
  date: string;
  description: string;
  sourceType: string | null;
  isManual: boolean;
  /** `POSTED` / `DRAFT` / `REJECTED` (`status-jurnal.ts`). */
  status: string;
  /** Tanggal asli kejadian bila jurnal otomatis digeser keluar dari bulan yang sudah ditutup. */
  originalDate: string | null;
  lines: JournalDetailLine[];
};

export async function getJournalById(id: string): Promise<JournalDetail | null> {
  const row = await prisma.journal.findUnique({
    where: { id },
    select: {
      id: true,
      date: true,
      description: true,
      sourceType: true,
      isManual: true,
      status: true,
      originalDate: true,
      lines: {
        select: {
          debit: true,
          credit: true,
          memo: true,
          account: { select: { code: true, name: true } },
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    date: row.date.toISOString(),
    description: row.description,
    sourceType: row.sourceType,
    isManual: row.isManual,
    status: row.status,
    originalDate: row.originalDate?.toISOString() ?? null,
    lines: row.lines.map((l) => ({
      accountCode: l.account.code,
      accountName: l.account.name,
      debit: toNum(l.debit),
      credit: toNum(l.credit),
      memo: l.memo,
    })),
  };
}

export type AccountLedgerRow = {
  journalId: string;
  date: string;
  description: string;
  /** Jurnal manual — keterangannya tampil apa adanya (`keterangan-tampil.ts`). */
  isManual: boolean;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type AccountLedger = {
  accountCode: string;
  accountName: string;
  type: AccountType;
  opening: number;
  rows: AccountLedgerRow[];
  closing: number;
};

export async function getAccountLedger(
  chartAccountId: string,
  range: { from?: Date; to?: Date },
): Promise<AccountLedger> {
  const account = await prisma.chartAccount.findUnique({
    where: { id: chartAccountId },
    select: { code: true, name: true, type: true },
  });
  if (!account) throw new Error(`Chart account not found: ${chartAccountId}`);

  const type = account.type as AccountType;

  // Opening balance: every line for this account dated strictly before `from`.
  const priorLines = range.from
    ? await prisma.journalLine.findMany({
        where: { chartAccountId, journal: { ...SARING_JURNAL_BERLAKU, date: { lt: range.from } } },
        select: { debit: true, credit: true },
      })
    : [];
  const opening = priorLines.reduce(
    (sum, l) => sum + signedDelta(type, toNum(l.debit), toNum(l.credit)),
    0,
  );

  const lines = await prisma.journalLine.findMany({
    where: {
      chartAccountId,
      journal: {
        ...SARING_JURNAL_BERLAKU,
        date: {
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lte: range.to } : {}),
        },
      },
    },
    orderBy: { journal: { date: "asc" } },
    select: {
      journalId: true,
      debit: true,
      credit: true,
      journal: { select: { date: true, description: true, isManual: true } },
    },
  });

  let runningBalance = opening;
  const rows: AccountLedgerRow[] = lines.map((l) => {
    const debit = toNum(l.debit);
    const credit = toNum(l.credit);
    runningBalance += signedDelta(type, debit, credit);
    return {
      journalId: l.journalId,
      date: l.journal.date.toISOString(),
      description: l.journal.description,
      isManual: l.journal.isManual,
      debit,
      credit,
      runningBalance,
    };
  });

  const closing = rows.length > 0 ? rows[rows.length - 1].runningBalance : opening;

  return {
    accountCode: account.code,
    accountName: account.name,
    type,
    opening,
    rows,
    closing,
  };
}
