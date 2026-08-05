"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordVanSale } from "@/lib/canvassing/sale-writer";
import { postVanJournalSafely } from "@/lib/canvassing/post-van-journal-safely";
import { postVanSaleJournal } from "@/lib/canvassing/van-journal";
import { isJournalRetryable } from "@/lib/canvassing/journal-pending";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

export type RecordVanSaleActionResult =
  | { ok: true; saleId: string; docNo: string; changeAmount: number }
  | { ok: false; reason: "UNAUTHORIZED" | "EMPTY" | "NO_PRICE" | "INSUFFICIENT_PAYMENT" | "INSUFFICIENT_VAN_STOCK" | "VALIDATION"; shortLines?: Array<{ itemId: string; variantSku: string | null; requested: number; available: number }> };

const schema = z.object({
  storeId: z.string().nullable(),
  buyerName: z.string().max(191).nullable(),
  buyerPhone: z.string().max(64).nullable(),
  saleLat: z.number().min(-90).max(90).nullable(),
  saleLng: z.number().min(-180).max(180).nullable(),
  amountPaid: z.number().min(0),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1),
  lines: z.array(z.object({ itemId: z.string().min(1), variantSku: z.string().nullable(), qty: z.number().positive() })).min(1),
});

export async function recordVanSaleAction(input: unknown): Promise<RecordVanSaleActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "UNAUTHORIZED" };
  const d = parsed.data;
  const res = await recordVanSale({
    salesmanId: session.user.id, storeId: d.storeId, buyerName: d.buyerName, buyerPhone: d.buyerPhone,
    saleLat: d.saleLat, saleLng: d.saleLng, lines: d.lines, amountPaid: d.amountPaid, note: d.note, idempotencyKey: d.idempotencyKey,
  });
  if (res.ok) {
    await postVanJournalSafely("sale", res.saleId, () => postVanSaleJournal(res.saleId, session.user.id));
    return { ok: true, saleId: res.saleId, docNo: res.docNo, changeAmount: res.changeAmount };
  }
  if (res.code === "INSUFFICIENT_VAN_STOCK") return { ok: false, reason: "INSUFFICIENT_VAN_STOCK", shortLines: res.shortLines };
  return { ok: false, reason: res.code };
}

/**
 * Permission-gated retry: re-posts a van sale journal that failed at sale time
 * (e.g. `CASH`/`INVENTORY_VAN` were unmapped). Idempotent — `generateAutoJournal`
 * no-ops if the journal already exists.
 */
export async function postVanSaleJournalAction(
  vanSaleId: string,
): Promise<GenerateAutoJournalResult | { ok: false; code: "FORBIDDEN" | "BAD_STATE" | "NOT_RETRYABLE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const sale = await prisma.vanSale.findUnique({ where: { id: vanSaleId }, select: { id: true } });
  if (!sale) return { ok: false, code: "BAD_STATE" };

  /**
   * Mirrors the read-path invariant enforced by `findPostableJournalDocIds`
   * (`lib/canvassing/journal-pending.ts`): this van sale may only be journaled
   * retroactively if a `JOURNAL_PENDING` notification proves auto-posting was
   * attempted and failed for THIS document. The query layer's
   * `hasPostableJournal` only controls whether the backoffice UI renders the
   * retry button — it is not itself a guard, since this action is reachable
   * directly by anyone with `journals:manage` regardless of what the UI
   * shows. Do not remove this as "redundant" with the UI check.
   */
  if (!(await isJournalRetryable("van_sale", vanSaleId))) {
    return { ok: false, code: "NOT_RETRYABLE" };
  }

  const r = await postVanSaleJournal(vanSaleId, session.user.id);
  revalidatePath(`/backoffice/van-sales/${vanSaleId}`);
  return r;
}
