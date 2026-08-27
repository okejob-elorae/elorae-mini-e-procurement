"use server";

import { revalidatePath } from "next/cache";
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
  const paidAt = new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime())) return { ok: false, reason: "INVALID_REQUEST" };
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
  let paymentId: string | undefined;
  try {
    const result = await verifyCollection({ submissionId, verifiedById: g.userId });
    if ("paymentId" in result) paymentId = result.paymentId;
  } catch (e) {
    return toCollectionResult(e);
  }
  if (paymentId) {
    await postArJournalSafely("ar_payment", paymentId, () => postPaymentReceiptJournal(paymentId!, g.userId));
  }
  revalidatePath("/backoffice/finance/collections");
  revalidatePath("/backoffice/finance/piutang");
  return { ok: true };
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
