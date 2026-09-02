import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { roundCents } from "@elorae/db/pricing";
import { PaymentError } from "./errors";

export type RecordPaymentInput = {
  storeId: string;
  paidAt: Date;
  method: "CASH" | "TRANSFER" | "RETUR_OFFSET";
  amount: number;
  recordedById: string;
  allocations: Array<{ receivableId: string; amount: number }>;
  reference?: string;
  note?: string;
  proofUrl?: string;
  proofR2Key?: string;
  idempotencyKey?: string;
};

/**
 * Amounts are `Decimal(15,2)`, so every incoming figure is normalised to 2dp BEFORE any comparison
 * and every comparison is then effectively exact.
 *
 * The tolerance must be far below one cent, not half of one. Half a cent is a STORABLE magnitude
 * here, so a 0.005 tolerance lets a real mismatch through: `amount = 1500.008` against allocations
 * `1000.004 + 500.004` passes both the sum check and the per-line balance check, then MariaDB rounds
 * the header to 1500.01 and the lines to 1500.00 independently. The receipt journal reads
 * `Payment.amount`, so the GL moves a sen more than the AR subledger — permanent AR-control drift,
 * and a payment header that does not equal its own allocation lines. Actual float summation error at
 * rupiah magnitudes is ~1e-7 at 1e9, some 500x smaller than 0.005, so nothing needs that slack.
 */
const EPSILON = 1e-6;

/**
 * Records one payment against one or more receivables of the same store.
 *
 * Every guard lives here rather than in the form. Each `"use server"` export is an independently
 * callable endpoint, so a control the UI withholds is not a guarantee about what reaches the writer.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<{ paymentId: string; docNo: string }> {
  const amount = roundCents(input.amount);
  const allocations = input.allocations.map((a) => ({ ...a, amount: roundCents(a.amount) }));

  if (!(amount > 0)) throw new PaymentError("INVALID_AMOUNT");
  if (allocations.length === 0) throw new PaymentError("NO_ALLOCATIONS");
  if (allocations.some((a) => !(a.amount > 0))) throw new PaymentError("INVALID_AMOUNT");

  /*
   * No unapplied credit in this slice: a payment is fully allocated the moment it is recorded. An
   * on-account balance is its own feature with its own GL treatment.
   */
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocated - amount) > EPSILON) throw new PaymentError("ALLOCATION_MISMATCH");

  /*
   * Two entries naming the SAME receivable would each be checked against that receivable's
   * pre-payment balance, so 600 + 600 against a 1000 balance passes both per-line checks. The
   * `@@unique([paymentId, receivableId])` constraint does then reject the create, so nothing wrong
   * persists — but it surfaces as a raw Prisma P2002 the caller cannot classify, and it is only
   * fail-closed by accident, via a constraint that exists for a different reason. Reject it here so
   * the per-line check is correct on its own terms rather than constraint-rescued.
   */
  if (new Set(allocations.map((a) => a.receivableId)).size !== allocations.length) {
    throw new PaymentError("DUPLICATE_ALLOCATION");
  }

  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, docNo: true },
      });
      if (existing) return { paymentId: existing.id, docNo: existing.docNo };
    }

    for (const a of allocations) {
      const receivable = await tx.receivable.findUnique({
        where: { id: a.receivableId },
        select: { id: true, storeId: true, outstandingAmount: true, status: true },
      });
      if (!receivable) throw new PaymentError("NOT_FOUND");
      /*
       * A cross-store allocation is data corruption, not a user mistake — the store picker scopes
       * the form, so reaching here means the request did not come from it.
       */
      if (receivable.storeId !== input.storeId) throw new PaymentError("WRONG_STORE");
      if (receivable.status === "PAID" || receivable.status === "WRITTEN_OFF") {
        throw new PaymentError("ALREADY_SETTLED");
      }
      if (a.amount - Number(receivable.outstandingAmount) > EPSILON) {
        throw new PaymentError("OVER_ALLOCATED");
      }
    }

    const docNo = await generateDocNumber("PAYMENT", tx);

    const payment = await tx.payment.create({
      data: {
        docNo,
        storeId: input.storeId,
        paidAt: input.paidAt,
        method: input.method,
        amount,
        reference: input.reference,
        note: input.note,
        proofUrl: input.proofUrl,
        proofR2Key: input.proofR2Key,
        recordedById: input.recordedById,
        idempotencyKey: input.idempotencyKey ?? null,
        allocations: {
          create: allocations.map((a) => ({ receivableId: a.receivableId, amount: a.amount })),
        },
      },
      select: { id: true, docNo: true },
    });

    for (const a of allocations) {
      /*
       * Atomic increment/decrement, never read-modify-write: two payments against the same
       * receivable would otherwise lose one of the two writes. Same rule, same reason, as
       * InventoryValue.reservedQty.
       */
      const updated = await tx.receivable.update({
        where: { id: a.receivableId },
        data: {
          paidAmount: { increment: a.amount },
          outstandingAmount: { decrement: a.amount },
        },
        select: { outstandingAmount: true },
      });
      /*
       * Status is recomputed from the RETURNED value, not from the pre-read one. PAID requires exact
       * zero: a delivery total can carry sen (unlike a van sale, which rounds to whole rupiah), so a
       * receivable can be settled in cash and legitimately sit at PARTIAL with sub-rupiah residue.
       * Declaring PAID early would write money off with no journal behind it.
       */
      const outstanding = Number(updated.outstandingAmount);
      await tx.receivable.update({
        where: { id: a.receivableId },
        data: { status: outstanding === 0 ? "PAID" : "PARTIAL" },
      });
    }

    return { paymentId: payment.id, docNo: payment.docNo };
  });
}
