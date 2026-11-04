import { prisma, type Prisma } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import { signedDelta } from "@/lib/finance/journals/normal-side";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { AWALAN_SUMBER_SALDO_AWAL, SUMBER_TUTUP_TAHUN } from "@/lib/finance/periode/periode";

export type BalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  depth: number;
  isActive: boolean;
  hasChildren: boolean;
  debit: number;
  credit: number;
  signed: number;
};

export type OpsiSaldo = {
  /**
   * Ikutkan jurnal penutup tahun (`YEAR_END_CLOSE`, dan pembaliknya). Bawaan
   * TIDAK: Laba Rugi, Neraca Saldo, dan arus kas tahun yang sudah ditutup akan
   * terbaca nol kalau jurnal penutupnya ikut. Hanya Neraca (posisi kumulatif)
   * yang membutuhkannya — laba tahun tertutup pindah ke laba ditahan.
   */
  sertakanTutupTahun?: boolean;
  /**
   * Abaikan jurnal saldo awal (`OPENING…`). Dipakai arus kas: saldo awal
   * bukan arus kas periode itu — kas pembukaannya dihitung sebagai kas awal
   * (`getCashOpeningBalance`).
   */
  kecualiSaldoAwal?: boolean;
};

/**
 * Saringan `journal` untuk setiap pembaca saldo: hanya jurnal BERLAKU
 * (`POSTED` — draf dan yang ditolak tidak pernah dihitung), ditambah
 * pengecualian sumber menurut `opsi`. `sourceType` boleh null (jurnal manual),
 * jadi pengecualiannya selalu `null ATAU bukan X` — `NOT` polos atas kolom
 * nullable ikut membuang baris null.
 */
export function saringJurnalLaporan(
  range: { from?: Date; to?: Date },
  opsi: OpsiSaldo = {},
): Prisma.JournalWhereInput {
  const kecuali: Prisma.JournalWhereInput[] = [];
  if (!opsi.sertakanTutupTahun) {
    kecuali.push({ OR: [{ sourceType: null }, { sourceType: { not: SUMBER_TUTUP_TAHUN } }] });
  }
  if (opsi.kecualiSaldoAwal) {
    kecuali.push({ OR: [{ sourceType: null }, { NOT: { sourceType: { startsWith: AWALAN_SUMBER_SALDO_AWAL } } }] });
  }
  return {
    ...SARING_JURNAL_BERLAKU,
    ...(range.from || range.to
      ? {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lte: range.to } : {}),
          },
        }
      : {}),
    ...(kecuali.length ? { AND: kecuali } : {}),
  };
}

/**
 * Per-account debit/credit sums over a date range, joined onto the chart of
 * accounts. `from` omitted means since inception — Neraca uses that form,
 * Trial Balance and Laba Rugi pass a closed range.
 *
 * Only POSTED journals count, and year-end closing journals are left out
 * unless `opsi.sertakanTutupTahun` — see `OpsiSaldo`.
 *
 * Accounts with no movement in range are returned with zeroes so statement
 * structure stays stable across periods; callers decide whether to hide them.
 * An inactive account is kept only when it still carries movement in range,
 * because dropping it would break the debit == credit identity.
 */
export async function getAccountBalances(range: { from?: Date; to: Date }, opsi: OpsiSaldo = {}): Promise<BalanceRow[]> {
  const [accounts, grouped] = await Promise.all([
    prisma.chartAccount.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true, parentId: true, depth: true, isActive: true },
    }),
    prisma.journalLine.groupBy({
      by: ["chartAccountId"],
      _sum: { debit: true, credit: true },
      where: { journal: saringJurnalLaporan(range, opsi) },
    }),
  ]);

  /* `parentIds` includes ALL parent accounts from the chart of accounts. The `hasChildren`
   * flag reflects the chart's structure, not the returned row set — a parent can be marked
   * true while none of its children appear in the returned array (if the children have no
   * movement in range or are inactive with no movement). This is intentional, since
   * `postJournal` rejects any non-leaf account regardless of whether its children appear
   * in this range, so the postable-leaf detection needs the full chart structure.
   */
  const parentIds = new Set(accounts.map((a) => a.parentId).filter((id): id is string => id !== null));
  const sums = new Map(grouped.map((g) => [g.chartAccountId, g]));

  const rows: BalanceRow[] = [];
  for (const account of accounts) {
    const sum = sums.get(account.id);
    const debit = Number(sum?._sum.debit ?? 0);
    const credit = Number(sum?._sum.credit ?? 0);
    const type = account.type as AccountType;
    const hasMovement = debit !== 0 || credit !== 0;

    if (!account.isActive && !hasMovement) continue;

    rows.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      type,
      parentId: account.parentId,
      depth: account.depth,
      isActive: account.isActive,
      hasChildren: parentIds.has(account.id),
      debit,
      credit,
      signed: signedDelta(type, debit, credit),
    });
  }

  return rows;
}

/**
 * The oldest POSTED journal, used by Neraca to decide whether to warn that
 * opening balances were never recorded. An opening-balance journal is either
 * entered by hand or posted by the opening-balance wizard (`OPENING…`) and
 * dated before everything else, so either suppresses the warning — see
 * `adalahJurnalSaldoAwal`. Returns null when no journal exists at all.
 */
export async function getEarliestJournal(): Promise<{ date: Date; isManual: boolean; sourceType: string | null } | null> {
  const first = await prisma.journal.findFirst({
    where: SARING_JURNAL_BERLAKU,
    orderBy: { date: "asc" },
    select: { date: true, isManual: true, sourceType: true },
  });
  return first ?? null;
}

/** Jurnal paling awal yang menandai saldo awal sudah dicatat: manual, atau dari wizard saldo awal. */
export function adalahJurnalSaldoAwal(j: { isManual: boolean; sourceType?: string | null }): boolean {
  return j.isManual || (j.sourceType ?? "").startsWith(AWALAN_SUMBER_SALDO_AWAL);
}
