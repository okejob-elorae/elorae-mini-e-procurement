"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordVanReconcile } from "@/lib/canvassing/reconcile-writer";
import { postVanJournalSafely } from "@/lib/canvassing/post-van-journal-safely";
import { postVanReconcileJournal } from "@/lib/canvassing/van-journal";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

export type RecordVanReconcileActionResult =
  | { ok: true; docNo: string; totalReturned: number; totalVarianceQty: number }
  | { ok: false; reason: "FORBIDDEN" | "EMPTY_VAN" | "VARIANCE_NEEDS_REASON" | "COUNT_MISMATCH" | "VALIDATION" };

const schema = z.object({
  canvasserId: z.string().min(1),
  note: z.string().max(500).optional(),
  counts: z.array(z.object({ itemId: z.string().min(1), variantSku: z.string().nullable(), countedQty: z.number().min(0) })).min(1),
});

export async function recordVanReconcileAction(input: unknown): Promise<RecordVanReconcileActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.CANVASSING_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const res = await recordVanReconcile({ canvasserId: parsed.data.canvasserId, reconciledById: session.user.id, counts: parsed.data.counts, note: parsed.data.note });
  if (res.ok) {
    await postVanJournalSafely("reconcile", res.reconcileId, () => postVanReconcileJournal(res.reconcileId, session.user.id));
    revalidatePath("/backoffice/canvassing");
    revalidatePath(`/backoffice/canvassing/${parsed.data.canvasserId}`);
    return { ok: true, docNo: res.docNo, totalReturned: res.totalReturned, totalVarianceQty: res.totalVarianceQty };
  }
  return { ok: false, reason: res.code };
}

/**
 * Permission-gated retry: re-posts a van reconcile journal that failed at
 * reconcile time (e.g. `INVENTORY_VAN`/`INVENTORY_VARIANCE` were unmapped).
 * Idempotent — `generateAutoJournal` no-ops if the journal already exists.
 */
export async function postVanReconcileJournalAction(
  vanReconcileId: string,
): Promise<GenerateAutoJournalResult | { ok: false; code: "FORBIDDEN" | "BAD_STATE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const recon = await prisma.vanReconcile.findUnique({ where: { id: vanReconcileId }, select: { canvasserId: true } });
  if (!recon) return { ok: false, code: "BAD_STATE" };

  const r = await postVanReconcileJournal(vanReconcileId, session.user.id);
  revalidatePath(`/backoffice/canvassing/reconcile/${vanReconcileId}`);
  revalidatePath(`/backoffice/canvassing/${recon.canvasserId}`);
  return r;
}
