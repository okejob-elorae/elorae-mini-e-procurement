"use server";

import { revalidatePath } from "next/cache";
import {
  prisma,
  acceptReturnItem,
  rejectReturnItem,
  submitReturnDecision,
} from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { withSalesReturnLock, SalesReturnLockBusyError } from "@/lib/redis/lock";
import { postSalesReturnRevenueJournal, postSalesReturnCogsJournal } from "@/lib/finance/sales/sales-return-journal";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

export type DecisionActionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "locked"
        | "already_decided"
        | "unmapped_sku"
        | "return_locked"
        | "no_inventory_row"
        | "items_still_pending"
        | "no_items"
        | "already_submitted"
        | "internal_error";
    };

async function checkAuth(): Promise<{ userId: string; allowed: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { userId: "", allowed: false };
  return {
    userId: session.user.id,
    allowed: hasPermission(session.user.permissions ?? [], PERMISSIONS.SALES_RETURNS_DECIDE),
  };
}

async function withLockAndRevalidate(
  salesReturnId: string,
  fn: () => Promise<DecisionActionResult>,
): Promise<DecisionActionResult> {
  try {
    const result = await withSalesReturnLock(salesReturnId, fn);
    revalidatePath(`/backoffice/returns/${salesReturnId}`);
    return result;
  } catch (err) {
    if (err instanceof SalesReturnLockBusyError) return { ok: false, reason: "locked" };
    console.error("[salesreturn] action failed", err);
    return { ok: false, reason: "internal_error" };
  }
}

async function findReturnIdFromItem(returnItemId: string): Promise<string | null> {
  const item = await prisma.salesReturnItem.findUnique({
    where: { id: returnItemId },
    select: { salesReturnId: true },
  });
  return item?.salesReturnId ?? null;
}

export async function acceptReturnItemAction(
  returnItemId: string,
  reason: string,
): Promise<DecisionActionResult> {
  const authResult = await checkAuth();
  if (!authResult.allowed) return { ok: false, reason: "forbidden" };
  const salesReturnId = await findReturnIdFromItem(returnItemId);
  if (!salesReturnId) return { ok: false, reason: "already_decided" };

  return withLockAndRevalidate(salesReturnId, async () =>
    prisma.$transaction(async (tx) => {
      const r = await acceptReturnItem(tx, {
        returnItemId,
        reason,
        changedById: authResult.userId,
      });
      if (r.applied) return { ok: true } as const;
      return { ok: false, reason: r.skipped } as const;
    }),
  );
}

export async function rejectReturnItemAction(
  returnItemId: string,
  reason: string,
): Promise<DecisionActionResult> {
  const authResult = await checkAuth();
  if (!authResult.allowed) return { ok: false, reason: "forbidden" };
  const salesReturnId = await findReturnIdFromItem(returnItemId);
  if (!salesReturnId) return { ok: false, reason: "already_decided" };

  return withLockAndRevalidate(salesReturnId, async () =>
    prisma.$transaction(async (tx) => {
      const r = await rejectReturnItem(tx, {
        returnItemId,
        reason,
        changedById: authResult.userId,
      });
      if (r.applied) return { ok: true } as const;
      return { ok: false, reason: r.skipped } as const;
    }),
  );
}

export async function submitReturnDecisionAction(
  salesReturnId: string,
): Promise<DecisionActionResult> {
  const authResult = await checkAuth();
  if (!authResult.allowed) return { ok: false, reason: "forbidden" };

  const result = await withLockAndRevalidate(salesReturnId, async () =>
    prisma.$transaction(async (tx) => {
      const r = await submitReturnDecision(tx, {
        salesReturnId,
        changedById: authResult.userId,
      });
      if (r.applied) return { ok: true } as const;
      return { ok: false, reason: r.skipped } as const;
    }),
  );

  if (result.ok) {
    for (const [kind, post] of [
      ["revenue", postSalesReturnRevenueJournal],
      ["cogs", postSalesReturnCogsJournal],
    ] as const) {
      try {
        const jr = await post(salesReturnId, authResult.userId);
        if (!jr.ok && jr.code !== "NOTHING_TO_POST") {
          await prisma.adminNotification.create({
            data: {
              category: "JOURNAL_PENDING",
              severity: "WARNING",
              title: "Sales return journal not posted",
              message: `Sales return ${kind} journal could not be posted (${jr.code}${jr.role ? `: ${jr.role}` : ""}). Map the account, then post from the return.`,
              metadata: { salesReturnId, kind, reason: jr.code, role: jr.role ?? null },
            },
          });
        }
      } catch (e) {
        try {
          await prisma.adminNotification.create({
            data: {
              category: "JOURNAL_PENDING",
              severity: "WARNING",
              title: "Sales return journal errored",
              message: `Sales return ${kind} journal errored (${e instanceof Error ? e.message : "unknown"}).`,
              metadata: { salesReturnId, kind, reason: "ERROR", role: null },
            },
          });
        } catch {
          // best-effort: never change the decision result on a journal/notification failure
        }
      }
    }
  }

  return result;
}

export async function postSalesReturnJournalsAction(
  salesReturnId: string,
): Promise<GenerateAutoJournalResult | { ok: false; code: "FORBIDDEN" | "BAD_STATE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const ret = await prisma.salesReturn.findUnique({ where: { id: salesReturnId }, select: { decidedAt: true } });
  if (!ret || ret.decidedAt == null) return { ok: false, code: "BAD_STATE" };
  const rev = await postSalesReturnRevenueJournal(salesReturnId, session.user.id);
  const cogs = await postSalesReturnCogsJournal(salesReturnId, session.user.id);
  revalidatePath(`/backoffice/returns/${salesReturnId}`);
  const firstErr = [rev, cogs].find((r) => !r.ok && r.code !== "NOTHING_TO_POST");
  return firstErr ?? { ok: true };
}
