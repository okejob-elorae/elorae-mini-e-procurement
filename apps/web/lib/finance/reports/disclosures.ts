import idMessages from "@/lib/i18n/messages/id.json";

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
 * which the server actions build from the helpers below.
 */

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

export const INCOME_STATEMENT_COVERAGE_BODY = reports.incomeStatement.coverageBody;

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

export const CASH_FLOW_COVERAGE_BODY = reports.cashFlow.coverageBody;

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

export type TrialBalancePrintNotes = { note: string };

export function trialBalancePrintNotes(isBalanced: boolean): TrialBalancePrintNotes {
  return { note: isBalanced ? TRIAL_BALANCE_BALANCED_NOTE : TRIAL_BALANCE_UNBALANCED_NOTE };
}

export type IncomeStatementPrintNotes = { coverageTitle: string; coverageBody: string };

export function incomeStatementPrintNotes(): IncomeStatementPrintNotes {
  return {
    coverageTitle: INCOME_STATEMENT_COVERAGE_TITLE,
    coverageBody: INCOME_STATEMENT_COVERAGE_BODY,
  };
}

export type BalanceSheetPrintNotes = {
  note: string;
  openingTitle: string;
  openingBody: string | null;
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
  };
}

export type CashFlowPrintNotes = {
  noCashAccount: string;
  reconciliation: string;
  unclassifiedTitle: string;
  unclassifiedBody: string;
  coverageTitle: string;
  coverageBody: string;
  nonCash: string;
  singlePeriod: string;
};

export function cashFlowPrintNotes(input: {
  isReconciled: boolean;
  unclassifiedCount: number;
}): CashFlowPrintNotes {
  return {
    noCashAccount: CASH_FLOW_NO_CASH_ACCOUNT_NOTE,
    reconciliation: input.isReconciled ? CASH_FLOW_RECONCILED_NOTE : CASH_FLOW_UNRECONCILED_NOTE,
    unclassifiedTitle: CASH_FLOW_UNCLASSIFIED_TITLE,
    unclassifiedBody: cashFlowUnclassifiedBody(input.unclassifiedCount),
    coverageTitle: CASH_FLOW_COVERAGE_TITLE,
    coverageBody: CASH_FLOW_COVERAGE_BODY,
    nonCash: CASH_FLOW_NON_CASH_NOTE,
    singlePeriod: CASH_FLOW_PRINT_SINGLE_PERIOD_NOTE,
  };
}
