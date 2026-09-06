import { roundCents } from "@elorae/db/pricing";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { urlFromKey } from "@/lib/r2";
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
 * Bounds on a "use server" export are load-bearing, not cosmetic — a raw request never went
 * through the client's own limits (the note Textarea's maxLength, the single-photo-per-row
 * shape). Without these, a caller can hit a Decimal(15,2) range error on a bare `1e20` amount, a
 * MySQL 1406 data-truncation on an oversized note, or 10,000 sequential per-line aggregates
 * inside one serializable transaction — all surfacing as an opaque UNEXPECTED instead of a named,
 * cheap-to-reject code.
 */
const MAX_LINES = 200;
const MAX_NOTE_LENGTH = 1000;
/**
 * `StoreSettlementDeduction.proofR2Key`/`proofUrl` are bare `String?` in the Prisma schema — no
 * `@db.Text` — which is MySQL `VARCHAR(191)`. 300 was never the real ceiling: a key that passed
 * the prefix check and a 300-character bound still died at insert with a data-truncation error,
 * surfacing as a bare `UNEXPECTED` instead of this named, cheap-to-reject code. `proofUrl` is
 * derived from the key via `urlFromKey` (`PUBLIC_URL + "/" + key`), so it is ALWAYS longer than
 * the key and env-dependent — capping the key alone does not protect the column the URL lands in.
 * Real keys run ~68 characters and real URLs ~130, so nothing legitimate is refused at 191.
 */
