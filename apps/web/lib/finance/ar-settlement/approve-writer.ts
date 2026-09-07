import { prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { runSerializable } from "@/lib/db/tx-retry";
import { recordPayment } from "@/lib/finance/ar/payment-writer";
import { applyReturnOffset } from "@/lib/finance/ar/retur-offset-writer";
import { allocateOldestFirst, type AllocationInput, type AllocationOutput } from "./allocate";
import { computeSettlementTotals, computeVariance, EPSILON } from "./calc";
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

export type SettlementPaymentMethod = "CASH" | "RETUR_OFFSET" | "PROGRAM_DEDUCTION" | "ADMIN_FEE";

export type InvoiceRow = { receivableId: string; amount: number };

/**
 * What `allocateOldestFirst` needs, plus the two raw terms behind `outstandingAmount`. Both are
 * what the `NOT_OUTSTANDING` re-validation needs to tell "this settlement still owes something on
 * this invoice" apart from "this settlement's own components already touched it" — without them a
 * resumed approval refuses itself over the very receivables its own earlier components closed.
 *
 * `agreedRemaining` is the store's agreed share of that invoice minus what this settlement has
 * already allocated to it. `settlementAllocated` is that already-allocated figure on its own, and
 * it is NOT derivable from `agreedRemaining`: a component can close the RECEIVABLE while leaving
 * part of the agreed share unspent, whenever `StoreSettlementInvoice.amount` exceeds the live
 * balance. Keeping both is what makes the two cases distinguishable.
 *
 * **THIS TYPE IS FORKED, and the fork is invisible to the compiler.** It and
 * `SettlementPaymentMethod` are exported to describe this writer's shape, not as a shared seam —
 * nothing outside this module imports either one, so a rename here type-checks cleanly across the
 * whole app. The consumer that LOOKS like it would catch a mistake does not:
 * `buildCollectibilityCheck` in `./checks` RESTATES this row structurally, as
 * `Array<{ receivableId: string; agreedRemaining: number; settlementAllocated: number }>`, so that
 * module can stay import-free of everything but this feature's own pure modules. Nothing
 * type-checks the two declarations against each other, so re-typing or renaming a field here leaves
 * `checks.ts` compiling happily against its own copy while the screen previews different arithmetic
 * from the writer it claims to mirror. Same fork shape as `EPSILON` in `calc.ts`, and the same
 * rule: change one, change the other by hand in the same commit.
 *
 * The four exports that ARE a shared seam — `computeComponentHeadroom`, `returComponentKey`,
 * `simpleComponentKey` and `InvoiceRow` — are the ones `queries.ts` actually imports, and those the
 * compiler does hold together.
 */
export type HeadroomRow = AllocationInput & {
  agreedRemaining: number;
  settlementAllocated: number;
};

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
export function returComponentKey(returnId: string, deductionId: string): string {
  return `returoffset-${returnId}-${deductionId}`;
}

export function simpleComponentKey(settlementId: string, method: SettlementPaymentMethod): string {
  return `settlement-${settlementId}-${method}`;
}

/**
 * Allocates one component across the headroom and refuses unless it fills EXACTLY. A short fill
 * would otherwise post a payment smaller than the component the document declares, settling less
 * of the store's invoices than the document says it did. The whole-document pre-flight should have
 * caught any shortfall long before this; this is the per-component belt-and-braces.
 */
function allocateForComponent(amount: number, headroom: HeadroomRow[]): AllocationOutput[] {
  const allocations = allocateOldestFirst(amount, headroom);
  const allocated = roundCents(
    allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
  );
  if (Math.abs(allocated - amount) > EPSILON) {
    throw new SettlementError("COMPONENT_EXCEEDS_HEADROOM");
  }
  return allocations;
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
 *
 * PUBLIC API — do not strip the `export`. `lib/finance/ar-settlement/queries.ts` calls this to
 * build the finance approval screen's checklist, so the preview shares this exact arithmetic
 * rather than a second copy of it. The same applies to `returComponentKey`/`simpleComponentKey`
 * above and to the `InvoiceRow` they are fed: a preview that spelled the idempotency keys itself
 * would report every already-posted component as unposted and mis-state both the headroom and the
 * retur-credit checks. Those FOUR are the shared seam. `HeadroomRow` and `SettlementPaymentMethod`
 * are exported but imported nowhere — see the warning on `HeadroomRow` above for the fork that
 * hides behind that.
 */
export async function computeComponentHeadroom(
  invoiceRows: InvoiceRow[],
  componentKeys: string[],
): Promise<HeadroomRow[]> {
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

  const headroom: HeadroomRow[] = [];
  for (const row of invoiceRows) {
    const receivable = receivableById.get(row.receivableId);
    if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
    const live = roundCents(Number(receivable.outstandingAmount));
    const settlementAllocated = allocatedByReceivable.get(row.receivableId) ?? 0;
    const agreedRemaining = roundCents(row.amount - settlementAllocated);
    headroom.push({
      receivableId: row.receivableId,
      dueDate: receivable.dueDate,
      outstandingAmount: Math.max(0, Math.min(live, agreedRemaining)),
      agreedRemaining,
      settlementAllocated,
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
 * carries a DETERMINISTIC idempotency key: re-approving finds what already posted, posts the
 * remainder and flips the status. A settlement that reads `APPROVED` therefore means every
 * component committed — the converse of a settlement stranded `PENDING`, which means some may
 * have.
 *
 * A resume SKIPS an already-posted cash/program/fee component but deliberately RE-ENTERS
 * `applyReturnOffset` for an already-posted retur draw, because that writer's replay branch re-runs
 * the projection onto `FieldReturn.appliedValue` — which is the very thing a crash between the
 * payment and the projection leaves stale. See the component loop.
 *
 * Every re-validation this function performs is therefore scoped so that a resume cannot be
 * refused by the effects of its OWN earlier components: the collectibility check only applies to
 * invoices this document still owes something on, and both pre-flights count only components that
 * have not already posted.
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
  /*
   * Existence and ownership are unconditional. The COLLECTIBILITY check is not, and deliberately
   * runs later, once the headroom is known — see the `NOT_OUTSTANDING` block below.
   */
  for (const row of invoiceRows) {
    const receivable = receivableById.get(row.receivableId);
    if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
    if (receivable.storeId !== settlement.storeId) throw new SettlementError("WRONG_STORE");
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

  const returTotalValueById = new Map<string, number>();
  for (const component of components) {
    if (component.kind !== "RETUR") continue;
    if (returTotalValueById.has(component.returnId)) continue;
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
    returTotalValueById.set(component.returnId, roundCents(Number(fieldReturn.totalValue)));
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

  /**
   * An over-tender is refused on its own terms, ahead of both the override gate and the headroom
   * pre-flight, because it is unapprovable in a way no override can rescue and no re-allocation
   * can absorb. The components sum to `invoiceTotal + variance` by construction (the deductions
   * plus the cash reconstitute the invoice total plus whatever the store handed over beyond it),
   * while the total headroom is bounded above by `invoiceTotal` — so ANY positive variance,
   * tolerated or not, leaves money with nowhere to allocate. `recordPayment` supports no unapplied
   * credit: a payment is fully allocated the moment it is recorded, on purpose, because an
   * on-account balance is its own feature with its own GL treatment.
   *
   * Without this it reported `COMPONENT_EXCEEDS_HEADROOM`, which reads as an allocation problem
   * and sends an operator hunting through invoice selections for a fault that is not there. The
   * real remedy is a corrected document: reject it and have the salesman resubmit.
   */
  if (variance > EPSILON) throw new SettlementError("OVER_TENDER");

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

  /**
   * The collectibility check, scoped so this document can never refuse itself over its own work.
   * It CANNOT run over every selected receivable unconditionally: a resumed approval would then
   * refuse itself over the very receivables its own earlier components paid off, and since the
   * status flip is the last write, that is exactly the state a crash leaves behind — money moved,
   * document stuck `PENDING`, no path to `APPROVED` from anywhere.
   *
   * TWO exemptions, and both are needed. Neither is "skip whenever the effective headroom is
   * zero": `outstandingAmount` here is `min(live, agreedRemaining)`, so that broader rule would
   * also skip a receivable some OTHER channel closed before this approval ever ran — the genuine
   * refusal this check exists for — and would then re-report it as `COMPONENT_EXCEEDS_HEADROOM`
   * one block down, pointing the operator at the invoice selection instead of at the invoice
   * someone else already settled. Only the AGREED side of the minimum may excuse a closed status.
   *
   *   - `settlementAllocated > 0` — a component of THIS settlement already allocated against this
   *     receivable, so whatever closed it, this document is at least partly why. This is the case
   *     the `agreedRemaining` term alone misses: `StoreSettlementInvoice.amount` can exceed the
   *     live balance (a verified `CollectionSubmission` paying the invoice down between submit and
   *     approval is enough, since those two writers deliberately do not net each other), and then
   *     a single component closes the receivable while leaving the agreed share partly unspent.
   *     `agreedRemaining` stays positive against a now-`PAID` row and the resume throws
   *     `NOT_OUTSTANDING` forever. The tell that the refusal is spurious: `min(live,
   *     agreedRemaining)` is 0 for that row, so `allocateOldestFirst` skips it and no
   *     `recordPayment` call is ever made against it — the check would be refusing over a
   *     receivable it will not touch.
   *
   *     This exemption does NOT make the misdiagnosis the paragraph above warns about impossible;
   *     it narrows it, and one shape survives. Where this settlement pays a row down PARTIALLY and
   *     some OTHER channel then closes the rest, the row is skipped here on `settlementAllocated`
   *     and the components still owed are refused one block down as `COMPONENT_EXCEEDS_HEADROOM`,
   *     pointing at the invoice selection rather than at the invoice someone else settled — the
   *     same misdirection, now reachable for a row this document DID touch. Telling that case
   *     apart needs a third term this design does not carry, and both refusals block the same
   *     approval without moving money, so the trade stands deliberately.
   *   - `agreedRemaining <= 0` — this settlement's whole agreed share of the invoice is spent, so
   *     the same reasoning applies with nothing left to allocate either way.
   *
   * Anything still owed and untouched by this document must still be collectible, which is what
   * `recordPayment` would itself raise as `ALREADY_SETTLED` a moment later anyway.
   */
  for (const row of preflightHeadroom) {
    if (row.settlementAllocated > EPSILON) continue;
    if (!(row.agreedRemaining > EPSILON)) continue;
    const receivable = receivableById.get(row.receivableId);
    if (!receivable) throw new SettlementError("RECEIVABLE_NOT_FOUND");
    if (receivable.status !== "OUTSTANDING" && receivable.status !== "PARTIAL") {
      throw new SettlementError("NOT_OUTSTANDING");
    }
  }

  /*
   * Ordered AFTER the collectibility check on purpose: a receivable closed elsewhere leaves zero
   * headroom too, and reporting that as an allocation shortfall would point an operator at the
   * invoice selection instead of at the invoice someone else already settled.
   */
  const totalHeadroom = roundCents(
    preflightHeadroom.reduce((sum, row) => sum + row.outstandingAmount, 0),
  );
  if (totalOwed - totalHeadroom > EPSILON) {
    throw new SettlementError("COMPONENT_EXCEEDS_HEADROOM");
  }

  /**
   * The retur-side twin of the headroom pre-flight, and it needs its own aggregate: the invoice
   * check above knows nothing about how much of a retur's frozen `totalValue` is already spent.
   * Reachable with no raw-row trickery at all — a backoffice offset sheet drawing part of the same
   * retur between submission and approval is enough. Without this the shortfall surfaces inside
   * `recordPayment`'s own in-transaction ceiling as `EXCEEDS_REMAINING`, and with two retur
   * deduction rows the first draw has already committed by then: the retry skips it and fails
   * again on the second, and voiding the first to unstick it only converts the refusal into
   * `COMPONENT_VOIDED`.
   *
   * Only components this run still OWES are counted — a draw that already posted is inside the
   * `alreadyDrawn` aggregate, so counting it twice would refuse every resume.
   */
  const owedByReturn = new Map<string, number>();
  for (const component of owedComponents) {
    if (component.kind !== "RETUR") continue;
    const prior = owedByReturn.get(component.returnId) ?? 0;
    owedByReturn.set(component.returnId, roundCents(prior + component.amount));
  }
  for (const [returnId, owed] of owedByReturn) {
    const drawn = await prisma.payment.aggregate({
      where: { fieldReturnId: returnId, status: "POSTED" },
      _sum: { amount: true },
    });
    const alreadyDrawn = roundCents(Number(drawn._sum.amount ?? 0));
    const totalValue = returTotalValueById.get(returnId) ?? 0;
    if (alreadyDrawn + owed - totalValue > EPSILON) {
      throw new SettlementError("RETUR_OVERCLAIMED");
    }
  }

  const paidAt = new Date();
  const paymentIds: string[] = [];

  for (const component of components) {
    if (!(component.amount > 0)) continue;

    /**
     * A VOIDED prior payment is refused for BOTH component kinds. `recordPayment`'s own
     * idempotency lookup would hand that voided row straight back and report success for a
     * component that moved no money; `applyReturnOffset` refuses the same case itself with
     * `PAYMENT_VOIDED`, and this raises the settlement-level code before either is reached so the
     * refusal reads the same whichever component hit it.
     */
    const existing = paymentByKey.get(component.idempotencyKey);
    if (existing?.status === "VOIDED") throw new SettlementError("COMPONENT_VOIDED");

    /**
     * A retur component is NEVER short-circuited on an existing payment, unlike the others.
     * `applyReturnOffset`'s own replay branch re-runs `projectReturnOffset` before returning, and
     * that projection is the entire reason the branch exists: it recovers from a failure between
     * the payment committing and `FieldReturn.appliedValue` being written. Skipping the call
     * strands the retur at a stale `appliedValue` with `offsetStatus: "AVAILABLE"` permanently —
     * nothing else re-projects except voiding that very draw — and `submitSettlement` computes
     * retur headroom as `totalValue - appliedValue - other PENDING claims`, so every later
     * settlement over-claims at submit time and then dies at approval on `EXCEEDS_REMAINING`.
     * This does not need a process kill to happen: `projectReturnOffset` opens its own
     * `runSerializable`, and `withRetry` rethrows a serialization failure after four attempts.
     *
     * The allocations are deliberately empty on that path. `applyReturnOffset` returns from its
     * replay branch BEFORE it looks at them, so they are ignored — and if the payment somehow
     * vanished between the lookup above and the call, an empty list fails closed on that writer's
     * own `ALLOCATION_MISMATCH` rather than silently posting a short draw.
     */
    if (component.kind === "RETUR") {
      const allocations = existing
        ? []
        : allocateForComponent(
            component.amount,
            await computeComponentHeadroom(invoiceRows, componentKeys),
          );
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

    /**
     * The resume skip, for cash/program/fee only. A component whose payment already exists is NOT
     * re-posted and NOT re-allocated: `computeComponentHeadroom` has already netted it out, so
     * re-deriving its allocation here would fail to fill and throw `COMPONENT_EXCEEDS_HEADROOM` on
     * a settlement that is perfectly resumable. These three post through `recordPayment`, which
     * projects nothing onto any other row, so there is nothing left to re-run.
     */
    if (existing) {
      paymentIds.push(existing.id);
      continue;
    }

    const allocations = allocateForComponent(
      component.amount,
      await computeComponentHeadroom(invoiceRows, componentKeys),
    );

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
   * throw, so the zero-count arm below is deliberately write-free — both audit rows below are
   * created only after the CAS actually matched, which is also exactly why they live here rather
   * than in the action: a crash between this transaction committing and the action's own next
   * statement (the journal-posting loop, or a process death right before an `auditLog.create` of
   * its own) is unrecoverable if the audit write depends on anything past this return. The CAS
   * guarantees this block runs at most once per approval — a resumed call that lands on the
   * `alreadyApproved` branch above never reaches here, so there is no double-write to guard
   * against.
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
     * `SETTLEMENT_APPROVE` is written here, not in the action, so it can never go missing: a
     * process death between this transaction committing and the action's next statement (the
     * journal-posting loop, or its own `auditLog.create`) would otherwise leave the approval with
     * no audit row and no way back to writing one — a retry lands on the `alreadyApproved` replay
     * branch above, which is write-free by design and must stay that way, so nothing past this
     * transaction ever gets a second chance to create it.
     */
    await tx.auditLog.create({
      data: {
        userId: input.approvedById,
        action: "SETTLEMENT_APPROVE",
        entityType: "StoreSettlement",
        entityId: settlement.id,
        metadata: { paymentIds },
      },
    });

    /**
     * The override reason is recorded here too, for the same reason — the tolerance and the
     * variance it was measured against are known only to this function, and this is the one
     * transaction guaranteed to run exactly once per approval.
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
