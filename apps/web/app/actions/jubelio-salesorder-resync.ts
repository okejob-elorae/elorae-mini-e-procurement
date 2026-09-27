"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { startSettlementResync } from "@/lib/finance/settlement/start-resync";

export type ResyncSummary = {
  pending: number;
  resolving: number;
  fetching: number;
  done: number;
  notFound: number;
  dead: number;
  skipped: number;
  total: number;
};

export type ResyncSummaryResult = ({ ok: true } & ResyncSummary) | { ok: false; code: "FORBIDDEN" };

/**
 * groupBy(status) counts for a resync batch — mirrors getMigrationSummary's shape
 * (apps/web/app/actions/jubelio-bulk-migration.ts), scoped by batchId instead of a
 * 24h/enqueuedById window since a resync batch is a one-shot, user-triggered run.
 */
export async function getResyncSummary(batchId: string): Promise<ResyncSummaryResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const grouped = await prisma.jubelioSalesOrderResync.groupBy({
    by: ["status"],
    where: { batchId },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {
    PENDING: 0,
    RESOLVING: 0,
    FETCHING: 0,
    DONE: 0,
    NOT_FOUND: 0,
    DEAD: 0,
    SKIPPED: 0,
  };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return {
    ok: true,
    pending: counts.PENDING,
    resolving: counts.RESOLVING,
    fetching: counts.FETCHING,
    done: counts.DONE,
    notFound: counts.NOT_FOUND,
    dead: counts.DEAD,
    skipped: counts.SKIPPED,
    total,
  };
}

export type SettlementResyncStateResult =
  | { ok: true; rematchedAtIso: string | null; batchId: string | null; status: string | null }
  | { ok: false; code: "FORBIDDEN" };

/**
 * Read-only peek at a settlement's stamped resync batch, for the detail page's auto-rematch
 * poller: it waits for `rematchedAtIso` to go non-null after the resync batch itself goes
 * terminal, rather than polling `getResyncSummary` forever. Same permission check as
 * `getResyncSummary` — this is settlement-scoped data, not batch-scoped. `status` is read live
 * here (not from the page's own stale props) so the poller can tell a real auto-rematch apart
 * from a RECONCILED-skip even if another tab posted the journal while this one was polling.
 */
export async function getSettlementResyncState(settlementId: string): Promise<SettlementResyncStateResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const row = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: { resyncBatchId: true, resyncRematchedAt: true, status: true },
  });

  return {
    ok: true,
    rematchedAtIso: row?.resyncRematchedAt?.toISOString() ?? null,
    batchId: row?.resyncBatchId ?? null,
    status: row?.status ?? null,
  };
}

export type TriggerResyncResult =
  | { ok: true; batchId: string; seeded: number }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "NO_UNMATCHED_ORDERS" | "API_ERROR";
      message?: string;
    };

export async function triggerSettlementResyncAction(settlementId: string): Promise<TriggerResyncResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const r = await startSettlementResync(settlementId, session.user.id);
  if (!r.ok) {
    return r.code === "NO_TARGETS"
      ? { ok: false, code: "NO_UNMATCHED_ORDERS" }
      : { ok: false, code: r.code, message: r.message };
  }

  return { ok: true, batchId: r.batchId, seeded: r.seeded };
}
