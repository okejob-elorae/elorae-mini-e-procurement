/**
 * The pure half of the finance approval preview: given rows already read from the database, decide
 * what `approveSettlement` would refuse. Deliberately import-free apart from `@elorae/db/pricing`
 * and this feature's own pure modules — same policy as `calc.ts`, `allocate.ts` and
 * `variance-tolerance.ts` beside it — so every branch is unit-testable with plain data and no test
 * bed, and so a future client component can import it without dragging Prisma into the browser
 * bundle.
 *
 * The three netting rules below are what the writer's own comments call the difference between a
 * resumable settlement and a broken one, and they are the reason this file has its own spec:
 * collectibility scoped to `agreedRemaining`, `totalOwed` excluding already-posted components, and
 * `owedByReturn` excluding already-posted draws. Dropping any one of them turns a half-posted,
 * perfectly resumable approval into a permanently blocked one that finance can only reject —
 * orphaning the payments already behind it.
 */
import { roundCents } from "@elorae/db/pricing";
import { computeSettlementTotals, EPSILON, type SettlementTotals } from "./calc";
import type { SettlementErrorCode } from "./errors";

export type SettlementStatusValue = "PENDING" | "APPROVED" | "REJECTED";
export type SettlementDeductionTypeValue = "RETUR_OFFSET" | "PROGRAM" | "ADMIN_FEE";

export type SettlementCheckId =
  | "STATUS_PENDING"
  | "INVOICES_PRESENT"
  | "INVOICES_EXIST"
  | "INVOICES_STORE_MATCH"
  | "EVIDENCE_PRESENT"
  | "RETURNS_ELIGIBLE"
  | "NO_OVER_TENDER"
  | "INVOICES_COLLECTIBLE"
  | "ALLOCATION_HEADROOM"
  | "RETUR_CREDIT_AVAILABLE"
  | "NO_VOIDED_COMPONENT";

/**
 * Names what the `subjects` of a failing check are, so the screen can render an invoice number
 * verbatim, translate a deduction type through its own label map, and label a raw cuid as the kind
 * of id it is. Without it the server would have to know the operator's locale to name a deduction,
 * and "Affected: cm3x9k2…" would be unactionable.
 */
export type SettlementCheckSubjectKind =
  | "INVOICE"
  | "INVOICE_ID"
  | "RETUR"
  | "RETUR_ID"
  | "DEDUCTION_TYPE"
  | "PAYMENT";

/**
 * The subset of `SettlementErrorCode` the checklist can actually report — every approve-time
 * refusal, and nothing from the submit path that `approveSettlement` can never raise. Narrowing it
 * matters because the screen renders each failing check through `financeStoreSettlements.err.<code>`
 * with no exhaustive `Record` in between: a code outside this set has no locale key and would show
 * the operator a raw key path. `Extract` keeps it welded to `errors.ts`, so renaming a member there
 * breaks here rather than silently dropping a check's explanation.
 */
export type SettlementCheckReason = Extract<
  SettlementErrorCode,
  | "NOT_PENDING"
  | "NO_INVOICES"
  | "RECEIVABLE_NOT_FOUND"
  | "WRONG_STORE"
  | "MISSING_EVIDENCE"
  | "MISSING_FIELD_RETURN_ID"
  | "FIELD_RETURN_NOT_FOUND"
  | "RETUR_WRONG_STORE"
  | "RETURN_NOT_APPROVED"
  | "NOT_VALUED"
  | "OVER_TENDER"
  | "COMPONENT_VOIDED"
  | "NOT_OUTSTANDING"
  | "COMPONENT_EXCEEDS_HEADROOM"
  | "RETUR_OVERCLAIMED"
>;

export type SettlementCheck = {
  id: SettlementCheckId;
  status: "PASS" | "FAIL" | "SKIPPED";
  reason: SettlementCheckReason | null;
  subjectKind: SettlementCheckSubjectKind | null;
  subjects: string[];
};

export type SettlementInvoiceDetail = {
  receivableId: string;
  docNo: string | null;
  agreedAmount: number;
  liveOutstanding: number | null;
  receivableStatus: string | null;
  storeMatches: boolean;
  dueDate: Date | null;
};

export type SettlementReturDetail = {
  id: string;
  docNo: string;
  status: string;
  valuationStatus: string;
  totalValue: number | null;
  alreadyDrawn: number;
  remaining: number | null;
  storeMatches: boolean;
};

export type SettlementDeductionDetail = {
  id: string;
  type: SettlementDeductionTypeValue;
  amount: number;
  percent: number | null;
  note: string | null;
  proofUrl: string | null;
  hasEvidence: boolean;
  fieldReturnId: string | null;
  fieldReturn: SettlementReturDetail | null;
};

