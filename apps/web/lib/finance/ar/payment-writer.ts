import { prisma } from "@elorae/db";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { roundCents } from "@elorae/db/pricing";
import { PaymentError } from "./errors";
import { sumPendingClaimsOnReceivable } from "./pending-claims";

export type RecordPaymentInput = {
  storeId: string;
  paidAt: Date;
  /**
   * A hand-written union, NOT Prisma's `PaymentMethod` — widening the schema enum does not widen
   * this, and a method missing here simply cannot be posted. `PROGRAM_DEDUCTION` and `ADMIN_FEE`
   * are the settlement's non-cash components; `debitRole` in `payment-journal.ts` already maps
   * both to their expense roles.
   *
   * `ROUNDING_ADJUSTMENT` is deliberately NOT in this union, and `recordPayment` refuses it at
   * runtime too: it writes money off, so its only way in is `recordRoundingAdjustment`, which
   * derives the amount itself and posts through the module-private `postPayment` below.
   */
  method: "CASH" | "TRANSFER" | "RETUR_OFFSET" | "PROGRAM_DEDUCTION" | "ADMIN_FEE";
  amount: number;
  recordedById: string;
  allocations: Array<{ receivableId: string; amount: number }>;
  reference?: string;
  note?: string;
  proofUrl?: string;
  proofR2Key?: string;
  idempotencyKey?: string;
  fieldReturnId?: string;
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
 * The one rupiah a rounding adjustment must stay strictly below. Anything at or above it is
 * real money, which only a cash, transfer or settlement payment may settle.
 */
const ROUNDING_RESIDUE_CEILING = 1;

/**
 * The input of `postPayment`, the body `recordPayment` and `recordRoundingAdjustment` share,
 * widened to the one method neither the public union nor any other caller may name. Both stay
 * module-private on purpose: exporting either would hand every caller the write-off method
 * `recordPayment` refuses.
 */
type PostPaymentInput = Omit<RecordPaymentInput, "method"> & {
  method: RecordPaymentInput["method"] | "ROUNDING_ADJUSTMENT";
};

function isResidue(outstanding: number): boolean {
  return outstanding > 0 && outstanding < ROUNDING_RESIDUE_CEILING;
}

/**
 * Records one payment against one or more receivables of the same store.
 *
 * Every guard lives here rather than in the form. Each `"use server"` export is an independently
 * callable endpoint, so a control the UI withholds is not a guarantee about what reaches the writer.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<{ paymentId: string; docNo: string }> {
  /**
   * The type already excludes `ROUNDING_ADJUSTMENT`; this is the runtime half, for a caller that
   * reached here through a cast or an untyped request. Refused before any other check, so no
   * amount or allocation shape can make the method acceptable from this entry point.
   */
  if ((input.method as string) === "ROUNDING_ADJUSTMENT") throw new PaymentError("METHOD_NOT_ALLOWED");
  const { paymentId, docNo } = await postPayment(input);
  return { paymentId, docNo };
}

/**
 * `replayed` is true when the idempotency key already named a payment, so nothing was written.
 * `recordPayment` drops it to keep its own result shape; `recordRoundingAdjustment` reports it.
 */
async function postPayment(input: PostPaymentInput): Promise<{ paymentId: string; docNo: string; replayed: boolean }> {
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

  /*
   * The coupling used to be structural — a `@unique FieldReturn.offsetPaymentId` plus an
   * `offsetStatus` CAS made a stray retur-offset payment unreachable. Both were removed for
   * partial draw-down, so it is enforced here instead: without a `fieldReturnId`, a
   * RETUR_OFFSET payment would settle receivables and post the revenue reversal with no retur
   * behind it, invisible to `projectReturnOffset`.
   */
  if (input.method === "RETUR_OFFSET" && !input.fieldReturnId) throw new PaymentError("NOT_FOUND");

  /**
   * A rounding adjustment writes money off, so its shape is pinned here whoever built the
   * input: one receivable, no retur behind it, and strictly under one rupiah. The live
   * outstanding it must equal is checked inside the transaction below.
   */
  const isRounding = input.method === "ROUNDING_ADJUSTMENT";
  if (isRounding) {
    if (allocations.length !== 1 || input.fieldReturnId) throw new PaymentError("METHOD_NOT_ALLOWED");
    if (!(amount < ROUNDING_RESIDUE_CEILING)) throw new PaymentError("NOT_A_RESIDUE");
  }

  return runSerializable(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, docNo: true, status: true },
      });
      if (existing) {
        /**
         * Mirrors `recordRoundingAdjustment`'s own replay branch for the request that lost a race
         * on the same event: a voided write-off is refused, never handed back as a success.
         * Other methods keep their existing replay behaviour.
         */
        if (isRounding && existing.status === "VOIDED") throw new PaymentError("PAYMENT_VOIDED");
        return { paymentId: existing.id, docNo: existing.docNo, replayed: true };
      }
    }

    /*
     * The retur draw ceiling. This lives inside the same serializable transaction that creates the
     * payment, for the same reason OVER_ALLOCATED does: a check that commits separately from the
     * fact it checks is not a check. Two concurrent draws against one retur are serialised here,
     * so the sum of POSTED payments carrying this fieldReturnId can never pass the retur's frozen
     * totalValue. VOIDED payments are excluded — a voided draw released its value.
     */
    if (input.fieldReturnId) {
      const ret = await tx.fieldReturn.findUnique({
        where: { id: input.fieldReturnId },
        select: { storeId: true, totalValue: true },
      });
      if (!ret) throw new PaymentError("NOT_FOUND");
      /*
       * Every guard lives here, not in the form: without this, a payment can draw down store A's
       * retur credit while settling store B's receivables — the ceiling check and the allocation
       * loop's WRONG_STORE both pass, since neither compares the retur's own store against the
       * other.
       */
      if (ret.storeId !== input.storeId) throw new PaymentError("WRONG_STORE");
      if (ret.totalValue === null) throw new PaymentError("NOT_VALUED");
      const drawn = await tx.payment.aggregate({
        where: { fieldReturnId: input.fieldReturnId, status: "POSTED" },
        _sum: { amount: true },
      });
      const alreadyDrawn = roundCents(Number(drawn._sum.amount ?? 0));
      const totalValue = roundCents(Number(ret.totalValue));
      if (alreadyDrawn + amount > totalValue + EPSILON) throw new PaymentError("EXCEEDS_REMAINING");
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
      if (receivable.status === "PAID" || receivable.status === "WRITTEN_OFF" || receivable.status === "VOIDED") {
        throw new PaymentError("ALREADY_SETTLED");
      }
      if (isRounding) {
        /**
         * The amount was read before this transaction opened, so it is re-proved here against
         * the row this transaction reads: it must still be a residue and still equal the whole
         * outstanding to the cent. A payment or void that committed in between fails the match
         * and refuses rather than writing off a stale figure.
         */
        const outstanding = roundCents(Number(receivable.outstandingAmount));
        if (!isResidue(outstanding) || Math.abs(a.amount - outstanding) > EPSILON) {
          throw new PaymentError("NOT_A_RESIDUE");
        }
        /**
         * A pending collection submission or store settlement may be claiming this residue.
         * Closing the receivable under it would leave that claim to fail at verify or approval
         * against a balance that is gone, so the claim is decided first.
         */
        const pending = await sumPendingClaimsOnReceivable(tx, { receivableId: receivable.id, storeId: receivable.storeId });
        if (pending.total > 0) throw new PaymentError("PENDING_CLAIM");
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
        fieldReturnId: input.fieldReturnId ?? null,
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
       * Declaring PAID early would write money off with no journal behind it; such a residue is
       * closed by `recordRoundingAdjustment`, a payment with its own journal.
       */
      const outstanding = Number(updated.outstandingAmount);
      await tx.receivable.update({
        where: { id: a.receivableId },
        data: { status: outstanding === 0 ? "PAID" : "PARTIAL" },
      });
    }

    return { paymentId: payment.id, docNo: payment.docNo, replayed: false };
  });
}

