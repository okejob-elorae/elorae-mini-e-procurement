import { prisma } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { resolveCashFlowSection, type CashFlowSection } from "./cash-flow-classify";

export type AccountSectionRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  isActive: boolean;
  override: CashFlowSection | null;
  derived: CashFlowSection | null;
  roles: PostingRole[];
};

/**
 * Every LEAF account with its stored override, the roles mapped to it, and the
 * section actually in force. `derived` is what the deriver returns when the
 * override is ignored, so the Klasifikasi page can show the default a cleared
 * override would fall back to.
 *
 * Non-leaf accounts are excluded, and both callers want that. A non-leaf can
 * never be posted to, so classifying one is inert for every section — and
 * actively wrong for KAS, because the operator reasonably reads a parent as
 * classifying the group beneath it. Tagging `11 Kas dan Bank` as KAS used to
 * silence its `1101`/`1102` leaves out of the cash bucket while contributing a
 * cash delta of zero, which reported no cash at all under a green "reconciled"
 * note.
 *
 * INACTIVE leaves are deliberately KEPT. `getAccountBalances` retains an
 * inactive account that still carries movement in range, so its rows reach the
 * engine either way; dropping it HERE would only strip its section, which is
 * exactly the damaging half.
 *
 * The harm is the Finding 1a class — silently wrong figures under a green
 * reconciled note — NOT a false alarm. Do not expect a banner and conclude this
 * paragraph is paranoid: `isReconciled` CANNOT break this way. Every
 * classifiable non-KAS row contributes `-(debit - credit)` (ASET negates
 * `signed`; credit-normal types have `signed = -(debit - credit)` and add it),
 * and `labaBersih` is `-(debit - credit)` summed over the P&L rows, so
 * `netChange` always equals `Σ(debit - credit)` over the KAS partition — which
 * is `cashDelta`. Moving an account between the buckets changes both sides
 * together. What it does NOT change is `cashAccountIds`, which is built from
 * this map: an excluded cash account drops out of `getCashOpeningBalance`, so
 * `kasAwal` loses its whole pre-window balance while `netChange` loses only its
 * in-range movement, and `kasAkhir` is understated by the sum of the two with
 * nothing visibly amiss. Concretely: `1102 Bank Lama`, inactive, KAS override,
 * 5.000.000 carried in and a 1.000.000 debit in range — closing cash prints
 * 2.000.000 against a true 8.000.000, and the statement still certifies itself.
 *
 * Classifying an inactive leaf is legitimate in its own right, too: its
 * historical balance still belongs to a section for any report covering a
 * period when it was live. That is worth more than the noise of listing a few
 * dead accounts on the classification page, where the row is merely dimmed.
 *
 * The parent set is therefore the only filter, and it is derived from the FULL
 * chart. That is where this deviates from `getPostableAccounts`
 * (`apps/web/lib/finance/coa/queries.ts`), which collects parent ids from the
 * active subset only. `postJournal` looks up children with no `isActive` filter
 * (`packages/db/src/journal-writer.ts`), so an account whose only children are
 * inactive is still rejected at write time; deriving the set the narrower way
 * would classify an account nothing can ever post to.
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
  const leaves = accounts.filter((account) => !parentIds.has(account.id));

  const rolesByAccount = new Map<string, PostingRole[]>();
  for (const mapping of mappings) {
    const list = rolesByAccount.get(mapping.chartAccountId) ?? [];
    list.push(mapping.role as PostingRole);
    rolesByAccount.set(mapping.chartAccountId, list);
  }

  return leaves.map((account) => {
    const type = account.type as AccountType;
    const roles = rolesByAccount.get(account.id) ?? [];
    const override = (account.cashFlowSection ?? null) as CashFlowSection | null;
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      isActive: account.isActive,
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
 * Keyed on leaves only, so the one balance row that can miss an entry here is a
 * parent that carried journal lines before it gained children. It resolves to
 * null and lands in the engine's unclassified bucket, which is inside
 * `netChange`, so the reconciliation identity survives: the delta is still
 * counted exactly once, it just renders separately. Inactive leaves ARE keyed,
 * so a deactivated cash account keeps contributing to `cashAccountIds` and to
 * `kasAwal` — see `listAccountSections` for why that matters.
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
 * Only cash accounts are summed, and the balance is read as debit minus credit.
 * Both routes to KAS constrain that to ASET: the BANK and CASH posting roles
 * are pinned to ASET by `POSTING_ROLE_ACCOUNT_TYPES`, and
 * `setCashFlowSectionAction` refuses a KAS override on anything else.
 *
 * Those guards are WRITE-TIME ONLY, though — nothing migrates a
 * `cashFlowSection = 'KAS'` already stored on a non-ASET account, so a legacy
 * override can still reach this query. It computes correctly anyway: this query
 * and the engine's KAS accumulation now share the debit-minus-credit
 * orientation, so a credit-normal cash account is read consistently on both
 * sides rather than sign-flipped on one. Treat "every cash account is ASET" as
 * the intent, not as an invariant the data guarantees.
 *
 * An omitted `before` means the report runs since inception, where the opening
 * balance is zero by definition.
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
