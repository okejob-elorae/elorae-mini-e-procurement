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
 * claim the same retur credit.
 *
 * A retur's remaining headroom is `totalValue - appliedValue - Σ(RETUR_OFFSET deduction amounts
 * on OTHER PENDING settlements for that retur)`, and that sum is computed with the TRANSACTION
 * client, inside this same `runSerializable` call — the identical shape as
 * `submitCollection`'s over-collection guard in `lib/finance/collections/submit-writer.ts`. A read
 * taken before the transaction (or against the top-level `prisma` singleton) would let two
 * settlements race through the same headroom, both collect cash from a store, and leave the loser
 * refused only later, at approval, after the money already changed hands.
 *
 * The claim is DERIVED, never stored: a settlement that stops being PENDING (rejected, or later
 * approved into something else) stops contributing to the sum by construction. There is no
 * `claimedValue` column to keep in sync and no release path to forget on reject.
 */
export async function submitSettlement(input: SubmitSettlementInput): Promise<SubmitSettlementResult> {
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

    /* Step 2: validate shapes — positive amounts, percent in range, at most one ADMIN_FEE, and
     * evidence for every deduction type except RETUR_OFFSET (which auto-links the retur's own
     * nota instead of a fresh upload). */
    if (!Array.isArray(input.invoices) || input.invoices.length === 0) {
      throw new SettlementError("NO_INVOICES");
    }
    for (const invoice of input.invoices) {
      if (!(invoice.amount > 0)) throw new SettlementError("INVALID_AMOUNT");
    }

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
          throw new SettlementError("FIELD_RETURN_NOT_FOUND");
        }
      }
    }
    if (adminFeeCount > 1) throw new SettlementError("DUPLICATE_ADMIN_FEE");

    for (const deduction of input.deductions) {
      if (deduction.type === "RETUR_OFFSET") continue;
      if (!deduction.proofUrl || !deduction.proofR2Key) throw new SettlementError("MISSING_EVIDENCE");
    }

    /*
     * Step 3: load every selected receivable and verify it belongs to this store and is still
     * collectible. `relationMode = "prisma"` means there is no database FK behind
     * `StoreSettlementInvoice.receivableId` — a dangling id is genuinely reachable and must be
     * caught here, not assumed away.
     */
    const receivableIds = input.invoices.map((invoice) => invoice.receivableId);
    const receivables = await tx.receivable.findMany({
      where: { id: { in: receivableIds } },
      select: { id: true, storeId: true, status: true },
    });
    const receivableById = new Map(receivables.map((r) => [r.id, r]));
    for (const invoice of input.invoices) {
      const receivable = receivableById.get(invoice.receivableId);
      if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
      if (receivable.storeId !== input.storeId) throw new SettlementError("WRONG_STORE");
      if (receivable.status !== "OUTSTANDING" && receivable.status !== "PARTIAL") {
        throw new SettlementError("NOT_OUTSTANDING");
      }
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
      if (fieldReturn.storeId !== input.storeId) throw new SettlementError("WRONG_STORE");
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

    /* Step 5: recompute totals with the SERVER's own figures — the client never supplies an
     * `expected` amount, and this is never trusted from anywhere else either. */
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

    /* Step 6: mint the document number and create the settlement with its invoice and deduction
     * rows. The ADMIN_FEE deduction row stores the computed rupiah amount (`totals.adminFee`),
     * never the client's bare percent, since the schema's `amount` column is non-nullable. */
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
