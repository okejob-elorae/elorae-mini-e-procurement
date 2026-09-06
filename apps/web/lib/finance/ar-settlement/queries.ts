import { prisma, type Prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { computeVariance, EPSILON } from "./calc";
import { parseVarianceTolerance, VARIANCE_TOLERANCE_SETTING_KEY } from "./variance-tolerance";
import {
  buildCollectibilityCheck,
  buildHeadroomCheck,
  buildReturCreditCheck,
  buildReturnEligibilityCheck,
  deriveTotals,
  fail,
  pass,
  skipped,
  type SettlementCheck,
  type SettlementComponentDetail,
  type SettlementComponentSpec,
  type SettlementDeductionDetail,
  type SettlementInvoiceDetail,
  type SettlementReturDetail,
  type SettlementStatusValue,
} from "./checks";
import {
  computeComponentHeadroom,
  returComponentKey,
  simpleComponentKey,
  type InvoiceRow,
} from "./approve-writer";

/**
 * Re-exported so the screen components import their types from one place. The definitions live in
 * `./checks`, which is Prisma-free on purpose — see that module's header.
 */
export type {
  SettlementCheck,
  SettlementCheckId,
  SettlementCheckReason,
  SettlementCheckSubjectKind,
  SettlementComponentDetail,
  SettlementDeductionDetail,
  SettlementDeductionTypeValue,
  SettlementInvoiceDetail,
  SettlementReturDetail,
  SettlementStatusValue,
} from "./checks";

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
 * The salesmen this filter can narrow by, derived from the rows it filters — NOT from who currently
 * holds `settlements:submit`, which is the shape `listCollectorCandidates`
 * (`lib/finance/collections/queries.ts`) uses. The two look interchangeable and are not: that one
 * populates an ASSIGNMENT control and answers "who *can* collect", where permission-derived is
 * exactly right. This one populates a FILTER over rows that already exist and answers "who *did*
 * file" — and losing `settlements:submit` is ordinary (offboarding, a move off field sales, a
 * routine role edit). The moment it happens, permission-derived silently drops every settlement
 * that salesman ever filed out of reach of the filter, and the closed historical documents this
 * queue exists to let finance go back through are exactly the ones most likely to need it. No
 * error, no empty state that explains itself.
 *
 * `groupBy` pushes the DISTINCT down to SQL. `findMany({ distinct: ["salesmanId"] })` would not:
 * Prisma applies `distinct` in memory on connectors without `DISTINCT ON`, and MariaDB is one, so
 * it would pull every settlement row ever written into Node on every page load and every filter
 * change to produce a dropdown of a dozen names, growing forever. The cost of doing this correctly
 * is one extra bounded round trip.
 */
export async function listSettlementSalesmanCandidates(): Promise<Array<{ id: string; name: string }>> {
  const grouped = await prisma.storeSettlement.groupBy({ by: ["salesmanId"] });
  const salesmanIds = grouped.map((row) => row.salesmanId);
  if (salesmanIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: salesmanIds } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return users.map((user) => ({ id: user.id, name: user.name ?? user.email }));
}

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
 *
 * The decisions themselves live in `./checks`, which holds no Prisma import so each one is
 * unit-testable with plain data. This function's job is the reading.
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

  /**
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
   * committing and its projection landing. `remaining` is therefore an eighth retur-credit read
   * surface that deliberately does NOT use the `totalValue - appliedValue` formula the landmine
   * index documents; see `docs/ARCHITECTURE-NOTES.md` for why this one is the exception.
   */
  const drawnByReturn = new Map<string, number>();
  if (returIds.length > 0) {
    const drawn = await prisma.payment.groupBy({
      by: ["fieldReturnId"],
      where: { fieldReturnId: { in: returIds }, status: "POSTED" },
      _sum: { amount: true },
    });
    for (const row of drawn) {
      if (row.fieldReturnId === null) continue;
      drawnByReturn.set(row.fieldReturnId, roundCents(Number(row._sum.amount ?? 0)));
    }
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

  /**
   * The component list, in the writer's fixed order: every retur draw, then the program deduction,
   * then the admin fee, then the cash. The keys must be spelled by the writer's own helpers —
   * `applyReturnOffset` mints the retur key itself, so a locally invented one would report every
   * already-posted draw as unposted.
   *
   * A retur deduction with no `fieldReturnId` gets a `null` key rather than being dropped: it has
   * no payment to look up (the writer refuses it with `MISSING_FIELD_RETURN_ID` before any
   * component posts), but omitting it would make the card hide the broken row AND make `totalOwed`
   * under-count by its amount, so the document would read as cheaper than it is.
   */
  const componentSpecs: SettlementComponentSpec[] = [];
  for (const deduction of deductions) {
    if (deduction.type !== "RETUR_OFFSET") continue;
    componentSpecs.push({
      method: "RETUR_OFFSET",
      amount: roundCents(Number(deduction.amount)),
      key: deduction.fieldReturnId ? returComponentKey(deduction.fieldReturnId, deduction.id) : null,
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

  const componentKeys = componentSpecs
    .map((spec) => spec.key)
    .filter((key): key is string => key !== null);
  const existingPayments = await prisma.payment.findMany({
    where: { idempotencyKey: { in: componentKeys } },
    select: { id: true, idempotencyKey: true, status: true },
  });
  const paymentByKey = new Map<string, (typeof existingPayments)[number]>();
  for (const payment of existingPayments) {
    if (payment.idempotencyKey !== null) paymentByKey.set(payment.idempotencyKey, payment);
  }
  /**
   * Every component key a `Payment` row exists for, VOIDED rows included — deliberately
   * status-neutral, mirroring `approveSettlement`'s own `paymentByKey`, which is also built with
   * no status filter. `NO_VOIDED_COMPONENT` is what refuses a voided component; re-counting one as
   * still owed here would refuse it twice, in the wrong words.
   */
  const componentPaymentKeys = new Set(paymentByKey.keys());

  const components: SettlementComponentDetail[] = componentSpecs.map((spec) => {
    const payment = spec.key === null ? undefined : paymentByKey.get(spec.key);
    return {
      ...spec,
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
          "INVOICE_ID",
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

  /**
   * Ordered ahead of the headroom checks exactly as the writer orders it. An over-tender is
   * refused on its own terms and no override reason can rescue it — `recordPayment` supports no
   * unapplied credit — so the screen must never offer the override box as the way past it.
   */
  checks.push(variance > EPSILON ? fail("NO_OVER_TENDER", "OVER_TENDER") : pass("NO_OVER_TENDER"));

  /**
   * Scoped to `amount > 0`, matching the writer, whose own voided-payment guard sits inside the
   * component loop AFTER `if (!(component.amount > 0)) continue;` — a zero-amount component is
   * never reached there and must not block approval here either.
   */
  const voidedComponents = components.filter(
    (component) => component.amount > 0 && component.paymentStatus === "VOIDED",
  );
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

  /**
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
    checks.push(buildHeadroomCheck(headroom, componentSpecs, componentPaymentKeys));
    checks.push(buildReturCreditCheck(componentSpecs, componentPaymentKeys, returById));
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
