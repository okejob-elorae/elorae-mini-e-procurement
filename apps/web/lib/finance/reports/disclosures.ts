import idMessages from "@/lib/i18n/messages/id.json";
import {
  BALANCE_SHEET_COVERAGE_BODY,
  CAKUPAN_LAPORAN_BODY,
  CASH_FLOW_COVERAGE_BODY,
  INCOME_STATEMENT_COVERAGE_BODY,
  LEDGER_NOT_ACTIVE_NOTE,
  SUMBER_BELUM_BERJURNAL,
  SUMBER_BERJURNAL,
  ledgerPendingNote,
} from "./cakupan-laporan";

/**
 * Disclosures the on-screen reports show, restated for the artifacts that leave
 * the app: the Excel exports and the browser-print views. Those are what gets
 * emailed to an accountant, so they must carry the same caveats as the screen.
 *
 * There is ONE copy of every string: the `financeReports.*` keys in `id.json`.
 * This module reads them directly instead of restating them, because the print
 * pages have no locale provider and the Excel sheets are generated server-side
 * outside a request locale, so next-intl is not available to them.
 *
 * Server-side only. `id.json` is the whole Indonesian catalogue (hundreds of
 * KB), so a client component must never import this module by value — the print
 * pages receive these strings in the `notes` field of their report payload,
 * which the server actions build from the helpers below. The coverage texts
 * built from the source lists live in `cakupan-laporan.ts`, which clients import
 * directly; they are re-exported here so the server side has one entry point.
 */

export {
  BALANCE_SHEET_COVERAGE_BODY,
  CAKUPAN_LAPORAN_BODY,
  CASH_FLOW_COVERAGE_BODY,
  INCOME_STATEMENT_COVERAGE_BODY,
  LEDGER_NOT_ACTIVE_NOTE,
  SUMBER_BELUM_BERJURNAL,
  SUMBER_BERJURNAL,
  ledgerPendingNote,
};

const reports = idMessages.financeReports;

/** Fills `{name}` placeholders. The disclosures use only plain placeholders, no plurals or selects. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export const TRIAL_BALANCE_BALANCED_NOTE = reports.trialBalance.balancedNote;

export const TRIAL_BALANCE_UNBALANCED_NOTE = reports.trialBalance.unbalancedNote;

export const INCOME_STATEMENT_COVERAGE_TITLE = reports.incomeStatement.coverageTitle;

export const BALANCE_SHEET_BALANCED_NOTE = reports.balanceSheet.balancedNote;

export const BALANCE_SHEET_UNBALANCED_NOTE = reports.balanceSheet.unbalancedNote;

export const BALANCE_SHEET_OPENING_TITLE = reports.balanceSheet.openingTitle;

export function balanceSheetOpeningBody(dateLabel: string): string {
  return fill(reports.balanceSheet.openingBody, { date: dateLabel });
}

/** Day-month-year label for the opening-balance warning, in the business timezone (WIB). */
export function formatOpeningDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export const CASH_FLOW_COVERAGE_TITLE = reports.cashFlow.coverageTitle;

/**
 * Shown in place of the statement when no account is classified KAS. Without a
 * cash account every section computes to zero, which would otherwise ship as a
 * statement reporting no cash movement — carrying the reconciled note, since
 * zero does equal zero. Refusing is the only honest output.
 */
export const CASH_FLOW_NO_CASH_ACCOUNT_NOTE = reports.cashFlow.noCashAccountBody;

export const CASH_FLOW_RECONCILED_NOTE = reports.cashFlow.reconciledNote;

export const CASH_FLOW_UNRECONCILED_NOTE = reports.cashFlow.unreconciledNote;

export const CASH_FLOW_NON_CASH_NOTE = reports.cashFlow.nonCashNote;

export const CASH_FLOW_PRINT_SINGLE_PERIOD_NOTE = reports.cashFlow.printSinglePeriodNote;

export const CASH_FLOW_UNCLASSIFIED_TITLE = reports.cashFlow.unclassifiedTitle;

export function cashFlowUnclassifiedBody(count: number): string {
  return fill(reports.cashFlow.unclassifiedBody, { count });
}

