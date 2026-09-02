import { type AdminNotification } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { CollectionError } from "./errors";

export type SubmitCollectionInput = {
  receivableId: string;
  collectorId: string;
  amount: number;
  method: "CASH" | "TRANSFER";
  paidAt: Date;
  note?: string;
  proofUrl?: string;
  proofR2Key?: string;
  idempotencyKey?: string;
};

const EPSILON = 1e-6;

/**
 * Records a collector's claim to have collected against a receivable. Moves no money — that
 * happens only in `verifyCollection`, after an admin confirms it.
 */
export async function submitCollection(input: SubmitCollectionInput): Promise<{ submissionId: string }> {
  /*
   * `SubmitCollectionInput.method` is typed "CASH" | "TRANSFER", but a `"use server"` action is
   * an independently callable endpoint reachable by a raw request that never went through
   * TypeScript at all — and CollectionSubmission.method now legally accepts RETUR_OFFSET at the
   * database level (PaymentMethod was widened for the payment side of this feature). A collector
   * must never be able to submit a claim for a settlement instrument only an admin's offset
   * writer may use. Cast to `unknown` first so this genuinely runs at runtime rather than being a
   * type-level comparison TypeScript would otherwise flag as impossible.
   */
  const method: unknown = input.method;
  if (method !== "CASH" && method !== "TRANSFER") throw new CollectionError("INVALID_METHOD");

  const amount = roundCents(input.amount);
  if (!(amount > 0)) throw new CollectionError("INVALID_AMOUNT");

  let notification: AdminNotification | undefined;
  const result = await runSerializable(async (tx) => {
    notification = undefined;
    if (input.idempotencyKey) {
      const existing = await tx.collectionSubmission.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) return { submissionId: existing.id };
    }

    const receivable = await tx.receivable.findUnique({
      where: { id: input.receivableId },
      select: { id: true, storeId: true, outstandingAmount: true, status: true, collectorId: true },
    });
    if (!receivable) throw new CollectionError("NOT_FOUND");
    if (receivable.collectorId !== input.collectorId) throw new CollectionError("NOT_ASSIGNED_COLLECTOR");
    if (receivable.status === "PAID" || receivable.status === "WRITTEN_OFF") throw new CollectionError("ALREADY_SETTLED");

    /**
     * Netted against PENDING submissions, computed inside this transaction via `tx` (not the
     * top-level `prisma` singleton, and not read before `runSerializable` opens). Two concurrent
     * submissions each reading a stale sum outside the transaction would both individually pass
     * the guard and together over-collect the receivable — the bug would not surface until the
     * second one is verified, by which point one real payment has already posted. `Serializable`
     * isolation plus this in-transaction read is what forces the second submission to either see
     * the first's committed row or hit a serialization conflict and retry.
     */
    const pending = await tx.collectionSubmission.findMany({
      where: { receivableId: input.receivableId, status: "PENDING" },
      select: { amount: true },
    });
    const pendingSum = pending.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Number(receivable.outstandingAmount) - pendingSum;
    if (amount - remaining > EPSILON) throw new CollectionError("OVER_COLLECTED");

    const submission = await tx.collectionSubmission.create({
      data: {
        receivableId: input.receivableId,
        collectorId: input.collectorId,
        amount,
        method: input.method,
        paidAt: input.paidAt,
        note: input.note,
        proofUrl: input.proofUrl,
        proofR2Key: input.proofR2Key,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true },
    });

    notification = await tx.adminNotification.create({
      data: {
        category: "COLLECTION_PENDING_VERIFICATION",
        severity: "INFO",
        title: `Collection submitted for receivable ${receivable.id}`,
        message: `A collection of ${amount} was submitted and is awaiting verification.`,
        metadata: { receivableId: receivable.id, submissionId: submission.id, storeId: receivable.storeId, collectorId: input.collectorId, amount },
      },
    });

    return { submissionId: submission.id };
  });

  if (notification) void fanOutAdminNotification(notification);
  return result;
}