export type RecordRoundingAdjustmentInput = {
  receivableId: string;
  actorId: string;
  eventId: string;
};

/**
 * The shape the caller's `eventId` must take before it is spliced into the idempotency key. A
 * `crypto.randomUUID()` is 36 characters, so the key (`rounding-` + a cuid + `-` + the id) stays
 * far inside `Payment.idempotencyKey`'s `VARCHAR(191)`.
 */
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Closes a receivable's sub-rupiah residue — `0 < outstanding < 1`, which no store can pay in
 * cash and which `PAID`'s exact-zero rule otherwise leaves at `PARTIAL` forever — by posting a
 * `ROUNDING_ADJUSTMENT` payment for exactly that residue. It is an ordinary payment in every
 * other respect: one allocation, the atomic outstanding decrement and the PAID flip in
 * `postPayment`, a `PAYMENT_RECEIPT` journal debiting `ROUNDING_EXPENSE` (posted by the
 * caller), and a plain `voidPayment` to undo it. Never `WRITTEN_OFF`, which carries no journal.
 *
 * The amount is never caller input: it is the receivable's outstanding, read here and re-proved
 * inside `postPayment`'s transaction, so nothing can use this path to write off real money.
 *
 * The idempotency key is `rounding-<receivableId>-<eventId>`, with the event id minted by the
 * caller once per confirm dialog, the same contract as `applyReturnOffset`'s. It is not derived
 * from the receivable's paid state: a void restores that state exactly, so a derived key would
 * hand a fresh write-off after a void the voided payment back. A replay of the same event returns
 * its payment, or refuses `PAYMENT_VOIDED` once that payment has been voided; a second event
 * against an already closed receivable refuses `ALREADY_SETTLED` in the transaction.
 */
export async function recordRoundingAdjustment(
  input: RecordRoundingAdjustmentInput,
): Promise<{ paymentId: string; docNo: string; alreadyApplied: boolean }> {
  if (typeof input.eventId !== "string" || !EVENT_ID_PATTERN.test(input.eventId)) {
    throw new PaymentError("INVALID_EVENT_ID");
  }
  const idempotencyKey = `rounding-${input.receivableId}-${input.eventId}`;

  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey },
    select: { id: true, docNo: true, status: true },
  });
  if (existing) {
    if (existing.status === "VOIDED") throw new PaymentError("PAYMENT_VOIDED");
    return { paymentId: existing.id, docNo: existing.docNo, alreadyApplied: true };
  }

  const receivable = await prisma.receivable.findUnique({
    where: { id: input.receivableId },
    select: { id: true, storeId: true, outstandingAmount: true, status: true },
  });
  if (!receivable) throw new PaymentError("NOT_FOUND");
  if (receivable.status === "PAID" || receivable.status === "WRITTEN_OFF" || receivable.status === "VOIDED") {
    throw new PaymentError("ALREADY_SETTLED");
  }
  const residue = roundCents(Number(receivable.outstandingAmount));
  if (!isResidue(residue)) throw new PaymentError("NOT_A_RESIDUE");

  const { paymentId, docNo, replayed } = await postPayment({
    storeId: receivable.storeId,
    paidAt: new Date(),
    method: "ROUNDING_ADJUSTMENT",
    amount: residue,
    recordedById: input.actorId,
    allocations: [{ receivableId: receivable.id, amount: residue }],
    idempotencyKey,
  });
  return { paymentId, docNo, alreadyApplied: replayed };
}