const MAX_PROOF_KEY_LENGTH = 191;
const MAX_PROOF_URL_LENGTH = 191;
const MAX_AMOUNT = 999_999_999.99;

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
 *
 * The idempotency replay itself is scoped to the SAME actor at the SAME store: a `draftId`
 * collision from a different `salesmanId`/`storeId` is refused (`DRAFT_ID_CONFLICT`) rather than
 * handing that caller someone else's real settlement id and docNo back as a reported success.
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
     * re-derive a guard (e.g. the retur headroom) against state the first attempt itself changed
     * — but ONLY when the replay is the SAME actor at the SAME store. A `draftId` collision from a
     * DIFFERENT salesman or store (low-entropy client-minted id, or a bug reusing one) must not be
     * handed someone else's real settlement id and docNo back as if it were their own successful
     * submission. Same shape as `completeDeliveryShipment`'s replay guard in `AGENTS.md`: a
     * same-actor replay against already-settled state returns success, a different-actor replay
     * against the same state is refused outright.
     */
    const existing = await tx.storeSettlement.findUnique({
      where: { idempotencyKey: input.draftId },
      select: { id: true, docNo: true, salesmanId: true, storeId: true },
    });
    if (existing) {
      if (existing.salesmanId !== input.salesmanId || existing.storeId !== input.storeId) {
        throw new SettlementError("DRAFT_ID_CONFLICT");
      }
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
    if (input.invoices.length > MAX_LINES) throw new SettlementError("INPUT_TOO_LARGE");
    if (!(input.actualAmount >= 0) || input.actualAmount > MAX_AMOUNT) {
      throw new SettlementError("INVALID_AMOUNT");
    }
    if (input.note !== undefined && input.note.length > MAX_NOTE_LENGTH) {
      throw new SettlementError("INPUT_TOO_LARGE");
    }

    const seenReceivableIds = new Set<string>();
    for (const invoice of input.invoices) {
      if (!(invoice.amount > 0) || invoice.amount > MAX_AMOUNT) throw new SettlementError("INVALID_AMOUNT");
      if (seenReceivableIds.has(invoice.receivableId)) throw new SettlementError("DUPLICATE_INVOICE");
      seenReceivableIds.add(invoice.receivableId);
    }

    if (!Array.isArray(input.deductions)) throw new SettlementError("INVALID_DEDUCTIONS");
    if (input.deductions.length > MAX_LINES) throw new SettlementError("INPUT_TOO_LARGE");

    let adminFeeCount = 0;
    for (const deduction of input.deductions) {
      if (deduction.type === "ADMIN_FEE") {
        adminFeeCount += 1;
        if (typeof deduction.percent !== "number" || !(deduction.percent >= 0) || deduction.percent > 100) {
          throw new SettlementError("INVALID_PERCENT");
        }
      } else {
        if (typeof deduction.amount !== "number" || !(deduction.amount > 0) || deduction.amount > MAX_AMOUNT) {
          throw new SettlementError("INVALID_AMOUNT");
        }
        if (deduction.type === "RETUR_OFFSET" && !deduction.fieldReturnId) {
          throw new SettlementError("MISSING_FIELD_RETURN_ID");
        }
      }
      if (deduction.note !== undefined && deduction.note.length > MAX_NOTE_LENGTH) {
        throw new SettlementError("INPUT_TOO_LARGE");
      }
    }
    if (adminFeeCount > 1) throw new SettlementError("DUPLICATE_ADMIN_FEE");

    const seenProofKeys = new Set<string>();
    const proofKeyPrefix = `settlement-proofs/${input.draftId}/`;
    for (const deduction of input.deductions) {
      /*
       * These two length checks run BEFORE the RETUR_OFFSET `continue` below and therefore apply
       * to every deduction type, RETUR_OFFSET included. The create block at the bottom of this
       * function persists proof columns unconditionally (`proofR2Key ? urlFromKey(...) :
       * deduction.proofUrl`), so a RETUR_OFFSET deduction — exempt from `MISSING_EVIDENCE` and
       * often submitted with no `proofR2Key` at all — still writes whatever `proofUrl` the caller
       * supplied directly into the same VARCHAR(191) column. Checking only inside the
       * evidence-required branch left that column unguarded for exactly this row type.
       */
      if (deduction.proofR2Key !== undefined && deduction.proofR2Key.length > MAX_PROOF_KEY_LENGTH) {
        throw new SettlementError("INPUT_TOO_LARGE");
      }
      /*
       * The EFFECTIVE url — what actually gets written below, the DERIVED url when a
       * `proofR2Key` is present, otherwise the caller's own `proofUrl` verbatim — must
       * independently clear the same VARCHAR(191) column. A key just under 191 can still yield a
       * derived url over it once `PUBLIC_URL + "/"` is prepended.
       */
      const effectiveProofUrl = deduction.proofR2Key ? urlFromKey(deduction.proofR2Key) : deduction.proofUrl;
      if (effectiveProofUrl !== undefined && effectiveProofUrl.length > MAX_PROOF_URL_LENGTH) {
        throw new SettlementError("INPUT_TOO_LARGE");
      }

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

    /**
     * Step 3: verify the salesman is a real row — `StoreSettlement.salesman` is a REQUIRED
     * relation, and under `relationMode = "prisma"` there is no FK behind it, so a dangling id
     * would commit a row that throws `Inconsistent query result` on every future query selecting
     * through it, with no UI repair path. `StoreSettlement.store` is the same shape of required,
     * FK-less relation, so a receivable pointing at a deleted store gets the identical check.
     */
    const salesman = await tx.user.findUnique({ where: { id: input.salesmanId }, select: { id: true } });
    if (!salesman) throw new SettlementError("SALESMAN_NOT_FOUND");

    const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true } });
    if (!store) throw new SettlementError("STORE_NOT_FOUND");

    /**
     * Then load every selected receivable, verify it belongs to this store, is still collectible,
     * and — this is the part the screen's own scoping was standing in for — that the SUBMITTING
     * salesman actually has a relationship to it (its collector, or its order's salesman). Without
     * this a raw request naming a receivable assigned to a DIFFERENT salesman/collector at a
     * shared store would still pass every other guard and stamp a PENDING settlement over money
     * that isn't this caller's to claim, with no release path until an approval slice that does
     * not yet exist. Same shape as `submitCollection`'s `NOT_ASSIGNED_COLLECTOR` guard in
     * `lib/finance/collections/submit-writer.ts`. Finally net this submission's claim against
     * OTHER PENDING settlements' claims on the same receivable — the invoice-side twin of the
     * retur claim guard below.
     */
    const receivableIds = input.invoices.map((invoice) => invoice.receivableId);
    const receivables = await tx.receivable.findMany({
      where: { id: { in: receivableIds } },
      select: {
        id: true, storeId: true, status: true, outstandingAmount: true, collectorId: true,
        delivery: { select: { order: { select: { salesmanId: true } } } },
      },
    });
    const receivableById = new Map(receivables.map((r) => [r.id, r]));
    for (const invoice of input.invoices) {
      const receivable = receivableById.get(invoice.receivableId);
      if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
      if (receivable.storeId !== input.storeId) throw new SettlementError("WRONG_STORE");
      if (receivable.status !== "OUTSTANDING" && receivable.status !== "PARTIAL") {
        throw new SettlementError("NOT_OUTSTANDING");
      }
      if (receivable.collectorId !== input.salesmanId && receivable.delivery.order.salesmanId !== input.salesmanId) {
        throw new SettlementError("NOT_ASSIGNED");
      }

      /**
       * Netted against PENDING settlements' `StoreSettlementInvoice` rows, computed inside this
       * transaction via `tx` — the same reasoning as the retur guard below. Without this, two
       * salesmen could each select the same receivable for its full outstanding amount, both pass
       * every other guard, and both collect cash at the counter before either settlement reaches
       * approval. Scoped to `storeId` too, not just `status` — under SERIALIZABLE every plain
       * SELECT takes a shared-mode lock, and `@@index([status, createdAt])` leads on `status`
       * alone, so an unscoped filter S-locks the WHOLE PENDING range across every store. Two
       * salesmen submitting for completely unrelated stores would then lock-contend and deadlock
       * each other under load. Adding `storeId` (already proven above) moves the optimizer onto
       * `@@index([storeId, status])` and changes no semantics — only which rows get locked.
       */
      const outstanding = roundCents(Number(receivable.outstandingAmount));
      const otherInvoiceClaims = await tx.storeSettlementInvoice.aggregate({
        where: { receivableId: invoice.receivableId, settlement: { status: "PENDING", storeId: input.storeId } },
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

      /**
       * Netted against PENDING settlements' deductions, computed inside this transaction via `tx`
       * — not the top-level `prisma` singleton, and not read before `runSerializable` opened. Two
       * concurrent submissions each reading a stale sum outside the transaction would both
       * individually pass this guard and together over-claim the retur; `Serializable` isolation
       * plus this in-transaction read is what forces the second one to either see the first's
       * committed row or hit a serialization conflict and retry. Scoped to `storeId` too, same
       * reasoning as the invoice-side aggregate above — `fieldReturn.storeId` is already proven
       * to equal `input.storeId` by the `RETUR_WRONG_STORE` check, so this changes no semantics,
       * only moving the lock range from every store's PENDING rows to just this one.
       */
      const otherClaims = await tx.storeSettlementDeduction.aggregate({
        where: { type: "RETUR_OFFSET", fieldReturnId, settlement: { status: "PENDING", storeId: input.storeId } },
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
    /**
     * The configurable tolerance belongs to the approval queue in a later slice — here ANY
     * non-zero variance flags, so there is exactly one place that ever hardcodes a threshold.
     */
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
          /**
           * `proofUrl` is DERIVED from `proofR2Key` via `urlFromKey`, never the caller's own
           * `proofUrl` field — the key already went through the prefix/uniqueness validation
           * above, but the URL did not, and a raw caller could otherwise pair a validly-scoped key
           * with an arbitrary URL. The approval screen (and the BKM print route after it) would
           * then render the attacker's URL while the audited key points at real evidence.
           */
          create: input.deductions.map((deduction) => ({
            type: deduction.type,
            amount: deduction.type === "ADMIN_FEE" ? totals.adminFee : roundCents(deduction.amount ?? 0),
            percent: deduction.type === "ADMIN_FEE" ? deduction.percent : null,
            fieldReturnId: deduction.type === "RETUR_OFFSET" ? deduction.fieldReturnId : null,
            note: deduction.note,
            proofUrl: deduction.proofR2Key ? urlFromKey(deduction.proofR2Key) : deduction.proofUrl,
            proofR2Key: deduction.proofR2Key,
          })),
        },
      },
      select: { id: true, docNo: true },
    });

    return { settlementId: settlement.id, docNo: settlement.docNo };
  });
}