/**
 * One component the approval will post. `key` is `null` only for a retur deduction carrying no
 * `fieldReturnId` — a row the writer refuses outright with `MISSING_FIELD_RETURN_ID`, and which
 * therefore has no idempotency key to look a payment up by. It still counts toward `totalOwed`
 * and still renders, because a broken row silently dropped makes the document read as cheaper
 * than it is while finance tries to work out why it is blocked.
 */
export type SettlementComponentSpec = {
  method: "RETUR_OFFSET" | "PROGRAM_DEDUCTION" | "ADMIN_FEE" | "CASH";
  amount: number;
  key: string | null;
  returnId: string | null;
};

export type SettlementComponentDetail = SettlementComponentSpec & {
  paymentId: string | null;
  paymentStatus: string | null;
};

/**
 * `StoreSettlement.expectedAmount` and `varianceAmount` are stored once at submit time and
 * `approveSettlement` never reads or reconciles them — it recomputes both from the invoice and
 * deduction rows through `computeSettlementTotals`. Every figure the approval screen shows is
 * therefore derived the same way the writer derives what it enforces. Rendering the stored figures
 * as the truth would let the queue show a balanced document that the writer then refuses with
 * `VARIANCE_REQUIRES_REASON` or `OVER_TENDER`.
 */
export function deriveTotals(
  invoiceAmounts: number[],
  deductions: Array<{ type: SettlementDeductionTypeValue; amount: number; percent: number | null }>,
): SettlementTotals {
  return computeSettlementTotals(
    invoiceAmounts,
    deductions.map((deduction) => ({
      type: deduction.type,
      amount: deduction.amount,
      percent: deduction.percent === null ? undefined : deduction.percent,
    })),
  );
}

export function pass(id: SettlementCheckId): SettlementCheck {
  return { id, status: "PASS", reason: null, subjectKind: null, subjects: [] };
}

export function fail(
  id: SettlementCheckId,
  reason: SettlementCheckReason,
  subjectKind: SettlementCheckSubjectKind | null = null,
  subjects: string[] = [],
): SettlementCheck {
  return { id, status: "FAIL", reason, subjectKind, subjects };
}

export function skipped(id: SettlementCheckId): SettlementCheck {
  return { id, status: "SKIPPED", reason: null, subjectKind: null, subjects: [] };
}

/**
 * The writer refuses a retur deduction on five separate grounds and reports whichever it reaches
 * first. This collapses them into one checklist row carrying that same first reason, so an
 * operator reads "this retur is not approved yet" rather than a generic "retur problem".
 */
export function buildReturnEligibilityCheck(deductions: SettlementDeductionDetail[]): SettlementCheck {
  const returDeductions = deductions.filter((deduction) => deduction.type === "RETUR_OFFSET");

  const unlinked = returDeductions.filter((deduction) => !deduction.fieldReturnId);
  if (unlinked.length > 0) return fail("RETURNS_ELIGIBLE", "MISSING_FIELD_RETURN_ID");

  const notFound = returDeductions.filter((deduction) => deduction.fieldReturn === null);
  if (notFound.length > 0) {
    return fail(
      "RETURNS_ELIGIBLE",
      "FIELD_RETURN_NOT_FOUND",
      "RETUR_ID",
      notFound.map((deduction) => deduction.fieldReturnId ?? ""),
    );
  }

  const checked: Array<[SettlementCheckReason, (retur: SettlementReturDetail) => boolean]> = [
    ["RETUR_WRONG_STORE", (retur) => !retur.storeMatches],
    ["RETURN_NOT_APPROVED", (retur) => retur.status !== "APPROVED"],
    ["NOT_VALUED", (retur) => retur.valuationStatus !== "VALUED" || retur.totalValue === null],
  ];
  for (const [reason, isBroken] of checked) {
    const broken = returDeductions.filter((deduction) => {
      const retur = deduction.fieldReturn;
      return retur !== null && isBroken(retur);
    });
    if (broken.length > 0) {
      return fail(
        "RETURNS_ELIGIBLE",
        reason,
        "RETUR",
        broken.map((deduction) => deduction.fieldReturn?.docNo ?? ""),
      );
    }
  }

  return pass("RETURNS_ELIGIBLE");
}

/**
 * Mirrors the writer's `NOT_OUTSTANDING` gate, including its scoping: a receivable whose
 * `agreedRemaining` has reached zero has already had this settlement's whole share of it settled
 * BY this settlement, so its closed status is explained rather than a refusal. Checking every
 * selected receivable unconditionally would report a resumable half-posted approval as broken.
 */
