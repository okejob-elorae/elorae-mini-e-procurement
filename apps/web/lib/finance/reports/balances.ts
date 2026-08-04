import { prisma } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import { signedDelta } from "@/lib/finance/journals/normal-side";

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

/**
 * Per-account debit/credit sums over a date range, joined onto the chart of
 * accounts. `from` omitted means since inception — Neraca uses that form,
 * Trial Balance and Laba Rugi pass a closed range.
 *
 * Accounts with no movement in range are returned with zeroes so statement
 * structure stays stable across periods; callers decide whether to hide them.
 * An inactive account is kept only when it still carries movement in range,
 * because dropping it would break the debit == credit identity.
 */
export async function getAccountBalances(range: { from?: Date; to: Date }): Promise<BalanceRow[]> {
  const [accounts, grouped] = await Promise.all([
    prisma.chartAccount.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true, parentId: true, depth: true, isActive: true },
    }),
    prisma.journalLine.groupBy({
      by: ["chartAccountId"],
      _sum: { debit: true, credit: true },
      where: {
        journal: {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            lte: range.to,
          },
        },
      },
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
