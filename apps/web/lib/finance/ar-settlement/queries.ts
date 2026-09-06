import { prisma, type Prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { computeSettlementTotals, computeVariance, type SettlementTotals } from "./calc";
import { parseVarianceTolerance, VARIANCE_TOLERANCE_SETTING_KEY } from "./variance-tolerance";
import {
  EPSILON,
  computeComponentHeadroom,
  returComponentKey,
  simpleComponentKey,
  type HeadroomRow,
  type InvoiceRow,
} from "./approve-writer";
import type { SettlementErrorCode } from "./errors";

export type SettlementStatusValue = "PENDING" | "APPROVED" | "REJECTED";
export type SettlementDeductionTypeValue = "RETUR_OFFSET" | "PROGRAM" | "ADMIN_FEE";

/**
 * `StoreSettlement.expectedAmount` and `varianceAmount` are stored once at submit time and
 * `approveSettlement` never reads or reconciles them — it recomputes both from the invoice and
 * deduction rows through `computeSettlementTotals`. Every figure this module reports is therefore
 * DERIVED the same way the writer derives what it enforces, and the stored columns are surfaced
 * only as `stored*` so the detail screen can flag a document whose rows no longer agree with the
 * numbers it was filed under. Rendering the stored figures as the truth would let the queue show a
 * balanced document that the writer then refuses with `VARIANCE_REQUIRES_REASON` or `OVER_TENDER`.
 */
function deriveTotals(
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

export type SettlementQueueFilters = {
  storeId?: string;
  salesmanId?: string;
  status?: SettlementStatusValue;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
};

export type SettlementQueueRow = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string;
  status: SettlementStatusValue;
  invoiceCount: number;
  deductionCount: number;
  invoiceTotal: number;
  expectedAmount: number;
  actualAmount: number;
  varianceAmount: number;
  createdAt: Date;
};

export async function listSettlementQueue(
  filters: SettlementQueueFilters,
): Promise<{ rows: SettlementQueueRow[]; total: number }> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;

  const where: Prisma.StoreSettlementWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.storeId) where.storeId = filters.storeId;
  if (filters.salesmanId) where.salesmanId = filters.salesmanId;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
    if (filters.dateTo) where.createdAt.lte = filters.dateTo;
  }

  const [found, total] = await Promise.all([
    prisma.storeSettlement.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        docNo: true,
        status: true,
        actualAmount: true,
        createdAt: true,
        store: { select: { name: true } },
        salesman: { select: { name: true, email: true } },
        invoices: { select: { amount: true } },
        deductions: { select: { type: true, amount: true, percent: true } },
      },
    }),
    prisma.storeSettlement.count({ where }),
  ]);

  return {
    rows: found.map((settlement) => {
      const totals = deriveTotals(
        settlement.invoices.map((invoice) => roundCents(Number(invoice.amount))),
        settlement.deductions.map((deduction) => ({
          type: deduction.type,
          amount: Number(deduction.amount),
          percent: deduction.percent === null ? null : Number(deduction.percent),
        })),
      );
      const actualAmount = roundCents(Number(settlement.actualAmount));
      return {
        id: settlement.id,
        docNo: settlement.docNo,
        storeName: settlement.store.name,
        salesmanName: settlement.salesman.name ?? settlement.salesman.email,
        status: settlement.status,
        invoiceCount: settlement.invoices.length,
        deductionCount: settlement.deductions.length,
        invoiceTotal: totals.invoiceTotal,
        expectedAmount: totals.expected,
        actualAmount,
        varianceAmount: computeVariance(totals.expected, actualAmount),
        createdAt: settlement.createdAt,
      };
    }),
    total,
  };
}

/**
 * Only salesmen who have actually filed a settlement, so the filter never offers a name that
 * cannot narrow anything. `distinct` on `salesmanId` keeps this one query rather than a role
 * lookup that would list every salesman in the company.
 */