export function buildCollectibilityCheck(
  headroom: Array<{ receivableId: string; agreedRemaining: number }>,
  invoices: SettlementInvoiceDetail[],
): SettlementCheck {
  const docNoById = new Map(invoices.map((invoice) => [invoice.receivableId, invoice.docNo]));
  const statusById = new Map(invoices.map((invoice) => [invoice.receivableId, invoice.receivableStatus]));

  const blocked: Array<{ docNo: string | null; id: string }> = [];
  for (const row of headroom) {
    if (!(row.agreedRemaining > EPSILON)) continue;
    const status = statusById.get(row.receivableId);
    if (status !== "OUTSTANDING" && status !== "PARTIAL") {
      blocked.push({ docNo: docNoById.get(row.receivableId) ?? null, id: row.receivableId });
    }
  }
  if (blocked.length === 0) return pass("INVOICES_COLLECTIBLE");
  /**
   * A receivable with no delivery docNo can only be named by its cuid, and a bare cuid is
   * unactionable. `subjectKind` is one value for the whole check, so the labelled kind is used
   * as soon as ANY row falls back to an id — a docNo rendered as "invoice DLV/0009" still reads
   * correctly, while an unlabelled cuid does not.
   */
  const invoiceKind = blocked.every((row) => row.docNo !== null) ? "INVOICE" : "INVOICE_ID";
  return fail(
    "INVOICES_COLLECTIBLE",
    "NOT_OUTSTANDING",
    invoiceKind,
    blocked.map((row) => row.docNo ?? row.id),
  );
}

/**
 * Mirrors the writer's whole-document allocation pre-flight. Both sides net what a prior run
 * already posted: a component that already has a payment is not owed again, and the headroom
 * already excludes what that payment consumed. A component with no idempotency key at all (a retur
 * deduction missing its `fieldReturnId`) can never have posted, so it is always still owed.
 *
 * `componentPaymentKeys` is every component key a `Payment` row exists for, VOIDED rows included,
 * and the name is status-neutral for that reason. That is not an oversight and not a divergence
 * from the writer: `approveSettlement` builds its own `paymentByKey` with no status filter for the
 * same lookup, and a voided component is caught by `NO_VOIDED_COMPONENT` on its own terms rather
 * than being quietly re-counted as still owed here.
 */
export function buildHeadroomCheck(
  headroom: Array<{ outstandingAmount: number }>,
  componentSpecs: Array<{ amount: number; key: string | null }>,
  componentPaymentKeys: ReadonlySet<string>,
): SettlementCheck {
  const totalOwed = roundCents(
    componentSpecs
      .filter((spec) => spec.amount > 0 && (spec.key === null || !componentPaymentKeys.has(spec.key)))
      .reduce((sum, spec) => sum + spec.amount, 0),
  );
  const totalHeadroom = roundCents(
    headroom.reduce((sum, row) => sum + row.outstandingAmount, 0),
  );
  return totalOwed - totalHeadroom > EPSILON
    ? fail("ALLOCATION_HEADROOM", "COMPONENT_EXCEEDS_HEADROOM")
    : pass("ALLOCATION_HEADROOM");
}

/**
 * Mirrors the writer's `RETUR_OVERCLAIMED` pre-flight, counting only draws this run still owes —
 * a draw that already posted is inside `alreadyDrawn`, so counting it again would report every
 * resumable approval as an over-claim.
 *
 * `componentPaymentKeys` carries the same status-neutral meaning as in `buildHeadroomCheck` above.
 */
export function buildReturCreditCheck(
  componentSpecs: SettlementComponentSpec[],
  componentPaymentKeys: ReadonlySet<string>,
  returById: ReadonlyMap<string, SettlementReturDetail>,
): SettlementCheck {
  const owedByReturn = new Map<string, number>();
  for (const spec of componentSpecs) {
    if (spec.returnId === null || !(spec.amount > 0)) continue;
    if (spec.key !== null && componentPaymentKeys.has(spec.key)) continue;
    const prior = owedByReturn.get(spec.returnId) ?? 0;
    owedByReturn.set(spec.returnId, roundCents(prior + spec.amount));
  }

  const overclaimed: Array<{ docNo: string | null; id: string }> = [];
  for (const [returnId, owed] of owedByReturn) {
    const retur = returById.get(returnId);
    const totalValue = retur?.totalValue ?? 0;
    const alreadyDrawn = retur?.alreadyDrawn ?? 0;
    if (alreadyDrawn + owed - totalValue > EPSILON) {
      overclaimed.push({ docNo: retur?.docNo ?? null, id: returnId });
    }
  }
  if (overclaimed.length === 0) return pass("RETUR_CREDIT_AVAILABLE");
  /**
   * A retur whose row has gone reaches here with no docNo, and it reaches `RETURNS_ELIGIBLE` at the
   * same time — which already labels the cuid. Leaving this one bare put the same id on two
   * adjacent checklist rows in two different spellings.
   */
  const returKind = overclaimed.every((row) => row.docNo !== null) ? "RETUR" : "RETUR_ID";
  return fail(
    "RETUR_CREDIT_AVAILABLE",
    "RETUR_OVERCLAIMED",
    returKind,
    overclaimed.map((row) => row.docNo ?? row.id),
  );
}
