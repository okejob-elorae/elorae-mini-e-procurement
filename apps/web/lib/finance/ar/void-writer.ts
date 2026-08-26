import { runSerializable } from "@/lib/db/tx-retry";
import { PaymentError } from "./errors";

/**
 * Voids a posted payment and restores everything it settled.
 *
 * The payment row is never deleted and neither are its allocations: they are the record of what the
 * voided payment claimed to settle. The reversing journal is posted by the caller, after this
 * transaction commits.
 */
export async function voidPayment(input: {
  paymentId: string;
  reason: string;
  voidedById: string;
}): Promise<{ voided: boolean }> {
  const reason = input.reason.trim();
  if (reason === "") throw new PaymentError("MISSING_REASON", "A void reason is required");

  return runSerializable(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, status: true },
    });
    if (!payment) throw new PaymentError("NOT_FOUND");
    if (payment.status === "VOIDED") return { voided: false };

    /*
     * Guarded updateMany, not update: two concurrent voids would each read POSTED and each restore
     * the same outstanding, silently doubling the balance back. Zero rows affected means someone
     * else got there first, and nothing below runs.
     */
    const flipped = await tx.payment.updateMany({
      where: { id: payment.id, status: "POSTED" },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedById: input.voidedById,
        voidReason: reason,
      },
    });
    if (flipped.count === 0) return { voided: false };

    const allocations = await tx.paymentAllocation.findMany({
      where: { paymentId: payment.id },
      select: { receivableId: true, amount: true },
    });

    for (const a of allocations) {
      const restored = await tx.receivable.update({
        where: { id: a.receivableId },
        data: {
          paidAmount: { decrement: a.amount },
          outstandingAmount: { increment: a.amount },
        },
        select: { paidAmount: true, outstandingAmount: true },
      });
      /*
       * Recomputed from the returned row: a receivable settled by two payments goes back to PARTIAL
       * when one is voided, and only to OUTSTANDING when nothing is left against it.
       */
      const paid = Number(restored.paidAmount);
      const outstanding = Number(restored.outstandingAmount);
      /*
       * The `PAID` arm is UNREACHABLE from a void and is kept as insurance, not as live logic: this
       * restore increments `outstandingAmount` by an allocation amount `recordPayment` guarantees is
       * > 0, and the prior outstanding is never negative, so `outstanding === 0` cannot hold here.
       * Do not go looking for the test that covers it — there isn't one, and there cannot be. It
       * stays so that a future partial-void, which could leave a receivable settled, does not
       * silently fall through to `PARTIAL`.
       */
      const status = paid === 0 ? "OUTSTANDING" : outstanding === 0 ? "PAID" : "PARTIAL";
      await tx.receivable.update({ where: { id: a.receivableId }, data: { status } });
    }

    return { voided: true };
  });
}
