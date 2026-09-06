import { prisma, Prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { recordPayment } from "./payment-writer";
import { PaymentError } from "./errors";

export type ApplyReturnOffsetInput = {
  returnId: string;
  eventId: string;
  drawAmount: number;
  allocations: Array<{ receivableId: string; amount: number }>;
  appliedById: string;
};

const EPSILON = 1e-6;

/**
 * Recomputes appliedValue and offsetStatus from the payments that actually posted against this
 * retur. A projection, never a reservation: it is a SET rather than an increment, so replaying it
 * after a retry, a crash or a void converges on the same answer instead of double-counting. The
 * ceiling that makes over-draw impossible lives in recordPayment's own transaction, not here.
 *
 * Takes the client so a caller already inside a transaction (voidPayment) can project on `tx` and
 * have the release commit or roll back with the void itself. Defaults to the module client for the
 * ordinary post-commit call.
 */
export async function projectReturnOffset(
  returnId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const ret = await client.fieldReturn.findUnique({
    where: { id: returnId },
    select: { totalValue: true },
  });
  if (!ret || ret.totalValue === null) return;

  const drawn = await client.payment.aggregate({
    where: { fieldReturnId: returnId, status: "POSTED" },
    _sum: { amount: true },
  });
  const appliedValue = roundCents(Number(drawn._sum.amount ?? 0));
  const totalValue = roundCents(Number(ret.totalValue));

  await client.fieldReturn.update({
    where: { id: returnId },
    data: {
      appliedValue,
      offsetStatus: appliedValue + EPSILON >= totalValue ? "APPLIED" : "AVAILABLE",
    },
  });
}

/**
 * Settles one or more of a store's receivables using PART of an approved, fully-valued field
 * retur's frozen totalValue instead of cash. Copies verifyCollection's shape: deterministic
 * idempotency key -> recordPayment (self-contained, its own transaction) -> projection onto this
 * writer's own document — never one enclosing transaction, since nesting prisma.$transaction calls
 * on the same client is unsafe.
 *
 * The idempotency-key lookup runs FIRST, before any guard that reads state a prior successful call
 * would already have mutated. A crash between recordPayment committing and the projection leaves a
 * real payment posted with appliedValue stale; retrying from the top must find that payment by the
 * key and re-project, never re-derive guards against state the first attempt already changed.
 *
 * The key is per-EVENT, not per-retur, because one retur can now back several payments. The caller
 * owns the eventId and must keep it stable across retries of the same logical draw — in the
 * settlement flow it is the deduction row's id; in the backoffice sheet it is a UUID minted once
 * when the sheet opens.
 */
export async function applyReturnOffset(
  input: ApplyReturnOffsetInput,
): Promise<{ ok: true; paymentId: string; alreadyApplied?: true }> {
  const ret = await prisma.fieldReturn.findUnique({
    where: { id: input.returnId },
    select: {
      id: true, docNo: true, storeId: true, status: true,
      valuationStatus: true, totalValue: true, appliedValue: true,
    },
  });
  if (!ret) throw new PaymentError("NOT_FOUND");
  if (ret.status !== "APPROVED") throw new PaymentError("RETURN_NOT_APPROVED");
  if (ret.valuationStatus !== "VALUED" || ret.totalValue === null) throw new PaymentError("NOT_VALUED");

  const idempotencyKey = `returoffset-${ret.id}-${input.eventId}`;

  /*
   * A replay of THIS event after its payment was voided still refuses: nothing clears a voided
   * payment's idempotencyKey, so the lookup finds the old voided row. A re-draw is a NEW event
   * with a new key, which is the supported path — unlike the pre-draw-down writer, where the
   * one-key-per-retur design made re-application impossible entirely.
   */
  const existingPayment = await prisma.payment.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (existingPayment) {
    if (existingPayment.status === "VOIDED") throw new PaymentError("PAYMENT_VOIDED");
    await projectReturnOffset(ret.id);
    return { ok: true, paymentId: existingPayment.id, alreadyApplied: true };
  }

  const drawAmount = roundCents(input.drawAmount);
  if (!(drawAmount > 0)) throw new PaymentError("INVALID_AMOUNT");

  const allocations = input.allocations.map((a) => ({ ...a, amount: roundCents(a.amount) }));
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocated - drawAmount) > EPSILON) throw new PaymentError("ALLOCATION_MISMATCH");

  /*
   * Diagnostic only, not the safety mechanism — a plain read outside any transaction, so a
   * concurrent payment can invalidate it before recordPayment's own OVER_ALLOCATED check actually
   * fires. It exists to name the real problem — "this store's outstanding is less than what you
   * are drawing" — instead of a generic allocation error an operator would keep re-arranging
   * numbers that can never sum to chase.
   */
  const outstanding = await prisma.receivable.aggregate({
    where: { storeId: ret.storeId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
    _sum: { outstandingAmount: true },
  });
  const totalOutstanding = Number(outstanding._sum.outstandingAmount ?? 0);
  if (totalOutstanding + EPSILON < drawAmount) throw new PaymentError("INSUFFICIENT_OUTSTANDING");

  const { paymentId } = await recordPayment({
    storeId: ret.storeId,
    paidAt: new Date(),
    method: "RETUR_OFFSET",
    amount: drawAmount,
    recordedById: input.appliedById,
    allocations,
    reference: ret.docNo,
    idempotencyKey,
    fieldReturnId: ret.id,
  });

  /*
   * recordPayment's own idempotency lookup can still resolve to a pre-existing VOIDED payment that
   * landed between this function's own lookup above and this call — a narrow race, but the same
   * "projected a draw against a payment that moved zero money" outcome, so it stays guarded.
   */
  const posted = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
  if (posted?.status === "VOIDED") throw new PaymentError("PAYMENT_VOIDED");

  await projectReturnOffset(ret.id);
  return { ok: true, paymentId };
}