export async function listSettlementSalesmanCandidates(): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.storeSettlement.findMany({
    distinct: ["salesmanId"],
    select: { salesmanId: true, salesman: { select: { id: true, name: true, email: true } } },
    orderBy: { salesmanId: "asc" },
  });
  return rows
    .map((row) => ({ id: row.salesman.id, name: row.salesman.name ?? row.salesman.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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
 * verbatim while translating a deduction type through its own label map. Without it the server
 * would have to know the operator's locale to name a deduction.
 */
export type SettlementCheckSubjectKind = "INVOICE" | "RETUR" | "DEDUCTION_TYPE" | "PAYMENT";

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

export type SettlementComponentDetail = {
  method: "RETUR_OFFSET" | "PROGRAM_DEDUCTION" | "ADMIN_FEE" | "CASH";
  amount: number;
  paymentId: string | null;
  paymentStatus: string | null;
};

export type SettlementVarianceOverride = {
  reason: string | null;
  byName: string;
  at: Date;
};

export type SettlementApprovalDetail = {
  id: string;
  docNo: string;
  status: SettlementStatusValue;
  storeId: string;
  storeName: string;
  salesmanName: string;
  note: string | null;
  rejectReason: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  invoices: SettlementInvoiceDetail[];
  deductions: SettlementDeductionDetail[];
  components: SettlementComponentDetail[];
  invoiceTotal: number;
  returTotal: number;
  programTotal: number;
  adminFeeBase: number;
  adminFee: number;
  adminFeePercent: number | null;
  expectedAmount: number;
  actualAmount: number;
  varianceAmount: number;
  storedExpectedAmount: number;
  storedVarianceAmount: number;
  storedFiguresDiffer: boolean;
  toleranceRupiah: number;
  needsOverrideReason: boolean;
  checks: SettlementCheck[];
  approvable: boolean;
  varianceOverride: SettlementVarianceOverride | null;
};

function pass(id: SettlementCheckId): SettlementCheck {
  return { id, status: "PASS", reason: null, subjectKind: null, subjects: [] };
}

function fail(
  id: SettlementCheckId,
  reason: SettlementCheckReason,
  subjectKind: SettlementCheckSubjectKind | null = null,
  subjects: string[] = [],
): SettlementCheck {
  return { id, status: "FAIL", reason, subjectKind, subjects };
}

function skipped(id: SettlementCheckId): SettlementCheck {
  return { id, status: "SKIPPED", reason: null, subjectKind: null, subjects: [] };
}

/**
 * Reads one settlement for the finance approval screen and re-runs, read-only, every guard
 * `approveSettlement` enforces — in the writer's own order, against the same live rows, using the
 * writer's own `computeComponentHeadroom` and idempotency-key helpers rather than a second copy of
 * that arithmetic. The checklist is a PREVIEW of the writer, never a substitute for it: every
 * `"use server"` export is independently callable, so the button this gates is not the guard.
 *
 * A check reports `SKIPPED` where an earlier failure makes it unanswerable — a missing receivable
 * means the headroom cannot be computed at all (`computeComponentHeadroom` throws on it), and
 * reporting that as a pass would be a lie in the direction that matters.
 */
export async function getSettlementForApproval(
  settlementId: string,
): Promise<SettlementApprovalDetail | null> {
  const settlement = await prisma.storeSettlement.findUnique({
    where: { id: settlementId },
    select: {
      id: true,
      docNo: true,
      status: true,
      storeId: true,
      note: true,
      rejectReason: true,
      reviewedAt: true,
      createdAt: true,
      expectedAmount: true,
      actualAmount: true,
      varianceAmount: true,
      store: { select: { name: true } },
      salesman: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
      invoices: { select: { receivableId: true, amount: true } },
      deductions: {
        select: {
          id: true,
          type: true,
          amount: true,
          percent: true,
          note: true,
          fieldReturnId: true,
          proofUrl: true,
          proofR2Key: true,
        },
      },
    },
  });
  if (!settlement) return null;

  const invoiceRows: InvoiceRow[] = settlement.invoices.map((invoice) => ({
    receivableId: invoice.receivableId,
    amount: roundCents(Number(invoice.amount)),
  }));

  /*
   * Same ordering the writer imposes on its own component sequence, so the posted-payment column
   * on the screen lines up row for row with what a resumed approval would walk.
   */
  const deductions = [...settlement.deductions].sort((a, b) => a.id.localeCompare(b.id));

  const totals = deriveTotals(
    invoiceRows.map((row) => row.amount),
    deductions.map((deduction) => ({
      type: deduction.type,
      amount: Number(deduction.amount),
      percent: deduction.percent === null ? null : Number(deduction.percent),
    })),
  );
  const actualAmount = roundCents(Number(settlement.actualAmount));
  const variance = computeVariance(totals.expected, actualAmount);

  const adminFeeDeduction = deductions.find((deduction) => deduction.type === "ADMIN_FEE");
  const adminFeePercent =
    adminFeeDeduction && adminFeeDeduction.percent !== null
      ? Number(adminFeeDeduction.percent)
      : null;

  const receivables = await prisma.receivable.findMany({
    where: { id: { in: invoiceRows.map((row) => row.receivableId) } },
    select: {
      id: true,
      storeId: true,
      status: true,
      dueDate: true,
      outstandingAmount: true,
      delivery: { select: { docNo: true } },
    },
  });
  const receivableById = new Map(receivables.map((receivable) => [receivable.id, receivable]));

  const invoiceDetails: SettlementInvoiceDetail[] = invoiceRows.map((row) => {
    const receivable = receivableById.get(row.receivableId);
    return {
      receivableId: row.receivableId,
      docNo: receivable?.delivery.docNo ?? null,
      agreedAmount: row.amount,
      liveOutstanding: receivable ? roundCents(Number(receivable.outstandingAmount)) : null,
      receivableStatus: receivable?.status ?? null,
      storeMatches: receivable ? receivable.storeId === settlement.storeId : false,
      dueDate: receivable?.dueDate ?? null,
    };
  });

  const returIds = Array.from(
    new Set(
      deductions
        .filter((deduction) => deduction.type === "RETUR_OFFSET" && deduction.fieldReturnId)
        .map((deduction) => deduction.fieldReturnId as string),
    ),
  );
  const returns = await prisma.fieldReturn.findMany({
    where: { id: { in: returIds } },
    select: {
      id: true,
      docNo: true,
      storeId: true,
      status: true,
      valuationStatus: true,
      totalValue: true,
    },
  });

  /**
   * `alreadyDrawn` is read from the POSTED payments carrying the retur, exactly as the writer's
   * `RETUR_OVERCLAIMED` pre-flight does — NOT from `FieldReturn.appliedValue`, which is a
   * projection of those same payments and can legitimately lag behind them between a draw
   * committing and its projection landing.
   */
  const drawnByReturn = new Map<string, number>();
  for (const returId of returIds) {
    const drawn = await prisma.payment.aggregate({
      where: { fieldReturnId: returId, status: "POSTED" },
      _sum: { amount: true },
    });
    drawnByReturn.set(returId, roundCents(Number(drawn._sum.amount ?? 0)));
  }

  const returById = new Map<string, SettlementReturDetail>();
  for (const fieldReturn of returns) {
    const totalValue = fieldReturn.totalValue === null ? null : roundCents(Number(fieldReturn.totalValue));
    const alreadyDrawn = drawnByReturn.get(fieldReturn.id) ?? 0;
    returById.set(fieldReturn.id, {
      id: fieldReturn.id,
      docNo: fieldReturn.docNo,
      status: fieldReturn.status,
      valuationStatus: fieldReturn.valuationStatus,
      totalValue,
      alreadyDrawn,
      remaining: totalValue === null ? null : roundCents(totalValue - alreadyDrawn),
      storeMatches: fieldReturn.storeId === settlement.storeId,
    });
  }

  const deductionDetails: SettlementDeductionDetail[] = deductions.map((deduction) => ({
    id: deduction.id,
    type: deduction.type,
    amount: roundCents(Number(deduction.amount)),
    percent: deduction.percent === null ? null : Number(deduction.percent),
    note: deduction.note,
    proofUrl: deduction.proofUrl,
    hasEvidence: !!deduction.proofUrl && !!deduction.proofR2Key,
    fieldReturnId: deduction.fieldReturnId,
    fieldReturn: deduction.fieldReturnId ? returById.get(deduction.fieldReturnId) ?? null : null,
  }));

  /*
   * The component list, in the writer's fixed order: every retur draw, then the program deduction,
   * then the admin fee, then the cash. The keys must be spelled by the writer's own helpers —
   * `applyReturnOffset` mints the retur key itself, so a locally invented one would report every
   * already-posted draw as unposted.
   */
  const componentSpecs: Array<{
    method: SettlementComponentDetail["method"];
    amount: number;
    key: string;
    returnId: string | null;
  }> = [];
  for (const deduction of deductions) {
    if (deduction.type !== "RETUR_OFFSET" || !deduction.fieldReturnId) continue;
    componentSpecs.push({
      method: "RETUR_OFFSET",
      amount: roundCents(Number(deduction.amount)),
      key: returComponentKey(deduction.fieldReturnId, deduction.id),
      returnId: deduction.fieldReturnId,
    });
  }
  componentSpecs.push({
    method: "PROGRAM_DEDUCTION",
    amount: totals.programTotal,
    key: simpleComponentKey(settlement.id, "PROGRAM_DEDUCTION"),
    returnId: null,
  });
  componentSpecs.push({
    method: "ADMIN_FEE",
    amount: totals.adminFee,
    key: simpleComponentKey(settlement.id, "ADMIN_FEE"),
    returnId: null,
  });
  componentSpecs.push({
    method: "CASH",
    amount: actualAmount,
    key: simpleComponentKey(settlement.id, "CASH"),
    returnId: null,
  });

  const componentKeys = componentSpecs.map((spec) => spec.key);
  const existingPayments = await prisma.payment.findMany({
    where: { idempotencyKey: { in: componentKeys } },
    select: { id: true, idempotencyKey: true, status: true, method: true },
  });
  const paymentByKey = new Map<string, (typeof existingPayments)[number]>();
  for (const payment of existingPayments) {
    if (payment.idempotencyKey !== null) paymentByKey.set(payment.idempotencyKey, payment);
  }

  const components: SettlementComponentDetail[] = componentSpecs.map((spec) => {
    const payment = paymentByKey.get(spec.key);
    return {
      method: spec.method,
      amount: spec.amount,
      paymentId: payment?.id ?? null,
      paymentStatus: payment?.status ?? null,
    };
  });

  const toleranceRow = await prisma.systemSetting.findUnique({
    where: { key: VARIANCE_TOLERANCE_SETTING_KEY },
    select: { value: true },
  });
  const toleranceRupiah = parseVarianceTolerance(toleranceRow?.value);
  const needsOverrideReason = Math.abs(variance) - toleranceRupiah > EPSILON;

  const checks: SettlementCheck[] = [];

  checks.push(
    settlement.status === "PENDING"
      ? pass("STATUS_PENDING")
      : fail("STATUS_PENDING", "NOT_PENDING"),
  );

  checks.push(
    invoiceRows.length > 0 ? pass("INVOICES_PRESENT") : fail("INVOICES_PRESENT", "NO_INVOICES"),
  );

  const missingReceivables = invoiceDetails.filter((invoice) => invoice.receivableStatus === null);
  checks.push(
    missingReceivables.length === 0
      ? pass("INVOICES_EXIST")
      : fail(
          "INVOICES_EXIST",
          "RECEIVABLE_NOT_FOUND",
          "INVOICE",
          missingReceivables.map((invoice) => invoice.receivableId),
        ),
  );

  const wrongStoreInvoices = invoiceDetails.filter(
    (invoice) => invoice.receivableStatus !== null && !invoice.storeMatches,
  );
  checks.push(
    wrongStoreInvoices.length === 0
      ? pass("INVOICES_STORE_MATCH")
      : fail(
          "INVOICES_STORE_MATCH",
          "WRONG_STORE",
          "INVOICE",
          wrongStoreInvoices.map((invoice) => invoice.docNo ?? invoice.receivableId),
        ),
  );

  const missingEvidence = deductionDetails.filter(
    (deduction) => deduction.type !== "RETUR_OFFSET" && !deduction.hasEvidence,
  );
  checks.push(
    missingEvidence.length === 0
      ? pass("EVIDENCE_PRESENT")
      : fail(
          "EVIDENCE_PRESENT",
          "MISSING_EVIDENCE",
          "DEDUCTION_TYPE",
          missingEvidence.map((deduction) => deduction.type),
        ),
  );

  checks.push(buildReturnEligibilityCheck(deductionDetails));

  /*
   * Ordered ahead of the headroom checks exactly as the writer orders it. An over-tender is
   * refused on its own terms and no override reason can rescue it — `recordPayment` supports no
   * unapplied credit — so the screen must never offer the override box as the way past it.
   */
  checks.push(variance > EPSILON ? fail("NO_OVER_TENDER", "OVER_TENDER") : pass("NO_OVER_TENDER"));

  const voidedComponents = components.filter((component) => component.paymentStatus === "VOIDED");
  checks.push(
    voidedComponents.length === 0
      ? pass("NO_VOIDED_COMPONENT")
      : fail(
          "NO_VOIDED_COMPONENT",
          "COMPONENT_VOIDED",
          "PAYMENT",
          voidedComponents.map((component) => component.method),
        ),
  );

  /*
   * `computeComponentHeadroom` throws `RECEIVABLE_NOT_FOUND` on a missing receivable rather than
   * skipping it, so the three checks that depend on it can only run once existence is settled.
   */
  if (missingReceivables.length > 0 || invoiceRows.length === 0) {
    checks.push(skipped("INVOICES_COLLECTIBLE"));
    checks.push(skipped("ALLOCATION_HEADROOM"));
    checks.push(skipped("RETUR_CREDIT_AVAILABLE"));
  } else {
    const headroom = await computeComponentHeadroom(invoiceRows, componentKeys);
    checks.push(buildCollectibilityCheck(headroom, invoiceDetails));
    checks.push(buildHeadroomCheck(headroom, componentSpecs, paymentByKey));
    checks.push(buildReturCreditCheck(componentSpecs, paymentByKey, returById));
  }

  const storedExpectedAmount = roundCents(Number(settlement.expectedAmount));
  const storedVarianceAmount = roundCents(Number(settlement.varianceAmount));

  const varianceOverride =
    settlement.status === "APPROVED" ? await readVarianceOverride(settlement.id) : null;

  return {
    id: settlement.id,
    docNo: settlement.docNo,
    status: settlement.status,
    storeId: settlement.storeId,
    storeName: settlement.store.name,
    salesmanName: settlement.salesman.name ?? settlement.salesman.email,
    note: settlement.note,
    rejectReason: settlement.rejectReason,
    reviewedByName: settlement.reviewedBy
      ? settlement.reviewedBy.name ?? settlement.reviewedBy.email
      : null,
    reviewedAt: settlement.reviewedAt,
    createdAt: settlement.createdAt,
    invoices: invoiceDetails,
    deductions: deductionDetails,
    components,
    invoiceTotal: totals.invoiceTotal,
    returTotal: totals.returTotal,
    programTotal: totals.programTotal,
    adminFeeBase: totals.adminFeeBase,
    adminFee: totals.adminFee,
    adminFeePercent,
    expectedAmount: totals.expected,
    actualAmount,
    varianceAmount: variance,
    storedExpectedAmount,
    storedVarianceAmount,
    storedFiguresDiffer:
      Math.abs(storedExpectedAmount - totals.expected) > EPSILON ||
      Math.abs(storedVarianceAmount - variance) > EPSILON,
    toleranceRupiah,
    needsOverrideReason,
    checks,
    approvable: checks.every((check) => check.status === "PASS"),
    varianceOverride,
  };
}

/**
 * The writer refuses a retur deduction on four separate grounds and reports whichever it reaches
 * first. This collapses them into one checklist row carrying that same first reason, so an
 * operator reads "this retur is not approved yet" rather than a generic "retur problem".
 */
function buildReturnEligibilityCheck(deductions: SettlementDeductionDetail[]): SettlementCheck {
  const returDeductions = deductions.filter((deduction) => deduction.type === "RETUR_OFFSET");

  const unlinked = returDeductions.filter((deduction) => !deduction.fieldReturnId);
  if (unlinked.length > 0) return fail("RETURNS_ELIGIBLE", "MISSING_FIELD_RETURN_ID");

  const notFound = returDeductions.filter((deduction) => deduction.fieldReturn === null);
  if (notFound.length > 0) {
    return fail(
      "RETURNS_ELIGIBLE",
      "FIELD_RETURN_NOT_FOUND",
      "RETUR",
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
function buildCollectibilityCheck(
  headroom: HeadroomRow[],
  invoices: SettlementInvoiceDetail[],
): SettlementCheck {
  const docNoById = new Map(invoices.map((invoice) => [invoice.receivableId, invoice.docNo]));
  const statusById = new Map(invoices.map((invoice) => [invoice.receivableId, invoice.receivableStatus]));

  const blocked: string[] = [];
  for (const row of headroom) {
    if (!(row.agreedRemaining > EPSILON)) continue;
    const status = statusById.get(row.receivableId);
    if (status !== "OUTSTANDING" && status !== "PARTIAL") {
      blocked.push(docNoById.get(row.receivableId) ?? row.receivableId);
    }
  }
  return blocked.length === 0
    ? pass("INVOICES_COLLECTIBLE")
    : fail("INVOICES_COLLECTIBLE", "NOT_OUTSTANDING", "INVOICE", blocked);
}

/**
 * Mirrors the writer's whole-document allocation pre-flight. Both sides net what a prior run
 * already posted: a component that already has a payment is not owed again, and the headroom
 * already excludes what that payment consumed.
 */
function buildHeadroomCheck(
  headroom: HeadroomRow[],
  componentSpecs: Array<{ amount: number; key: string }>,
  paymentByKey: ReadonlyMap<string, unknown>,
): SettlementCheck {
  const totalOwed = roundCents(
    componentSpecs
      .filter((spec) => spec.amount > 0 && !paymentByKey.has(spec.key))
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
 */
function buildReturCreditCheck(
  componentSpecs: Array<{ amount: number; key: string; returnId: string | null }>,
  paymentByKey: ReadonlyMap<string, unknown>,
  returById: ReadonlyMap<string, SettlementReturDetail>,
): SettlementCheck {
  const owedByReturn = new Map<string, number>();
  for (const spec of componentSpecs) {
    if (!spec.returnId || !(spec.amount > 0) || paymentByKey.has(spec.key)) continue;
    const prior = owedByReturn.get(spec.returnId) ?? 0;
    owedByReturn.set(spec.returnId, roundCents(prior + spec.amount));
  }

  const overclaimed: string[] = [];
  for (const [returnId, owed] of owedByReturn) {
    const retur = returById.get(returnId);
    const totalValue = retur?.totalValue ?? 0;
    const alreadyDrawn = retur?.alreadyDrawn ?? 0;
    if (alreadyDrawn + owed - totalValue > EPSILON) {
      overclaimed.push(retur?.docNo ?? returnId);
    }
  }
  return overclaimed.length === 0
    ? pass("RETUR_CREDIT_AVAILABLE")
    : fail("RETUR_CREDIT_AVAILABLE", "RETUR_OVERCLAIMED", "RETUR", overclaimed);
}

/**
 * There is no `overrideReason` column on `StoreSettlement` — `approveSettlement` records the
 * reason as a `SETTLEMENT_VARIANCE_OVERRIDE` audit row inside its own status-flip transaction, and
 * that row is the only place an approved flagged document explains itself.
 */
async function readVarianceOverride(settlementId: string): Promise<SettlementVarianceOverride | null> {
  const row = await prisma.auditLog.findFirst({
    where: {
      entityType: "StoreSettlement",
      entityId: settlementId,
      action: "SETTLEMENT_VARIANCE_OVERRIDE",
    },
    orderBy: { createdAt: "desc" },
    select: { reason: true, createdAt: true, user: { select: { name: true, email: true } } },
  });
  if (!row) return null;
  return {
    reason: row.reason,
    byName: row.user.name ?? row.user.email,
    at: row.createdAt,
  };
}
