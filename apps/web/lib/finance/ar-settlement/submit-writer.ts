import { roundCents } from "@elorae/db/pricing";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { computeSettlementTotals, computeVariance } from "./calc";
import { SettlementError } from "./errors";

export type SettlementDeductionInputRow = {
  type: "RETUR_OFFSET" | "PROGRAM" | "ADMIN_FEE";
  amount?: number;
  percent?: number;
  fieldReturnId?: string;
  proofUrl?: string;
  proofR2Key?: string;
  note?: string;
};

export type SubmitSettlementInput = {
  draftId: string;
  storeId: string;
  salesmanId: string;
  invoices: Array<{ receivableId: string; amount: number }>;
  deductions: SettlementDeductionInputRow[];
  actualAmount: number;
  note?: string;
};

export type SubmitSettlementResult = {
  settlementId: string;
  docNo: string;
  alreadySubmitted?: true;
};

const EPSILON = 1e-6;

/**
 * Accepts a salesman's settlement document for a store's invoices. Moves no money and posts no
 * journal — a later slice's approval step is the only thing that reaches the ledger. What this
 * writer owes is that every rule is enforced server-side and that two salesmen can never both
 * claim the same retur credit, or the same slice of the same invoice.
 *
 * A retur's remaining headroom is `totalValue - appliedValue - Σ(RETUR_OFFSET deduction amounts
 * on OTHER PENDING settlements for that retur)`, and an invoice's remaining headroom is
 * `outstandingAmount - Σ(invoice amounts on OTHER PENDING settlements for that receivable)` — both
 * sums computed with the TRANSACTION client, inside this same `runSerializable` call, the
 * identical shape as `submitCollection`'s over-collection guard in
 * `lib/finance/collections/submit-writer.ts`. A read taken before the transaction (or against the
 * top-level `prisma` singleton) would let two settlements race through the same headroom, both
 * collect cash from a store, and leave the loser refused only later, at approval, after the money
 * already changed hands.
 *
 * Both claims are DERIVED, never stored: a settlement that stops being PENDING (rejected, or later
 * approved into something else) stops contributing to either sum by construction. There is no
 * `claimedValue` column to keep in sync and no release path to forget on reject.
 */
