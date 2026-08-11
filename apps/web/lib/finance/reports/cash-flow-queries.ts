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
 * Every account with its stored override, the roles mapped to it, and the
 * section actually in force. `derived` is what the deriver returns when the
 * override is ignored, so the Klasifikasi page can show the default a cleared
 * override would fall back to.
 */
export async function listAccountSections(): Promise<AccountSectionRow[]> {
  const [accounts, mappings] = await Promise.all([
    prisma.chartAccount.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true, cashFlowSection: true },
    }),
    prisma.journalAccountMapping.findMany({
      select: { role: true, chartAccountId: true },
    }),
  ]);

  const rolesByAccount = new Map<string, PostingRole[]>();
  for (const mapping of mappings) {
    const list = rolesByAccount.get(mapping.chartAccountId) ?? [];
    list.push(mapping.role as PostingRole);
    rolesByAccount.set(mapping.chartAccountId, list);
  }

  return accounts.map((account) => {
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

/** Section in force per account, which is what the statement engine consumes. */
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
 * Only cash accounts are summed, and every cash account is ASET (both the BANK
 * and CASH posting roles are constrained to it), so the signed balance is
 * simply debit minus credit. An omitted `before` means the report runs since
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
