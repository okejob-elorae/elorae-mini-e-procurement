"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { assignCollector } from "@/lib/finance/collections/assign-writer";
import { submitCollection } from "@/lib/finance/collections/submit-writer";
import { verifyCollection } from "@/lib/finance/collections/verify-writer";
import { rejectCollection } from "@/lib/finance/collections/reject-writer";
import { CollectionError, type CollectionErrorCode } from "@/lib/finance/collections/errors";
import { PaymentError, type PaymentErrorCode } from "@/lib/finance/ar/errors";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postPaymentReceiptJournal } from "@/lib/finance/ar/payment-journal";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";

export type CollectionActionReason =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | CollectionErrorCode
  | PaymentErrorCode;

export type CollectionActionResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; reason: CollectionActionReason };

async function guardManage(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

async function guardCollect(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_COLLECT)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

async function guardVerify(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.PAYMENTS_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

function toCollectionResult(e: unknown): { ok: false; reason: CollectionActionReason } {
  if (e instanceof CollectionError) return { ok: false, reason: e.code };
  if (e instanceof PaymentError) return { ok: false, reason: e.code };
  return { ok: false, reason: "INVALID_REQUEST" };
}

/**
 * Anchors a "YYYY-MM-DD" calendar day to WIB midnight and rejects anything that doesn't
 * round-trip exactly — same guard `recordPaymentAction` uses for the same `Payment.paidAt`
 * field, so a collector's submitted date can't produce a different GL date than the backoffice
 * payment-recording path would for the same string.
 */
function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === trimmed ? parsed : null;
}

export async function assignCollectorAction(input: {
  receivableIds: string[];
  collectorId: string | null;
}): Promise<CollectionActionResult> {
  const g = await guardManage();
  if ("ok" in g) return g;
  try {
    const result = await assignCollector({
      receivableIds: input.receivableIds,
      collectorId: input.collectorId,
      assignedById: g.userId,
    });
    revalidatePath("/backoffice/finance/piutang");
    revalidatePath("/backoffice/finance/collections");
    return { ok: true, assignedCount: result.assignedCount };
  } catch (e) {
    return toCollectionResult(e);
  }
}

/**
 * Bulk-assigns (or unassigns) a collector across a store's currently outstanding receivables.
 * Reads the id list here and calls `assignCollector` directly rather than going through
 * `assignCollectorAction`, to avoid double-guarding on `guardManage()`. `assignCollector` throws
 * `EMPTY_TARGETS` itself when the store has no outstanding receivable — same handling as every
 * other reason via `toCollectionResult`.
 */
export async function bulkAssignStoreAction(
  storeId: string,
  collectorId: string | null,
): Promise<CollectionActionResult> {
  const g = await guardManage();
  if ("ok" in g) return g;
  try {
    const receivables = await prisma.receivable.findMany({
      where: { storeId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
      select: { id: true },
    });
    const result = await assignCollector({
      receivableIds: receivables.map((r) => r.id),
      collectorId,
      assignedById: g.userId,
    });
    revalidatePath("/backoffice/finance/piutang");
    revalidatePath("/backoffice/finance/collections");
    return { ok: true, assignedCount: result.assignedCount };
  } catch (e) {
    return toCollectionResult(e);
  }
}

export async function submitCollectionAction(input: {
  receivableId: string;
  amount: number;
  method: "CASH" | "TRANSFER";
  paidAt: string;
  note?: string;
  proofUrl?: string;
  proofR2Key?: string;
  idempotencyKey?: string;
}): Promise<CollectionActionResult> {
  const g = await guardCollect();
  if ("ok" in g) return g;

  /* Same reasoning as submitCollection's own guard — this boundary is reachable by a raw
     request that never went through the TS parameter type at all. */
  const method: unknown = input.method;
  if (method !== "CASH" && method !== "TRANSFER") return { ok: false, reason: "INVALID_METHOD" };

  const paidAt = parseCalendarDay(input.paidAt);
  if (!paidAt) return { ok: false, reason: "INVALID_REQUEST" };
  try {
    const result = await submitCollection({
      receivableId: input.receivableId,
      collectorId: g.userId,
      amount: input.amount,
      method: input.method,
      paidAt,
      note: input.note,
      proofUrl: input.proofUrl,
      proofR2Key: input.proofR2Key,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/pwa/collections");
    return { ok: true, submissionId: result.submissionId };
  } catch (e) {
    return toCollectionResult(e);
  }
}

export async function verifyCollectionAction(submissionId: string): Promise<CollectionActionResult> {
  const g = await guardVerify();
  if ("ok" in g) return g;
  let paymentId: string;
  let alreadyVerified = false;
  try {
    const result = await verifyCollection({ submissionId, verifiedById: g.userId });
    paymentId = result.paymentId;
    alreadyVerified = result.alreadyVerified ?? false;
  } catch (e) {
    return toCollectionResult(e);
  }
  /*
   * Posted unconditionally, including on the `alreadyVerified` short-circuit: `postJournal`
   * underneath `postPaymentReceiptJournal` is idempotent on `Journal @@unique([sourceType, sourceId])`
   * and simply returns `created: false` for an entry that already exists, so a repost is a safe
   * no-op. That is what makes a crashed verify-then-retry converge — before this, the retry hit
   * the short-circuit, carried no payment id, and left the payment forever un-journaled.
   */
  await postArJournalSafely("ar_payment", paymentId, () => postPaymentReceiptJournal(paymentId, g.userId));
  revalidatePath("/backoffice/finance/collections");
  revalidatePath("/backoffice/finance/piutang");
  return { ok: true, alreadyVerified };
}

export async function rejectCollectionAction(submissionId: string, reason: string): Promise<CollectionActionResult> {
  const g = await guardVerify();
  if ("ok" in g) return g;
  if (typeof reason !== "string" || reason.trim() === "") return { ok: false, reason: "INVALID_REQUEST" };
  try {
    await rejectCollection({ submissionId, reason, rejectedById: g.userId });
  } catch (e) {
    return toCollectionResult(e);
  }
  revalidatePath("/backoffice/finance/collections");
  return { ok: true };
}
