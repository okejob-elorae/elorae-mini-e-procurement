import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { PaymentError } from "./errors";

export type RecordPaymentInput = {
  storeId: string;
  paidAt: Date;
  method: "CASH" | "TRANSFER";
  amount: number;
  recordedById: string;
  allocations: Array<{ receivableId: string; amount: number }>;
  reference?: string;
  note?: string;
  proofUrl?: string;
  proofR2Key?: string;
  idempotencyKey?: string;
};

/** Cent tolerance for comparing two Decimal-derived sums. Amounts are Decimal(15,2). */
const EPSILON = 0.005;

/**
 * Records one payment against one or more receivables of the same store.
 *
 * Every guard lives here rather than in the form. Each `"use server"` export is an independently
 * callable endpoint, so a control the UI withholds is not a guarantee about what reaches the writer.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<{ paymentId: string; docNo: string }> {
  if (!(input.amount > 0)) throw new PaymentError("INVALID_AMOUNT");
  if (input.allocations.length === 0) throw new PaymentError("NO_ALLOCATIONS");
  if (input.allocations.some((a) => !(a.amount > 0))) throw new PaymentError("INVALID_AMOUNT");

  /*
   * No unapplied credit in this slice: a payment is fully allocated the moment it is recorded. An
   * on-account balance is its own feature with its own GL treatment.
   */
  const allocated = input.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocated - input.amount) > EPSILON) throw new PaymentError("ALLOCATION_MISMATCH");

  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, docNo: true },
      });
      if (existing) return { paymentId: existing.id, docNo: existing.docNo };
    }

    for (const a of input.allocations) {
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
        amount: input.amount,
        reference: input.reference,
        note: input.note,
        proofUrl: input.proofUrl,
        proofR2Key: input.proofR2Key,
        recordedById: input.recordedById,
        idempotencyKey: input.idempotencyKey ?? null,
        allocations: {
          create: input.allocations.map((a) => ({ receivableId: a.receivableId, amount: a.amount })),
        },
      },
      select: { id: true, docNo: true },
    });

    for (const a of input.allocations) {
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
