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
 * caller's CAS runs first flips the row; the other's `updateMany` matches zero rows, and only
 * THEN does it re-read to decide: the row landed on VERIFIED with our payment id (the safe
 * race, reported as `alreadyVerified`), or it landed somewhere else — e.g. REJECTED by a
 * concurrent reject — in which case the payment above is real but orphaned, and this throws
 * loudly instead of lying about success.
 */
export async function verifyCollection(input: {
  submissionId: string;
  verifiedById: string;
}): Promise<{ ok: true; paymentId: string; alreadyVerified?: true }> {
  const submission = await prisma.collectionSubmission.findUnique({
    where: { id: input.submissionId },
    select: { id: true, status: true, receivableId: true, amount: true, method: true, paidAt: true, proofUrl: true, proofR2Key: true, paymentId: true },
  });
  if (!submission) throw new CollectionError("NOT_FOUND");
  if (submission.status === "VERIFIED") {
    if (!submission.paymentId) throw new CollectionError("NOT_PENDING");
    return { ok: true, paymentId: submission.paymentId, alreadyVerified: true };
  }
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
    method: submission.method,
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
  if (flipped.count === 0) {
    /*
     * Zero rows matched does NOT always mean "a concurrent verify already flipped this to
     * VERIFIED" — CollectionSubmissionStatus also has REJECTED, and a concurrent reject
     * between our initial read and this CAS produces the exact same zero-count result. By
     * this point `recordPayment` above has already committed a real Payment/PaymentAllocation
     * and decremented outstandingAmount, so silently reporting alreadyVerified here would hide
     * a payment now orphaned from a rejected submission. Re-read and only treat this as the
     * safe race (report success) when the row genuinely landed on VERIFIED with OUR payment id
     * — anything else throws loudly so it surfaces for human reconciliation instead of lying.
     */
    const current = await prisma.collectionSubmission.findUnique({
      where: { id: submission.id },
      select: { status: true, paymentId: true },
    });
    if (current?.status === "VERIFIED" && current.paymentId === paymentId) {
      return { ok: true, paymentId, alreadyVerified: true };
    }
    /*
     * The payment above is real and committed, but the submission landed somewhere else — most
     * likely REJECTED by a concurrent reject. This is a genuine data anomaly (a payment posted
     * against a rejected claim), not a routine race. Log it loudly so it surfaces for manual
     * reconciliation instead of vanishing into a generic error toast — the comment on this
     * function already promises this, this line is what keeps that promise.
     */
    console.error(`[verifyCollection] orphaned payment: submission ${submission.id} landed on status=${current?.status ?? "MISSING"} after payment ${paymentId} was posted (expected VERIFIED)`);
    throw new CollectionError("NOT_PENDING");
  }

  return { ok: true, paymentId };
}
