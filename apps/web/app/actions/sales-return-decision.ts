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

/**
 * Remedy sentence carried by the `JOURNAL_PENDING` notification, per failure
 * code. `ORIGINAL_SALE_NOT_JOURNALED` needs its own because the default remedy
 * cannot resolve it: no account mapping brings the original sale onto this
 * ledger. Naming the sweep instead keeps the notification honest about the
 * transient case — a return decided minutes before the 5-minute sales sweep
 * reaches its own order is postable shortly after, from the same button.
 */
function returnJournalRemedy(code: string): string {
  if (code === "ORIGINAL_SALE_NOT_JOURNALED") {
    return "The original sale has no journal in this ledger, so there is nothing to reverse. If the sale is on or after the GL cutover date, the sales journal sweep posts it within minutes — post from the return after that. If it is before the cutover, it is booked elsewhere by design and this return stays out of the ledger.";
  }
  return "Map the account, then post from the return.";
}

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
          const role = "role" in jr ? jr.role ?? null : null;
          await prisma.adminNotification.create({
            data: {
              category: "JOURNAL_PENDING",
              severity: "WARNING",
              title: "Sales return journal not posted",
              message: `Sales return ${kind} journal could not be posted (${jr.code}${role ? `: ${role}` : ""}). ${returnJournalRemedy(jr.code)}`,
              metadata: { salesReturnId, kind, reason: jr.code, role },
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
): Promise<
  | { ok: true; created: boolean }
  | {
      ok: false;
      code:
        | "UNMAPPED_ROLE"
        | "UNBALANCED"
        | "NOTHING_TO_POST"
        | "ORIGINAL_SALE_NOT_JOURNALED"
        | "FORBIDDEN"
        | "BAD_STATE";
      role?: string;
    }
> {
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
  if (firstErr && !firstErr.ok) return firstErr;
  const created = [rev, cogs].some((r) => r.ok && r.created);
  return { ok: true, created };
}
