"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import { salesorderNoForSettlement } from "@/lib/finance/settlement/match-key";

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

export type TriggerResyncResult =
  | { ok: true; batchId: string; seeded: number }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "NO_UNMATCHED_ORDERS" | "API_ERROR";
      message?: string;
    };

/**
 * Resolves the settlement's currently-UNMATCHED lines into Jubelio salesorderNo
 * values (via the same salesorderNoForSettlement key used by matchSettlement),
 * then triggers apps/api's POST /jubelio/salesorders/resync with that explicit
 * list. The `{settlementId, unmatchedOnly}` server-side expansion described in
 * the design doc is NOT implemented in apps/api (see
 * apps/api/src/jubelio/resync/jubelio-resync.controller.ts) — so this action
 * does the expansion here instead, server-authoritatively (never trusts a
 * client-supplied orderNo list).
 */
export async function triggerSettlementResyncAction(settlementId: string): Promise<TriggerResyncResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: { marketplace: true },
  });
  if (!settlement) return { ok: false, code: "NOT_FOUND" };

  const unmatchedLines = await prisma.settlementLine.findMany({
    where: { settlementId, matchStatus: { not: "MATCHED" } },
    select: { orderNo: true },
  });

  const salesorderNos = Array.from(
    new Set(
      unmatchedLines
        .map((l) => salesorderNoForSettlement(settlement.marketplace, l.orderNo))
        .filter((no): no is string => Boolean(no)),
    ),
  );

  if (salesorderNos.length === 0) {
    return { ok: false, code: "NO_UNMATCHED_ORDERS" };
  }

  const r = await apiFetch<{ batchId: string; seeded: number }>(
    "POST",
    "/jubelio/salesorders/resync",
    { userId: session.user.id, body: { salesorderNos } },
  );
  if (!r.ok || !r.data) {
    return {
      ok: false,
      code: "API_ERROR",
      message: extractApiMessage(r.error, `Resync trigger failed (${r.status})`),
    };
  }

  return { ok: true, batchId: r.data.batchId, seeded: r.data.seeded };
}
