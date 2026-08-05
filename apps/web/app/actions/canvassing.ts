"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { loadVan } from "@/lib/canvassing/writer";
import { postVanJournalSafely } from "@/lib/canvassing/post-van-journal-safely";
import { postVanLoadJournal } from "@/lib/canvassing/van-journal";
import { isJournalRetryable } from "@/lib/canvassing/journal-pending";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

export type LoadVanActionResult =
  | { ok: true; docNo: string }
  | { ok: false; reason: "FORBIDDEN" | "EMPTY" | "INSUFFICIENT_STOCK" | "VALIDATION"; shortLines?: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> };

const schema = z.object({
  canvasserId: z.string().min(1),
  note: z.string().max(500).optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    variantSku: z.string().nullable(),
    qty: z.number().positive(),
  })).min(1),
});

export async function loadVanAction(input: {
  canvasserId: string;
  lines: Array<{ itemId: string; variantSku: string | null; qty: number }>;
  note?: string;
}): Promise<LoadVanActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.CANVASSING_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const res = await loadVan({ canvasserId: parsed.data.canvasserId, loadedById: session.user.id, lines: parsed.data.lines, note: parsed.data.note });
  if (!res.ok) {
    if (res.code === "INSUFFICIENT_STOCK") return { ok: false, reason: "INSUFFICIENT_STOCK", shortLines: res.shortLines };
    return { ok: false, reason: "EMPTY" };
  }
  await postVanJournalSafely("load", res.loadId, () => postVanLoadJournal(res.loadId, session.user.id));
  revalidatePath("/backoffice/canvassing");
  revalidatePath(`/backoffice/canvassing/${parsed.data.canvasserId}`);
  return { ok: true, docNo: res.docNo };
}

/**
 * Permission-gated retry: re-posts a van load journal that failed at load time
 * (e.g. `CASH`/`INVENTORY_VAN` were unmapped). Idempotent — `generateAutoJournal`
 * no-ops if the journal already exists.
 */
export async function postVanLoadJournalAction(
  vanLoadId: string,
): Promise<GenerateAutoJournalResult | { ok: false; code: "FORBIDDEN" | "BAD_STATE" | "NOT_RETRYABLE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const load = await prisma.vanLoad.findUnique({ where: { id: vanLoadId }, select: { canvasserId: true } });
  if (!load) return { ok: false, code: "BAD_STATE" };

  /**
   * Mirrors the read-path invariant enforced by `findPostableJournalDocIds`
   * (`lib/canvassing/journal-pending.ts`): this van load may only be journaled
   * retroactively if a `JOURNAL_PENDING` notification proves auto-posting was
   * attempted and failed for THIS document. The query layer's
   * `hasPostableJournal` only controls whether the backoffice UI renders the
   * retry button — it is not itself a guard, since this action is reachable
   * directly by anyone with `journals:manage` regardless of what the UI
   * shows. Do not remove this as "redundant" with the UI check.
   */
  if (!(await isJournalRetryable("van_load", vanLoadId))) {
    return { ok: false, code: "NOT_RETRYABLE" };
  }

  const r = await postVanLoadJournal(vanLoadId, session.user.id);
  revalidatePath(`/backoffice/canvassing/${load.canvasserId}`);
  return r;
}