export async function submitSettlement(input: SubmitSettlementInput): Promise<SubmitSettlementResult> {
  /*
   * `draftId` is a GLOBAL unique key (`StoreSettlement.idempotencyKey`) used as the very first
   * lookup below. An empty string is not "no draft id" here, it is a valid-looking key that a
   * stale client build could send for every submission — the second such submission from a
   * DIFFERENT store would hit the first submission's row in the idempotency lookup and be told it
   * succeeded, while holding cash for invoices no settlement document actually names. This must be
   * rejected before that lookup ever runs, not merely before the eventual write.
   */
  if (!input.draftId) throw new SettlementError("INVALID_DRAFT_ID");

  return runSerializable(async (tx) => {
    /*
     * Step 1: the idempotency lookup runs FIRST, ahead of every guard below. A replay of a
     * `draftId` whose first attempt already committed must return that settlement as-is, never
     * re-derive a guard (e.g. the retur headroom) against state the first attempt itself changed.
     */
    const existing = await tx.storeSettlement.findUnique({
      where: { idempotencyKey: input.draftId },
      select: { id: true, docNo: true },
    });
    if (existing) {
      return { settlementId: existing.id, docNo: existing.docNo, alreadySubmitted: true };
    }

    /*
     * Step 2: validate shapes — positive amounts, percent in range, at most one ADMIN_FEE,
     * required evidence per type (RETUR_OFFSET exempt), and evidence keys that are both scoped to
     * this submission and never reused within it.
     */
    if (!Array.isArray(input.invoices) || input.invoices.length === 0) {
      throw new SettlementError("NO_INVOICES");
    }
    if (!(input.actualAmount >= 0)) throw new SettlementError("INVALID_AMOUNT");

    const seenReceivableIds = new Set<string>();
    for (const invoice of input.invoices) {
      if (!(invoice.amount > 0)) throw new SettlementError("INVALID_AMOUNT");
      if (seenReceivableIds.has(invoice.receivableId)) throw new SettlementError("DUPLICATE_INVOICE");
      seenReceivableIds.add(invoice.receivableId);
    }

    if (!Array.isArray(input.deductions)) throw new SettlementError("INVALID_DEDUCTIONS");

    let adminFeeCount = 0;
    for (const deduction of input.deductions) {
      if (deduction.type === "ADMIN_FEE") {
        adminFeeCount += 1;
        if (typeof deduction.percent !== "number" || !(deduction.percent >= 0) || deduction.percent > 100) {
          throw new SettlementError("INVALID_PERCENT");
        }
      } else {
        if (typeof deduction.amount !== "number" || !(deduction.amount > 0)) {
          throw new SettlementError("INVALID_AMOUNT");
        }
        if (deduction.type === "RETUR_OFFSET" && !deduction.fieldReturnId) {
          throw new SettlementError("MISSING_FIELD_RETURN_ID");
        }
      }
    }
    if (adminFeeCount > 1) throw new SettlementError("DUPLICATE_ADMIN_FEE");

    const seenProofKeys = new Set<string>();
    const proofKeyPrefix = `settlement-proofs/${input.draftId}/`;
    for (const deduction of input.deductions) {
      if (deduction.type === "RETUR_OFFSET") continue;
      if (!deduction.proofUrl || !deduction.proofR2Key) throw new SettlementError("MISSING_EVIDENCE");
      /*
       * Unbound, reusable proof keys are exactly the POD-proof landmine this repo has already hit:
       * one uploaded photo satisfying every proof requirement at once. Binding the key to this
       * submission's own `draftId` prefix stops evidence from a different (or future) submission
       * being pointed at, and the per-submission uniqueness check stops the SAME key covering more
       * than one deduction inside this one document.
       */
      if (!deduction.proofR2Key.startsWith(proofKeyPrefix)) throw new SettlementError("INVALID_PROOF_KEY");
      if (seenProofKeys.has(deduction.proofR2Key)) throw new SettlementError("DUPLICATE_PROOF_KEY");
      seenProofKeys.add(deduction.proofR2Key);
    }

    /*
     * Step 3: verify the salesman is a real row — `StoreSettlement.salesman` is a REQUIRED
     * relation, and under `relationMode = "prisma"` there is no FK behind it, so a dangling id
     * would commit a row that throws `Inconsistent query result` on every future query selecting
     * through it, with no UI repair path. Then load every selected receivable, verify it belongs
     * to this store and is still collectible, and net this submission's claim on it against
     * OTHER PENDING settlements' claims on the same receivable — the invoice-side twin of the
     * retur claim guard below.
     */
    const salesman = await tx.user.findUnique({ where: { id: input.salesmanId }, select: { id: true } });
    if (!salesman) throw new SettlementError("SALESMAN_NOT_FOUND");

    const receivableIds = input.invoices.map((invoice) => invoice.receivableId);
    const receivables = await tx.receivable.findMany({
      where: { id: { in: receivableIds } },
      select: { id: true, storeId: true, status: true, outstandingAmount: true },
    });
    const receivableById = new Map(receivables.map((r) => [r.id, r]));
    for (const invoice of input.invoices) {
      const receivable = receivableById.get(invoice.receivableId);
      if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
      if (receivable.storeId !== input.storeId) throw new SettlementError("WRONG_STORE");
      if (receivable.status !== "OUTSTANDING" && receivable.status !== "PARTIAL") {
        throw new SettlementError("NOT_OUTSTANDING");
      }

      /*
       * Netted against PENDING settlements' `StoreSettlementInvoice` rows, computed inside this
       * transaction via `tx` — the same reasoning as the retur guard below. Without this, two
       * salesmen could each select the same receivable for its full outstanding amount, both pass
       * every other guard, and both collect cash at the counter before either settlement reaches
       * approval.
       */
      const outstanding = roundCents(Number(receivable.outstandingAmount));
      const otherInvoiceClaims = await tx.storeSettlementInvoice.aggregate({
        where: { receivableId: invoice.receivableId, settlement: { status: "PENDING" } },
        _sum: { amount: true },
      });
      const claimedByOthers = roundCents(Number(otherInvoiceClaims._sum.amount ?? 0));
      const remaining = roundCents(outstanding - claimedByOthers);
      if (roundCents(invoice.amount) - remaining > EPSILON) throw new SettlementError("INVOICE_OVERCLAIMED");
    }

    /*
     * Step 4: for each retur referenced by a deduction, verify eligibility and net this claim
     * against the retur's remaining headroom. Deductions are grouped by fieldReturnId first so
     * that two RETUR_OFFSET lines against the same retur within this one submission are checked
     * together, not independently against the same stale headroom.
     */
    const returIds = Array.from(
      new Set(
        input.deductions
          .filter((d) => d.type === "RETUR_OFFSET" && !!d.fieldReturnId)
          .map((d) => d.fieldReturnId as string),
      ),
    );
    for (const fieldReturnId of returIds) {
      const fieldReturn = await tx.fieldReturn.findUnique({
        where: { id: fieldReturnId },
        select: {
          id: true, storeId: true, status: true, valuationStatus: true,
          totalValue: true, appliedValue: true,
        },
      });
      if (!fieldReturn) throw new SettlementError("FIELD_RETURN_NOT_FOUND");
      if (fieldReturn.storeId !== input.storeId) throw new SettlementError("RETUR_WRONG_STORE");
      if (fieldReturn.status !== "APPROVED") throw new SettlementError("RETURN_NOT_APPROVED");
      if (fieldReturn.valuationStatus !== "VALUED" || fieldReturn.totalValue === null) {
        throw new SettlementError("NOT_VALUED");
      }

      const totalValue = roundCents(Number(fieldReturn.totalValue));
      const appliedValue = roundCents(Number(fieldReturn.appliedValue));

      /*
       * Netted against PENDING settlements' deductions, computed inside this transaction via `tx`
       * — not the top-level `prisma` singleton, and not read before `runSerializable` opened. Two
       * concurrent submissions each reading a stale sum outside the transaction would both
       * individually pass this guard and together over-claim the retur; `Serializable` isolation
       * plus this in-transaction read is what forces the second one to either see the first's
       * committed row or hit a serialization conflict and retry.
       */
      const otherClaims = await tx.storeSettlementDeduction.aggregate({
        where: { type: "RETUR_OFFSET", fieldReturnId, settlement: { status: "PENDING" } },
        _sum: { amount: true },
      });
      const claimedByOthers = roundCents(Number(otherClaims._sum.amount ?? 0));
      const remaining = roundCents(totalValue - appliedValue - claimedByOthers);

      const requestedForThisReturn = roundCents(
        input.deductions
          .filter((d) => d.type === "RETUR_OFFSET" && d.fieldReturnId === fieldReturnId)
          .reduce((sum, d) => sum + (d.amount ?? 0), 0),
      );
      if (requestedForThisReturn - remaining > EPSILON) throw new SettlementError("RETUR_OVERCLAIMED");
    }

    /*
     * Step 5: recompute totals with the SERVER's own figures — the client never supplies an
     * `expected` amount, and this is never trusted from anywhere else either.
     */
    const totals = computeSettlementTotals(
      input.invoices.map((invoice) => invoice.amount),
      input.deductions,
    );
    if (totals.expected < -EPSILON) throw new SettlementError("DEDUCTIONS_EXCEED_INVOICES");

    const actualAmount = roundCents(input.actualAmount);
    const varianceAmount = computeVariance(totals.expected, actualAmount);
    /* The configurable tolerance belongs to the approval queue in a later slice — here ANY
     * non-zero variance flags, so there is exactly one place that ever hardcodes a threshold. */
    const isFlagged = Math.abs(varianceAmount) > EPSILON;

    /*
     * Step 6: mint the document number and create the settlement with its invoice and deduction
     * rows. The ADMIN_FEE deduction row stores the computed rupiah amount (`totals.adminFee`),
     * never the client's bare percent, since the schema's `amount` column is non-nullable.
     */
    const docNo = await generateDocNumber("BKM", tx);

    const settlement = await tx.storeSettlement.create({
      data: {
        docNo,
        storeId: input.storeId,
        salesmanId: input.salesmanId,
        expectedAmount: totals.expected,
        actualAmount,
        varianceAmount,
        isFlagged,
        status: "PENDING",
        note: input.note,
        idempotencyKey: input.draftId,
        invoices: {
          create: input.invoices.map((invoice) => ({
            receivableId: invoice.receivableId,
            amount: roundCents(invoice.amount),
          })),
        },
        deductions: {
          create: input.deductions.map((deduction) => ({
            type: deduction.type,
            amount: deduction.type === "ADMIN_FEE" ? totals.adminFee : roundCents(deduction.amount ?? 0),
            percent: deduction.type === "ADMIN_FEE" ? deduction.percent : null,
            fieldReturnId: deduction.type === "RETUR_OFFSET" ? deduction.fieldReturnId : null,
            note: deduction.note,
            proofUrl: deduction.proofUrl,
            proofR2Key: deduction.proofR2Key,
          })),
        },
      },
      select: { id: true, docNo: true },
    });

    return { settlementId: settlement.id, docNo: settlement.docNo };
  });
}
