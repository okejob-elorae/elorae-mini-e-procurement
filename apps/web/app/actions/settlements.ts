"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { matchSettlement } from "@/lib/finance/settlement/match";
import { postSettlementJournal, type PostSettlementJournalResult } from "@/lib/finance/settlement/journal";

export type MatchSettlementActionResult =
  | { ok: true; matched: number; unmatched: number; profitPending: number }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" };

export async function matchSettlementAction(settlementId: string): Promise<MatchSettlementActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const settlement = await prisma.settlement.findUnique({ where: { id: settlementId }, select: { id: true } });
  if (!settlement) return { ok: false, reason: "NOT_FOUND" };

  const result = await matchSettlement(settlementId);
  revalidatePath(`/backoffice/finance/settlements/${settlementId}`);
  return { ok: true, ...result };
}

export async function postSettlementJournalAction(
  settlementId: string,
): Promise<PostSettlementJournalResult | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const settlement = await prisma.settlement.findUnique({ where: { id: settlementId }, select: { id: true } });
  if (!settlement) return { ok: false, code: "NOT_FOUND" };

  const result = await postSettlementJournal(settlementId, session.user.id);
  revalidatePath(`/backoffice/finance/settlements/${settlementId}`);
  return result;
}
