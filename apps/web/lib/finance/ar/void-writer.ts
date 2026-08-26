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
  /*
   * A reason of pure zero-width/format characters (Unicode category `Cf`, e.g. U+200B ZERO WIDTH
   * SPACE) or U+2800 BRAILLE PATTERN BLANK survives `.trim()` unchanged — neither is whitespace by
   * the ECMAScript WhiteSpace production — and would otherwise persist as an audit reason that
   * renders blank. Require at least one character outside those classes before accepting the
   * reason as non-empty.
   */
  const hasVisibleContent = /[^\s\p{Cf}\u2800]/u.test(reason);
  if (!hasVisibleContent) throw new PaymentError("MISSING_REASON", "A void reason is required");

  return runSerializable(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, status: true },
    });
    if (!payment) throw new PaymentError("NOT_FOUND");
    if (payment.status === "VOIDED") return { voided: false };

    /*
     * Guarded updateMany, not update — defence-in-depth, not the live mechanism. Under this
     * transaction's SERIALIZABLE isolation, the shared lock the preceding `findUnique` takes on
     * this row is what actually serialises two concurrent voids: the second one blocks until the
     * first commits, then deadlocks (1213) and is retried by `runSerializable`, at which point it
     * reads VOIDED and short-circuits above — the `updateMany` below never even runs for it. This
     * guard exists in case that isolation level is ever relaxed: zero rows affected then still
     * means someone else got there first, and nothing below may run.
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
      /*
       * `recordPayment` refuses a WRITTEN_OFF receivable outright (`ALREADY_SETTLED`); this writer
       * must respect the same terminal status rather than silently reviving it. `WRITTEN_OFF` is
       * reachable only by hand SQL today — this slice ships no write-off writer — so refusing here
       * costs almost nothing and forces a deliberate un-write-off instead of letting a void quietly
       * resurrect a closed balance with nothing reversing it in the GL. The throw happens before
       * this allocation's restore runs, and — because the whole body is inside `runSerializable` —
       * it rolls back the status flip above too, so the refusal is total.
       */
      const receivable = await tx.receivable.findUnique({
        where: { id: a.receivableId },
        select: { status: true },
      });
      if (receivable?.status === "WRITTEN_OFF") throw new PaymentError("ALREADY_SETTLED");

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
       * stays as a defence against out-of-band data: a negative or inconsistent `outstandingAmount`
       * written by hand SQL — the same route by which `WRITTEN_OFF` itself is reachable today — not
       * against anything this writer's own code paths can produce.
       */
      const status = paid === 0 ? "OUTSTANDING" : outstanding === 0 ? "PAID" : "PARTIAL";
      await tx.receivable.update({ where: { id: a.receivableId }, data: { status } });
    }

    return { voided: true };
  });
}
