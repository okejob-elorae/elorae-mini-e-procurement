import { prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { recordPayment } from "./payment-writer";
import { PaymentError } from "./errors";

export type ApplyReturnOffsetInput = {
  returnId: string;
  allocations: Array<{ receivableId: string; amount: number }>;
  appliedById: string;
};

const EPSILON = 1e-6;

/**
 * Flips offsetStatus AVAILABLE -> APPLIED via a guarded CAS, or confirms an already-flipped
 * retur points at OUR OWN paymentId (the safe race / retry-after-crash case). Shared by the
 * genuine-first-attempt path and the idempotency-key-replay path below — both end here.
 */
async function finishFlip(
  returnId: string,
  paymentId: string,
): Promise<{ ok: true; paymentId: string; alreadyApplied?: true }> {
  const flipped = await prisma.fieldReturn.updateMany({
    where: { id: returnId, offsetStatus: "AVAILABLE" },
    data: { offsetStatus: "APPLIED", offsetPaymentId: paymentId },
  });
  if (flipped.count === 0) {
    const current = await prisma.fieldReturn.findUnique({
      where: { id: returnId },
      select: { offsetStatus: true, offsetPaymentId: true },
    });
    if (current?.offsetStatus === "APPLIED" && current.offsetPaymentId === paymentId) {
      return { ok: true, paymentId, alreadyApplied: true };
    }
    console.error(
      `[applyReturnOffset] orphaned payment: return ${returnId} landed on offsetStatus=${current?.offsetStatus ?? "MISSING"} with offsetPaymentId=${current?.offsetPaymentId ?? "MISSING"} after payment ${paymentId} was posted (expected APPLIED with our payment id)`,
    );
    throw new PaymentError("ALREADY_APPLIED");
  }
  return { ok: true, paymentId };
}

/**
 * Settles one or more of a store's receivables using an approved, fully-valued field retur's
 * frozen totalValue instead of cash. Copies verifyCollection's shape: deterministic idempotency
 * key -> recordPayment (self-contained, its own transaction) -> CAS flip on this writer's own
 * document — never one enclosing transaction, since nesting prisma.$transaction calls on the
 * same client is unsafe.
 *
 * The idempotency-key lookup runs FIRST, before any guard that reads state a prior successful
 * call would already have mutated (the outstanding-sum diagnostic, most importantly). A crash
 * between recordPayment committing and the CAS flip leaves offsetStatus still AVAILABLE with a
 * real payment already posted and the store's outstanding already decremented — retrying from
 * the top must find that payment via the key and finish the flip, never re-derive the
 * allocation-sum or outstanding-sum guards against state the first attempt already changed.
 * Without this ordering, a retur whose value fully (or nearly) clears the store's outstanding
 * fails INSUFFICIENT_OUTSTANDING on retry after its own first attempt already succeeded --
 * stranding a real payment that never gets flipped to APPLIED, and double-counting the credit
 * in every reporting surface (listOffsettableReturns, getStoreAvailableCredit, the register
 * badge) forever.
 */
export async function applyReturnOffset(
  input: ApplyReturnOffsetInput,
): Promise<{ ok: true; paymentId: string; alreadyApplied?: true }> {
  const ret = await prisma.fieldReturn.findUnique({
    where: { id: input.returnId },
    select: {
      id: true, docNo: true, storeId: true, status: true,
      valuationStatus: true, totalValue: true, offsetStatus: true,
    },
  });
  if (!ret) throw new PaymentError("NOT_FOUND");
  if (ret.status !== "APPROVED") throw new PaymentError("RETURN_NOT_APPROVED");
  if (ret.valuationStatus !== "VALUED" || ret.totalValue === null) throw new PaymentError("NOT_VALUED");

  const totalValue = roundCents(Number(ret.totalValue));
  const idempotencyKey = `returoffset-${ret.id}`;

  /*
   * A re-application after a void collides with this same deterministic key: nothing clears a
   * voided payment's idempotencyKey, so the lookup finds the OLD VOIDED payment. Refused here
   * rather than made non-deterministic, which would cost the crash-safety property above for a
   * rare path. The operator records the correction as a fresh CASH/TRANSFER payment instead.
   */
  const existingPayment = await prisma.payment.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (existingPayment) {
    if (existingPayment.status === "VOIDED") throw new PaymentError("PAYMENT_VOIDED");
    return finishFlip(ret.id, existingPayment.id);
  }

  // No prior payment for this retur exists yet — this is a genuine first attempt.
  if (ret.offsetStatus !== "AVAILABLE") throw new PaymentError("ALREADY_APPLIED");

  const allocations = input.allocations.map((a) => ({ ...a, amount: roundCents(a.amount) }));
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocated - totalValue) > EPSILON) throw new PaymentError("ALLOCATION_MISMATCH");

  /*
   * Diagnostic only, not the safety mechanism — a plain read outside any transaction, so a
   * concurrent payment can invalidate it before recordPayment's own OVER_ALLOCATED check (which
   * runs inside its serializable transaction against the live outstandingAmount) actually fires.
   * This exists to name the real problem -- "this store's outstanding is less than the retur
   * value" -- instead of a generic allocation error an operator would keep re-arranging numbers
   * that can never sum to chase. Now genuinely only reachable on a first attempt (see the
   * idempotency-key lookup above), so it can no longer fire against state its own prior success
   * already mutated.
   */
  const outstanding = await prisma.receivable.aggregate({
    where: { storeId: ret.storeId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
    _sum: { outstandingAmount: true },
  });
  const totalOutstanding = Number(outstanding._sum.outstandingAmount ?? 0);
  if (totalOutstanding + EPSILON < totalValue) throw new PaymentError("INSUFFICIENT_OUTSTANDING");

  const { paymentId } = await recordPayment({
    storeId: ret.storeId,
    paidAt: new Date(),
    method: "RETUR_OFFSET",
    amount: totalValue,
    recordedById: input.appliedById,
    allocations,
    reference: ret.docNo,
    idempotencyKey,
  });

  /*
   * recordPayment's own idempotency lookup can still resolve to a pre-existing VOIDED payment
   * that landed between this function's own lookup above and this call — a narrow race, but the
   * same "flipped APPLIED against a payment that moved zero money" outcome, so it stays guarded.
   */
  const posted = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
  if (posted?.status === "VOIDED") throw new PaymentError("PAYMENT_VOIDED");

  return finishFlip(ret.id, paymentId);
}
