"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { AccountType } from "@/lib/constants/enums";
import {
  CASH_FLOW_SECTIONS,
  isClassifiableType,
  type CashFlowSection,
} from "@/lib/finance/reports/cash-flow-classify";

type Result =
  | { ok: true }
  | {
      ok: false;
      code:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "NOT_CLASSIFIABLE"
        | "INVALID_SECTION"
        | "KAS_REQUIRES_ASET";
    };

async function assertCanManage(): Promise<boolean> {
  const session = await auth();
  if (!session) return false;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE);
}

/**
 * Returns a result object rather than throwing: a thrown server-action error
 * is digest-masked in production, which would leave the operator with no idea
 * which condition they hit.
 */
export async function setCashFlowSectionAction(
  accountId: string,
  section: CashFlowSection,
): Promise<Result> {
  if (!(await assertCanManage())) return { ok: false, code: "FORBIDDEN" };
  if (!CASH_FLOW_SECTIONS.includes(section)) return { ok: false, code: "INVALID_SECTION" };

  const account = await prisma.chartAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });
  if (!account) return { ok: false, code: "NOT_FOUND" };

  /* Revenue, cost and expense accounts are inside net income and never carry a section. */
  const type = account.type as AccountType;
  if (!isClassifiableType(type)) {
    return { ok: false, code: "NOT_CLASSIFIABLE" };
  }

  /**
   * KAS is restricted to ASET, mirroring how `POSTING_ROLE_ACCOUNT_TYPES` pins
   * the BANK and CASH roles. Everything downstream reads a cash account on the
   * debit-minus-credit orientation — `getCashOpeningBalance` sums it that way
   * and the engine accumulates it that way — while the balance rows carry
   * `signed`, which flips for credit-normal types. Tagging a LIABILITAS account
   * as KAS therefore double-counts its movement against `netChange` and fires
   * the "corrupt journal data" banner on a perfectly balanced ledger.
   *
   * A bank overdraft inside cash and cash equivalents is legitimate under
   * IAS 7, so this refuses a real accounting configuration. Supporting it means
   * orienting the whole cash path off `AccountType`, not relaxing this check.
   */
  if (section === "KAS" && type !== "ASET") {
    return { ok: false, code: "KAS_REQUIRES_ASET" };
  }

  await prisma.chartAccount.update({
    where: { id: accountId },
    data: { cashFlowSection: section },
  });
  revalidatePath("/backoffice/finance/cash-flow-sections");
  return { ok: true };
}

export async function clearCashFlowSectionAction(accountId: string): Promise<Result> {
  if (!(await assertCanManage())) return { ok: false, code: "FORBIDDEN" };

  const account = await prisma.chartAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) return { ok: false, code: "NOT_FOUND" };

  await prisma.chartAccount.update({
    where: { id: accountId },
    data: { cashFlowSection: null },
  });
  revalidatePath("/backoffice/finance/cash-flow-sections");
  return { ok: true };
}
