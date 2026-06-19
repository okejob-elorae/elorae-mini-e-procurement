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

  return withLockAndRevalidate(salesReturnId, async () =>
    prisma.$transaction(async (tx) => {
      const r = await submitReturnDecision(tx, {
        salesReturnId,
        changedById: authResult.userId,
      });
      if (r.applied) return { ok: true } as const;
      return { ok: false, reason: r.skipped } as const;
    }),
  );
}
