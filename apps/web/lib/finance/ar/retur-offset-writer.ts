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
 * Settles one or more of a store's receivables using an approved, fully-valued field retur's
 * frozen totalValue instead of cash. Copies verifyCollection's shape exactly: deterministic
 * idempotency key -> recordPayment (self-contained, its own transaction) -> CAS flip on this
 * writer's own document — never one enclosing transaction, since nesting prisma.$transaction
 * calls on the same client is unsafe.
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
  if (ret.offsetStatus !== "AVAILABLE") throw new PaymentError("ALREADY_APPLIED");

  const totalValue = roundCents(Number(ret.totalValue));
  const allocations = input.allocations.map((a) => ({ ...a, amount: roundCents(a.amount) }));
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocated - totalValue) > EPSILON) throw new PaymentError("ALLOCATION_MISMATCH");

  /*
   * Diagnostic only, not the safety mechanism — a plain read outside any transaction, so a
   * concurrent payment can invalidate it before recordPayment's own OVER_ALLOCATED check (which
   * runs inside its serializable transaction against the live outstandingAmount) actually fires.
   * This exists to name the real problem — "this store's outstanding is less than the retur
   * value" — instead of a generic allocation error an operator would keep re-arranging numbers
   * that can never sum to chase.
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
    idempotencyKey: `returoffset-${ret.id}`,
  });

  /*
   * A re-application after a void collides with this same deterministic key: recordPayment's own
   * idempotency lookup finds the OLD VOIDED payment (nothing clears its idempotencyKey on void)
   * and returns it unchanged, having created and allocated nothing. Refused here rather than
   * made non-deterministic, which would cost the crash-safety property above for a rare path.
   * The operator records the correction as a fresh CASH/TRANSFER payment instead.
   */
  const posted = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
  if (posted?.status === "VOIDED") throw new PaymentError("PAYMENT_VOIDED");

  const flipped = await prisma.fieldReturn.updateMany({
    where: { id: ret.id, offsetStatus: "AVAILABLE" },
    data: { offsetStatus: "APPLIED", offsetPaymentId: paymentId },
  });
  if (flipped.count === 0) {
    const current = await prisma.fieldReturn.findUnique({
      where: { id: ret.id },
      select: { offsetStatus: true, offsetPaymentId: true },
    });
    if (current?.offsetStatus === "APPLIED" && current.offsetPaymentId === paymentId) {
      return { ok: true, paymentId, alreadyApplied: true };
    }
    console.error(
      `[applyReturnOffset] orphaned payment: return ${ret.id} landed on offsetStatus=${current?.offsetStatus ?? "MISSING"} with offsetPaymentId=${current?.offsetPaymentId ?? "MISSING"} after payment ${paymentId} was posted (expected APPLIED with our payment id)`,
    );
    throw new PaymentError("ALREADY_APPLIED");
  }

  return { ok: true, paymentId };
}
