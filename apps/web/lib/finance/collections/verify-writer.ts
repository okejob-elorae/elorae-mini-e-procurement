import { prisma } from "@elorae/db";
import { recordPayment } from "@/lib/finance/ar/payment-writer";
import { CollectionError } from "./errors";

/**
 * The only place a collection's money moves. Payment first, submission flip second — the
 * deterministic idempotency key means a crash between the two is safely retryable: the retry
 * returns the SAME payment rather than creating a second one, and the whole verify converges.
 * Flipping first would strand a VERIFIED submission with no payment and no route back to post
 * one. See docs/superpowers/specs/2026-08-27-collector-assignment-design.md § verifyCollection.
 *
 * Deliberately NOT one big `runSerializable` wrapping `recordPayment` — that writer already
 * opens its own transaction, and nesting `prisma.$transaction` calls on the same client is
 * unsafe (separate connections, can deadlock). Instead: read (no tx needed — the CAS below is
 * what makes this race-safe, not this read), call `recordPayment` (self-contained,
 * idempotent), then CAS-flip in its own statement. A concurrent second `verifyCollection` call
 * for the same submission races harmlessly: both may call `recordPayment` with the SAME
 * deterministic key, and `recordPayment`'s own idempotency check (inside ITS transaction)
 * ensures only one payment is ever created — the loser gets the winner's row back. Whichever
 * caller's CAS runs first flips the row; the other's `updateMany` matches zero rows and
 * returns `alreadyVerified` rather than erroring.
 */
export async function verifyCollection(input: {
  submissionId: string;
  verifiedById: string;
}): Promise<{ ok: true; paymentId: string } | { ok: true; alreadyVerified: true }> {
  const submission = await prisma.collectionSubmission.findUnique({
    where: { id: input.submissionId },
    select: { id: true, status: true, receivableId: true, amount: true, method: true, paidAt: true, proofUrl: true, proofR2Key: true },
  });
  if (!submission) throw new CollectionError("NOT_FOUND");
  if (submission.status === "VERIFIED") return { ok: true, alreadyVerified: true };
  if (submission.status !== "PENDING") throw new CollectionError("NOT_PENDING");

  const receivable = await prisma.receivable.findUnique({
    where: { id: submission.receivableId },
    select: { storeId: true },
  });
  if (!receivable) throw new CollectionError("NOT_FOUND");

  // recordPayment itself refuses ALREADY_SETTLED / OVER_ALLOCATED / WRONG_STORE — this call
  // inherits every guard the backoffice payment sheet has. A throw here propagates unmodified
  // and the submission is left untouched at PENDING — still rejectable, nothing half-applied.
  const { paymentId } = await recordPayment({
    storeId: receivable.storeId,
    paidAt: submission.paidAt,
    method: submission.method as "CASH" | "TRANSFER",
    amount: Number(submission.amount),
    recordedById: input.verifiedById,
    allocations: [{ receivableId: submission.receivableId, amount: Number(submission.amount) }],
    proofUrl: submission.proofUrl ?? undefined,
    proofR2Key: submission.proofR2Key ?? undefined,
    idempotencyKey: `collection-${submission.id}`,
  });

  const flipped = await prisma.collectionSubmission.updateMany({
    where: { id: submission.id, status: "PENDING" },
    data: { status: "VERIFIED", paymentId, verifiedById: input.verifiedById, verifiedAt: new Date() },
  });
  if (flipped.count === 0) return { ok: true, alreadyVerified: true };

  return { ok: true, paymentId };
}
