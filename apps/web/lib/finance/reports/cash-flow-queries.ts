import { prisma } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { resolveCashFlowSection, type CashFlowSection } from "./cash-flow-classify";

export type AccountSectionRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  override: CashFlowSection | null;
  derived: CashFlowSection | null;
  roles: PostingRole[];
};

/**
 * Every POSTABLE LEAF account with its stored override, the roles mapped to it,
 * and the section actually in force. `derived` is what the deriver returns when
 * the override is ignored, so the Klasifikasi page can show the default a
 * cleared override would fall back to.
 *
 * Non-leaf and inactive accounts are excluded, and both callers want that. A
 * non-leaf can never be posted to, so classifying one is inert for every
 * section — and actively wrong for KAS, because the operator reasonably reads
 * a parent as classifying the group beneath it. Tagging `11 Kas dan Bank` as
 * KAS used to silence its `1101`/`1102` leaves out of the cash bucket while
 * contributing a cash delta of zero, which reported no cash at all under a
 * green "reconciled" note.
 *
 * The parent set is derived from the FULL chart rather than the active subset,
 * which is where this deviates from `getPostableAccounts`
 * (`apps/web/lib/finance/coa/queries.ts`). `postJournal` looks up children with
 * no `isActive` filter (`packages/db/src/journal-writer.ts`), so an account
 * whose only children are inactive is still rejected at write time; deriving
 * the set the narrower way would classify an account nothing can ever post to.
 */
export async function listAccountSections(): Promise<AccountSectionRow[]> {
  const [accounts, mappings] = await Promise.all([
    prisma.chartAccount.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        cashFlowSection: true,
        isActive: true,
        parentId: true,
      },
    }),
    prisma.journalAccountMapping.findMany({
      select: { role: true, chartAccountId: true },
    }),
  ]);

  const parentIds = new Set(
    accounts.map((account) => account.parentId).filter((id): id is string => id !== null),
  );
  const postable = accounts.filter(
    (account) => account.isActive && !parentIds.has(account.id),
  );

  const rolesByAccount = new Map<string, PostingRole[]>();
  for (const mapping of mappings) {
    const list = rolesByAccount.get(mapping.chartAccountId) ?? [];
    list.push(mapping.role as PostingRole);
    rolesByAccount.set(mapping.chartAccountId, list);
  }

  return postable.map((account) => {
    const type = account.type as AccountType;
    const roles = rolesByAccount.get(account.id) ?? [];
    const override = (account.cashFlowSection ?? null) as CashFlowSection | null;
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type,
      override,
      derived: resolveCashFlowSection({ type, roles }),
      roles,
    };
  });
}

/**
 * Section in force per account, which is what the statement engine consumes.
 *
 * Keyed on postable leaves only, so a balance row with no entry here — a parent
 * that carried journal lines before it gained children, or an account since
 * deactivated — resolves to null and lands in the engine's unclassified bucket.
 * That bucket is inside `netChange`, so the reconciliation identity survives:
 * the delta is still counted exactly once, it just renders separately.
 */
export async function getSectionByAccountId(): Promise<Map<string, CashFlowSection | null>> {
  const rows = await listAccountSections();
  return new Map(
    rows.map((row) => [
      row.accountId,
      resolveCashFlowSection({ type: row.type, override: row.override, roles: row.roles }),
    ]),
  );
}

/**
 * Cumulative cash balance strictly before the reporting window opens.
 *
 * Only cash accounts are summed, and every cash account is ASET, so the signed
 * balance is simply debit minus credit. Both routes to KAS enforce that: the
 * BANK and CASH posting roles are pinned to ASET by
 * `POSTING_ROLE_ACCOUNT_TYPES`, and `setCashFlowSectionAction` refuses a KAS
 * override on anything else. An omitted `before` means the report runs since
 * inception, where the opening balance is zero by definition.
 */
export async function getCashOpeningBalance(
  before: Date | undefined,
  cashAccountIds: string[],
): Promise<number> {
  if (!before || cashAccountIds.length === 0) return 0;

  const grouped = await prisma.journalLine.groupBy({
    by: ["chartAccountId"],
    _sum: { debit: true, credit: true },
    where: {
      chartAccountId: { in: cashAccountIds },
      journal: { date: { lte: before } },
    },
  });

  const cents = grouped.reduce(
    (total, group) =>
      total +
      Math.round(Number(group._sum.debit ?? 0) * 100) -
      Math.round(Number(group._sum.credit ?? 0) * 100),
    0,
  );
  return cents / 100;
}
