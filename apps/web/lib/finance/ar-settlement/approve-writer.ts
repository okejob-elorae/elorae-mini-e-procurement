import { prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { runSerializable } from "@/lib/db/tx-retry";
import { recordPayment } from "@/lib/finance/ar/payment-writer";
import { applyReturnOffset } from "@/lib/finance/ar/retur-offset-writer";
import { allocateOldestFirst, type AllocationInput, type AllocationOutput } from "./allocate";
import { computeSettlementTotals, computeVariance } from "./calc";
import { SettlementError } from "./errors";
import { parseVarianceTolerance, VARIANCE_TOLERANCE_SETTING_KEY } from "./variance-tolerance";

export type ApproveSettlementInput = {
  settlementId: string;
  approvedById: string;
  overrideReason?: string;
};

export type ApproveSettlementResult = {
  ok: true;
  paymentIds: string[];
  alreadyApproved?: true;
};

const EPSILON = 1e-6;

/**
 * `AuditLog.reason` is a bare `String?` in the Prisma schema — no `@db.Text` — which is MySQL
 * `VARCHAR(191)`. An override reason longer than that would pass every guard here and then die at
 * insert with a data-truncation error, AFTER every component has already posted, leaving the
 * settlement PENDING with real payments behind it.
 */
const MAX_OVERRIDE_REASON_LENGTH = 191;

/**
 * `SettlementDeductionType` and `PaymentMethod` are two different enums that only LOOK aligned:
 * `RETUR_OFFSET` and `ADMIN_FEE` spell the same in both, `PROGRAM` does not — its payment method
 * is `PROGRAM_DEDUCTION`. A cast (`deduction.type as PaymentMethod`) therefore compiles cleanly
 * and then dies at the MariaDB `ENUM` column with a data-truncation error at runtime, mid
 * approval, with earlier components already posted. This map is the only permitted translation.
 */
const DEDUCTION_TYPE_TO_PAYMENT_METHOD = {
  RETUR_OFFSET: "RETUR_OFFSET",
  PROGRAM: "PROGRAM_DEDUCTION",
  ADMIN_FEE: "ADMIN_FEE",
} as const satisfies Record<"RETUR_OFFSET" | "PROGRAM" | "ADMIN_FEE", string>;

type SettlementPaymentMethod = "CASH" | "RETUR_OFFSET" | "PROGRAM_DEDUCTION" | "ADMIN_FEE";

type InvoiceRow = { receivableId: string; amount: number };

type Component =
  | {
      kind: "RETUR";
      method: "RETUR_OFFSET";
      amount: number;
      idempotencyKey: string;
      returnId: string;
      eventId: string;
    }
  | {
      kind: "SIMPLE";
      method: Exclude<SettlementPaymentMethod, "RETUR_OFFSET">;
      amount: number;
      idempotencyKey: string;
    };

/**
 * The per-component idempotency key. `applyReturnOffset` mints its own internally as
 * `returoffset-<returnId>-<eventId>`, so the retur components must reproduce that spelling
 * EXACTLY rather than inventing a `settlement-` key of their own — this writer looks payments up
 * by key to decide what a resumed approval still owes, and a key that does not match the one
 * `applyReturnOffset` actually wrote would make every resume re-draw the retur.
 */
function returComponentKey(returnId: string, deductionId: string): string {
  return `returoffset-${returnId}-${deductionId}`;
}

function simpleComponentKey(settlementId: string, method: SettlementPaymentMethod): string {
  return `settlement-${settlementId}-${method}`;
}

function sumAllocations(allocations: AllocationOutput[]): number {
  return roundCents(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
}

/**
 * The headroom every component allocates against, recomputed from the database immediately before
 * that component posts. It is NOT the receivable's raw balance, and it is NOT snapshotted once for
 * the whole approval.
 *
 * All four components settle the SAME set of invoices, so each one must see what its predecessors
 * already took. Per invoice the ceiling is the lower of two independent caps:
 *
 *   - the LIVE `Receivable.outstandingAmount`, which stops the settlement paying more than the
 *     invoice still owes (it may have moved since submission — another collection, another
 *     settlement, a direct payment);
 *   - `StoreSettlementInvoice.amount` minus what THIS settlement's own already-posted components
 *     allocated to that receivable, which stops it paying more of that invoice than the store
 *     actually agreed at the counter to settle.
 *
 * Snapshotting once up front instead would hand component 1 and component 2 the same oldest
 * invoice at its full balance; the second `recordPayment` then dies on its own per-line
 * `OVER_ALLOCATED` check and the settlement is stranded PENDING with money already moved.
 * Deterministic keys make that resumable rather than corrupt, but nothing in the UI can clear it.
 *
 * The already-allocated term is read back from the POSTED payments carrying this settlement's own
 * component keys, never from a running total held in memory: on a RESUME the predecessor payments
 * were written by an earlier process, so an in-memory tally would start at zero and over-state the
 * remaining agreed amount. VOIDED payments are excluded, symmetrically with the live balance,
 * which a void has already restored.
 */
async function computeComponentHeadroom(
  invoiceRows: InvoiceRow[],
  componentKeys: string[],
): Promise<AllocationInput[]> {
  const posted = await prisma.payment.findMany({
    where: { idempotencyKey: { in: componentKeys }, status: "POSTED" },
    select: { allocations: { select: { receivableId: true, amount: true } } },
  });

  const allocatedByReceivable = new Map<string, number>();
  for (const payment of posted) {
    for (const allocation of payment.allocations) {
      const prior = allocatedByReceivable.get(allocation.receivableId) ?? 0;
      allocatedByReceivable.set(
        allocation.receivableId,
        roundCents(prior + Number(allocation.amount)),
      );
    }
  }

  const receivables = await prisma.receivable.findMany({
    where: { id: { in: invoiceRows.map((row) => row.receivableId) } },
    select: { id: true, dueDate: true, outstandingAmount: true },
  });
  const receivableById = new Map(receivables.map((receivable) => [receivable.id, receivable]));

  const headroom: AllocationInput[] = [];
  for (const row of invoiceRows) {
    const receivable = receivableById.get(row.receivableId);
    if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
    const live = roundCents(Number(receivable.outstandingAmount));
    const agreedRemaining = roundCents(row.amount - (allocatedByReceivable.get(row.receivableId) ?? 0));
    headroom.push({
      receivableId: row.receivableId,
      dueDate: receivable.dueDate,
      outstandingAmount: Math.max(0, Math.min(live, agreedRemaining)),
    });
  }
  return headroom;
}

/**
 * Approves a submitted settlement: every non-zero component posts as a real `Payment` against the
 * settlement's own invoices, and only once all of them have committed does the document flip to
 * `APPROVED`.
 *
 * **This is a resumable sequence, not a transaction, and it must not pretend to be one.**
 * `recordPayment` and `applyReturnOffset` each open their own `prisma.$transaction`, and nesting
 * those on the same client is unsafe. What makes a crash mid-approval safe is that every component
 * carries a DETERMINISTIC idempotency key: re-approving finds what already posted, skips it, posts
 * the remainder and flips the status. A settlement that reads `APPROVED` therefore means every
 * component committed — the converse of a settlement stranded `PENDING`, which means some may
 * have.
 *
 * The status flip is the LAST write for a second reason beyond resumability. The submit writer's
 * retur and invoice claims are DERIVED from `PENDING` settlements, so a settlement that stops
 * being `PENDING` stops reserving anything. Flipping ahead of the retur draw would leave the
 * retur's headroom overstated by exactly the approved amount for the length of that window.
 *
 * Component order is fixed — every retur draw, then the trade-program deduction, then the admin
 * fee, then the cash the store handed over — so a resumed approval walks the same sequence and
 * produces the same allocation across the same invoices.
 *
 * Posts NO journals. `postArJournalSafely` runs in the action after this returns, so a throwing
 * journal builder degrades to a `JOURNAL_PENDING` flag instead of crashing a live approval.
 *
 * Throws `SettlementError` for everything it refuses itself, and propagates `PaymentError`
 * unmodified from `recordPayment`/`applyReturnOffset` — two error classes with overlapping code
 * strings and different `instanceof`, so a caller mapping reasons must handle both.
 */
export async function approveSettlement(
  input: ApproveSettlementInput,
): Promise<ApproveSettlementResult> {
  const settlement = await prisma.storeSettlement.findUnique({
    where: { id: input.settlementId },
    select: {
      id: true,
      docNo: true,
      storeId: true,
      status: true,
      actualAmount: true,
      invoices: { select: { receivableId: true, amount: true } },
      deductions: {
        select: {
          id: true,
          type: true,
          amount: true,
          percent: true,
          fieldReturnId: true,
          proofUrl: true,
          proofR2Key: true,
        },
      },
    },
  });
  if (!settlement) throw new SettlementError("SETTLEMENT_NOT_FOUND");

  const invoiceRows: InvoiceRow[] = settlement.invoices.map((invoice) => ({
    receivableId: invoice.receivableId,
    amount: roundCents(Number(invoice.amount)),
  }));

  /**
   * Deduction rows are ordered by id so a resumed approval walks the retur draws in the same
   * sequence as the run that crashed — Prisma gives no ordering guarantee otherwise, and two runs
   * that disagree would allocate the same draws across different invoices.
   */
  const deductions = [...settlement.deductions].sort((a, b) => a.id.localeCompare(b.id));
  const returDeductions = deductions.filter((deduction) => deduction.type === "RETUR_OFFSET");

  const totals = computeSettlementTotals(
    invoiceRows.map((row) => row.amount),
    deductions.map((deduction) => ({
      type: deduction.type,
      amount: Number(deduction.amount),
      percent: deduction.percent === null ? undefined : Number(deduction.percent),
    })),
  );
  const actualAmount = roundCents(Number(settlement.actualAmount));

  /**
   * Every component this settlement can own, in the order they post. The keys are needed even on
   * the already-approved replay path below, which reports the payments a prior run created rather
   * than re-deriving anything.
   */
  const components: Component[] = [];
  for (const deduction of returDeductions) {
    if (!deduction.fieldReturnId) throw new SettlementError("MISSING_FIELD_RETURN_ID");
    components.push({
      kind: "RETUR",
      method: DEDUCTION_TYPE_TO_PAYMENT_METHOD.RETUR_OFFSET,
      amount: roundCents(Number(deduction.amount)),
      idempotencyKey: returComponentKey(deduction.fieldReturnId, deduction.id),
      returnId: deduction.fieldReturnId,
      eventId: deduction.id,
    });
  }
  const programMethod = DEDUCTION_TYPE_TO_PAYMENT_METHOD.PROGRAM;
  components.push({
    kind: "SIMPLE",
    method: programMethod,
    amount: totals.programTotal,
    idempotencyKey: simpleComponentKey(settlement.id, programMethod),
  });
  const adminFeeMethod = DEDUCTION_TYPE_TO_PAYMENT_METHOD.ADMIN_FEE;
  components.push({
    kind: "SIMPLE",
    method: adminFeeMethod,
    amount: totals.adminFee,
    idempotencyKey: simpleComponentKey(settlement.id, adminFeeMethod),
  });
  /**
   * The cash tender always posts as `CASH`. `StoreSettlement` carries no `method` column at all —
   * `actualAmount` is money the salesman physically holds at the counter — so `TRANSFER` is
   * unreachable from this document and no branch exists for it.
   */
  components.push({
    kind: "SIMPLE",
    method: "CASH",
    amount: actualAmount,
    idempotencyKey: simpleComponentKey(settlement.id, "CASH"),
  });

  const componentKeys = components.map((component) => component.idempotencyKey);

  /**
   * The replay lookup runs FIRST, ahead of every guard below, the same shape as
   * `submitSettlement`'s. A settlement already `APPROVED` must report the payments it posted
   * rather than re-deriving guards against state its own approval already changed — a retur it
   * drew is no longer at full headroom, and a receivable it cleared is no longer OUTSTANDING.
   */
  const existingPayments = await prisma.payment.findMany({
    where: { idempotencyKey: { in: componentKeys } },
    select: { id: true, idempotencyKey: true, status: true },
  });
  const paymentByKey = new Map<string, (typeof existingPayments)[number]>();
  for (const payment of existingPayments) {
    if (payment.idempotencyKey !== null) paymentByKey.set(payment.idempotencyKey, payment);
  }

  if (settlement.status === "APPROVED") {
    const posted = components
      .map((component) => paymentByKey.get(component.idempotencyKey))
      .filter((payment): payment is NonNullable<typeof payment> => payment !== undefined);
    return { ok: true, paymentIds: posted.map((payment) => payment.id), alreadyApproved: true };
  }
  if (settlement.status !== "PENDING") throw new SettlementError("NOT_PENDING");

  /**
   * `StoreSettlement.reviewedBy` is an optional relation, but `AuditLog.user` is a REQUIRED one,
   * and under `relationMode = "prisma"` there is no database foreign key behind either — a
   * dangling approver id is genuinely reachable and would throw `Inconsistent query result` on
   * every future read through the audit row, after the money had already moved.
   */
  const approver = await prisma.user.findUnique({
    where: { id: input.approvedById },
    select: { id: true },
  });
  if (!approver) throw new SettlementError("APPROVER_NOT_FOUND");

  /**
   * Re-validate the whole checklist server-side. The queue screen shows all of it, but this
   * function is an independently callable endpoint reached through a `"use server"` export, and
   * anything the queue checked could have moved between the operator reading it and clicking.
   */
  if (invoiceRows.length === 0) throw new SettlementError("NO_INVOICES");

  const receivables = await prisma.receivable.findMany({
    where: { id: { in: invoiceRows.map((row) => row.receivableId) } },
    select: { id: true, storeId: true, status: true },
  });
  const receivableById = new Map(receivables.map((receivable) => [receivable.id, receivable]));
  for (const row of invoiceRows) {
    const receivable = receivableById.get(row.receivableId);
    if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
    if (receivable.storeId !== settlement.storeId) throw new SettlementError("WRONG_STORE");
    if (receivable.status !== "OUTSTANDING" && receivable.status !== "PARTIAL") {
      throw new SettlementError("NOT_OUTSTANDING");
    }
  }

  for (const deduction of deductions) {
    if (deduction.type === "RETUR_OFFSET") continue;
    /*
     * Evidence is a submit-time requirement for every non-retur deduction; a row that lost it
     * since — a botched correction, a raw call that created it another way — must not be approved
     * into a real expense posting with nothing behind it.
     */
    if (!deduction.proofUrl || !deduction.proofR2Key) throw new SettlementError("MISSING_EVIDENCE");
  }

  for (const component of components) {
    if (component.kind !== "RETUR") continue;
    const fieldReturn = await prisma.fieldReturn.findUnique({
      where: { id: component.returnId },
      select: { id: true, storeId: true, status: true, valuationStatus: true, totalValue: true },
    });
    if (!fieldReturn) throw new SettlementError("FIELD_RETURN_NOT_FOUND");
    if (fieldReturn.storeId !== settlement.storeId) throw new SettlementError("RETUR_WRONG_STORE");
    if (fieldReturn.status !== "APPROVED") throw new SettlementError("RETURN_NOT_APPROVED");
    if (fieldReturn.valuationStatus !== "VALUED" || fieldReturn.totalValue === null) {
      throw new SettlementError("NOT_VALUED");
    }
  }

  /**
   * The variance gate. The tolerance is read from `SystemSetting` and parsed fail-open to zero,
   * so an unconfigured or malformed environment asks for MORE explanation, never less.
   */
  const toleranceRow = await prisma.systemSetting.findUnique({
    where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
    select: { value: true },
  });
  const tolerance = parseVarianceTolerance(toleranceRow?.value);
  const variance = computeVariance(totals.expected, actualAmount);

  const overrideReason = (input.overrideReason ?? "").trim();
  /*
   * Same visible-content check as `rejectCollection` and `voidPayment`: a reason made only of
   * zero-width/format characters (Unicode `Cf`, e.g. U+200B) or U+2800 BRAILLE PATTERN BLANK
   * survives `.trim()` unchanged and would otherwise persist as an audit trail that renders blank.
   */
  const hasVisibleReason = /[^\s\p{Cf}\u2800]/u.test(overrideReason);
  const needsOverride = Math.abs(variance) - tolerance > EPSILON;
  if (needsOverride) {
    if (!hasVisibleReason) throw new SettlementError("VARIANCE_REQUIRES_REASON");
    if (overrideReason.length > MAX_OVERRIDE_REASON_LENGTH) {
      throw new SettlementError("INPUT_TOO_LARGE");
    }
  }

  /**
   * Pre-flight: refuse an approval that cannot possibly allocate before ANY money moves. Without
   * this the shortfall surfaces mid-sequence — the earlier components already posted, the
   * settlement stranded `PENDING` — for a document that was never approvable in the first place.
   * The comparison nets what a prior run already posted on both sides: components that already
   * have a payment are not owed again, and the headroom already excludes what they consumed.
   */
  const owedComponents = components.filter(
    (component) => component.amount > 0 && !paymentByKey.has(component.idempotencyKey),
  );
  const totalOwed = roundCents(
    owedComponents.reduce((sum, component) => sum + component.amount, 0),
  );
  const preflightHeadroom = await computeComponentHeadroom(invoiceRows, componentKeys);
  const totalHeadroom = roundCents(
    preflightHeadroom.reduce((sum, row) => sum + row.outstandingAmount, 0),
  );
  if (totalOwed - totalHeadroom > EPSILON) {
    throw new SettlementError("COMPONENT_EXCEEDS_HEADROOM");
  }

  const paidAt = new Date();
  const paymentIds: string[] = [];

  for (const component of components) {
    if (!(component.amount > 0)) continue;

    /**
     * The resume skip. A component whose payment already exists is NOT re-posted and NOT
     * re-allocated: `computeComponentHeadroom` has already netted it out, so re-deriving its
     * allocation here would fail to fill and throw `COMPONENT_EXCEEDS_HEADROOM` on a settlement
     * that is perfectly resumable.
     *
     * A VOIDED prior payment is refused rather than skipped. `recordPayment`'s own idempotency
     * lookup would hand that voided row straight back and report success for a component that
     * moved no money, and `applyReturnOffset` already refuses the same case with
     * `PAYMENT_VOIDED` — this is the cash/program/fee half of that guard.
     */
    const existing = paymentByKey.get(component.idempotencyKey);
    if (existing) {
      if (existing.status === "VOIDED") throw new SettlementError("COMPONENT_VOIDED");
      paymentIds.push(existing.id);
      continue;
    }

    const headroom = await computeComponentHeadroom(invoiceRows, componentKeys);
    const allocations = allocateOldestFirst(component.amount, headroom);
    if (Math.abs(sumAllocations(allocations) - component.amount) > EPSILON) {
      throw new SettlementError("COMPONENT_EXCEEDS_HEADROOM");
    }

    if (component.kind === "RETUR") {
      const applied = await applyReturnOffset({
        returnId: component.returnId,
        eventId: component.eventId,
        drawAmount: component.amount,
        allocations,
        appliedById: input.approvedById,
      });
      paymentIds.push(applied.paymentId);
      continue;
    }

    const { paymentId } = await recordPayment({
      storeId: settlement.storeId,
      paidAt,
      method: component.method,
      amount: component.amount,
      recordedById: input.approvedById,
      allocations,
      reference: settlement.docNo,
      idempotencyKey: component.idempotencyKey,
    });
    paymentIds.push(paymentId);
  }

  /**
   * The status flip, last. `runSerializable` COMMITS on a normal return and rolls back only on a
   * throw, so the zero-count arm below is deliberately write-free — the audit row is created only
   * after the CAS actually matched.
   */
  return runSerializable<ApproveSettlementResult>(async (tx) => {
    const flipped = await tx.storeSettlement.updateMany({
      where: { id: settlement.id, status: "PENDING" },
      data: {
        status: "APPROVED",
        reviewedById: input.approvedById,
        reviewedAt: new Date(),
      },
    });

    if (flipped.count === 0) {
      /*
       * Zero rows matched does not always mean "a concurrent approval already flipped this" —
       * `StoreSettlementStatus` also has REJECTED, and a concurrent reject between the read at the
       * top of this function and this CAS produces the same zero count. By now the components
       * above have committed real payments and decremented real receivables, so reporting success
       * for a rejected document would hide payments orphaned from it. Re-read and only treat a
       * genuine APPROVED landing as the safe race.
       */
      const current = await tx.storeSettlement.findUnique({
        where: { id: settlement.id },
        select: { status: true },
      });
      if (current?.status === "APPROVED") {
        return { ok: true, paymentIds, alreadyApproved: true };
      }
      console.error(
        `[approveSettlement] orphaned payments: settlement ${settlement.id} landed on status=${current?.status ?? "MISSING"} after ${paymentIds.length} component payment(s) posted`,
      );
      throw new SettlementError("NOT_PENDING");
    }

    /**
     * The override is recorded here rather than in the action because the tolerance and the
     * variance it was measured against are known only to this function. The action writes its own
     * `SETTLEMENT_APPROVE` row for the approval itself; this one exists solely for the exception.
     */
    if (needsOverride) {
      await tx.auditLog.create({
        data: {
          userId: input.approvedById,
          action: "SETTLEMENT_VARIANCE_OVERRIDE",
          entityType: "StoreSettlement",
          entityId: settlement.id,
          reason: overrideReason,
          metadata: {
            docNo: settlement.docNo,
            expectedAmount: totals.expected,
            actualAmount,
            varianceAmount: variance,
            toleranceRupiah: tolerance,
          },
        },
      });
    }

    return { ok: true, paymentIds };
  });
}