/** Print and Excel only: the screen has a link to the classification page instead. */
export const CASH_FLOW_UNCLASSIFIED_POINTER = reports.cashFlow.unclassifiedPointer;

export const CASH_FLOW_INVALID_RANGE_NOTE = reports.cashFlow.invalidRange;

/** The unclassified body with the pointer sentence appended, for artifacts that leave the app. */
export function cashFlowUnclassifiedBodyWithPointer(count: number): string {
  return `${cashFlowUnclassifiedBody(count)} ${CASH_FLOW_UNCLASSIFIED_POINTER}`;
}

export const REPORT_EMPTY_PERIOD_NOTE = reports.trialBalance.empty;

/** Laba Rugi kosong: jurnal yang hanya menyentuh akun neraca (mis. penerimaan barang) tidak mengisinya. */
export const INCOME_STATEMENT_EMPTY_NOTE = reports.incomeStatement.empty;

export const BALANCE_SHEET_EMPTY_NOTE = reports.balanceSheet.empty;

export const BALANCE_SHEET_COVERAGE_TITLE = reports.balanceSheet.coverageTitle;

export type TrialBalancePrintNotes = { note: string; empty: string };

export function trialBalancePrintNotes(isBalanced: boolean): TrialBalancePrintNotes {
  return {
    note: isBalanced ? TRIAL_BALANCE_BALANCED_NOTE : TRIAL_BALANCE_UNBALANCED_NOTE,
    empty: REPORT_EMPTY_PERIOD_NOTE,
  };
}

export type IncomeStatementPrintNotes = { coverageTitle: string; coverageBody: string; empty: string };

export function incomeStatementPrintNotes(): IncomeStatementPrintNotes {
  return {
    coverageTitle: INCOME_STATEMENT_COVERAGE_TITLE,
    coverageBody: INCOME_STATEMENT_COVERAGE_BODY,
    empty: INCOME_STATEMENT_EMPTY_NOTE,
  };
}

export type BalanceSheetPrintNotes = {
  note: string;
  openingTitle: string;
  openingBody: string | null;
  empty: string;
  coverageTitle: string;
  coverageBody: string;
};

export function balanceSheetPrintNotes(
  isBalanced: boolean,
  openingWarningDate: string | null,
): BalanceSheetPrintNotes {
  return {
    note: isBalanced ? BALANCE_SHEET_BALANCED_NOTE : BALANCE_SHEET_UNBALANCED_NOTE,
    openingTitle: BALANCE_SHEET_OPENING_TITLE,
    openingBody: openingWarningDate
      ? balanceSheetOpeningBody(formatOpeningDate(openingWarningDate))
      : null,
    empty: BALANCE_SHEET_EMPTY_NOTE,
    coverageTitle: BALANCE_SHEET_COVERAGE_TITLE,
    coverageBody: BALANCE_SHEET_COVERAGE_BODY,
  };
}

export type CashFlowPrintNotes = {
  noCashAccount: string;
  invalidRange: string;
  reconciliation: string;
  unclassifiedTitle: string;
  unclassifiedBody: string;
  coverageTitle: string;
  coverageBody: string;
  nonCash: string;
  singlePeriod: string | null;
};

export function cashFlowPrintNotes(input: {
  isReconciled: boolean;
  unclassifiedCount: number;
  hasComparison: boolean;
}): CashFlowPrintNotes {
  return {
    noCashAccount: CASH_FLOW_NO_CASH_ACCOUNT_NOTE,
    invalidRange: CASH_FLOW_INVALID_RANGE_NOTE,
    reconciliation: input.isReconciled ? CASH_FLOW_RECONCILED_NOTE : CASH_FLOW_UNRECONCILED_NOTE,
    unclassifiedTitle: CASH_FLOW_UNCLASSIFIED_TITLE,
    unclassifiedBody: cashFlowUnclassifiedBodyWithPointer(input.unclassifiedCount),
    coverageTitle: CASH_FLOW_COVERAGE_TITLE,
    coverageBody: CASH_FLOW_COVERAGE_BODY,
    nonCash: CASH_FLOW_NON_CASH_NOTE,
    singlePeriod: input.hasComparison ? CASH_FLOW_PRINT_SINGLE_PERIOD_NOTE : null,
  };
}
