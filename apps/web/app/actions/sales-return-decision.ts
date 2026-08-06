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
import {
  postSalesReturnRevenueJournal,
  postSalesReturnCogsJournal,
  type SalesReturnGateCode,
} from "@/lib/finance/sales/sales-return-journal";

/**
 * Remedy sentence carried by the `JOURNAL_PENDING` notification, per failure
 * code. The gate codes each need their own because the default remedy cannot
 * resolve any of them — no account mapping brings the original sale onto this
 * ledger — and because only ONE of them is worth waiting out. Telling the other
 * three to retry after the sweep is advice that can never come true, and nothing
 * reads `AdminNotification` to correct it later.
 */
const RETURN_JOURNAL_REMEDIES: Record<SalesReturnGateCode, string> = {
  ORIGINAL_SALE_NOT_JOURNALED_YET:
    "The original sale is on this ledger but not journaled yet. The sales journal sweep runs every 5 minutes — post from the return after it has run.",
  ORIGINAL_SALE_UNLINKED:
    "This return is not linked to its sales order, so no sale journal can be found. Waiting will not help: restore the link (a Jubelio re-ingest does it once the order exists), then post from the return.",
  ORIGINAL_SALE_OUTSIDE_LEDGER:
    "The original sale's matching journal is not on this ledger and will not be — the sale is before the GL cutover date, or that leg of it had nothing to post. Nothing to retry; this return stays out of the ledger by design.",
  GL_CUTOVER_NOT_CONFIGURED:
    "No GL cutover date is configured, so the sales journal sweep is posting nothing at all. Set the cutover date in Finance settings, then post from the return.",
};

/* `in` rather than an index-and-`??`: this takes ANY failure code, and a Record
 * lookup types as present even for the mapping codes that are not in it. */
function returnJournalRemedy(code: string): string {
  return code in RETURN_JOURNAL_REMEDIES
    ? RETURN_JOURNAL_REMEDIES[code as SalesReturnGateCode]
    : "Map the account, then post from the return.";
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
        | SalesReturnGateCode
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
