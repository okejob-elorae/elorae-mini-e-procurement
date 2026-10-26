import { describe, expect, it } from "vitest";
import idMessages from "@/lib/i18n/messages/id.json";
import * as disclosures from "./disclosures";

const reports = idMessages.financeReports;

/* Every exported disclosure string and the `id.json` key it must equal. */
const EXPECTED: Record<string, string> = {
  TRIAL_BALANCE_BALANCED_NOTE: reports.trialBalance.balancedNote,
  TRIAL_BALANCE_UNBALANCED_NOTE: reports.trialBalance.unbalancedNote,
  INCOME_STATEMENT_COVERAGE_TITLE: reports.incomeStatement.coverageTitle,
  INCOME_STATEMENT_COVERAGE_BODY: reports.incomeStatement.coverageBody,
  BALANCE_SHEET_BALANCED_NOTE: reports.balanceSheet.balancedNote,
  BALANCE_SHEET_UNBALANCED_NOTE: reports.balanceSheet.unbalancedNote,
  BALANCE_SHEET_OPENING_TITLE: reports.balanceSheet.openingTitle,
  CASH_FLOW_COVERAGE_TITLE: reports.cashFlow.coverageTitle,
  CASH_FLOW_COVERAGE_BODY: reports.cashFlow.coverageBody,
  CASH_FLOW_NO_CASH_ACCOUNT_NOTE: reports.cashFlow.noCashAccountBody,
  CASH_FLOW_RECONCILED_NOTE: reports.cashFlow.reconciledNote,
  CASH_FLOW_UNRECONCILED_NOTE: reports.cashFlow.unreconciledNote,
  CASH_FLOW_NON_CASH_NOTE: reports.cashFlow.nonCashNote,
  CASH_FLOW_PRINT_SINGLE_PERIOD_NOTE: reports.cashFlow.printSinglePeriodNote,
  CASH_FLOW_UNCLASSIFIED_TITLE: reports.cashFlow.unclassifiedTitle,
};

describe("report disclosures", () => {
  it.each(Object.entries(EXPECTED))("%s equals its id.json value", (name, expected) => {
    expect((disclosures as Record<string, unknown>)[name]).toBe(expected);
  });

  it("restates no string: every exported string constant is covered above", () => {
    const exportedStrings = Object.entries(disclosures)
      .filter(([, value]) => typeof value === "string")
      .map(([name]) => name)
      .sort();

    expect(exportedStrings).toEqual(Object.keys(EXPECTED).sort());
  });

  it("fills the opening-balance date into the id.json template", () => {
    expect(disclosures.balanceSheetOpeningBody("01 Jun 2026")).toBe(
      reports.balanceSheet.openingBody.replace("{date}", "01 Jun 2026"),
    );
    expect(disclosures.balanceSheetOpeningBody("01 Jun 2026")).not.toContain("{");
  });

  it("fills the unclassified account count into the id.json template", () => {
    const body = disclosures.cashFlowUnclassifiedBody(3);

    expect(body).toBe(reports.cashFlow.unclassifiedBody.replace("{count}", "3"));
    expect(body).not.toContain("{");
  });

  it("picks the balanced or unbalanced note for the print payloads", () => {
    expect(disclosures.trialBalancePrintNotes(true).note).toBe(reports.trialBalance.balancedNote);
    expect(disclosures.trialBalancePrintNotes(false).note).toBe(reports.trialBalance.unbalancedNote);
    expect(disclosures.balanceSheetPrintNotes(true, null).note).toBe(reports.balanceSheet.balancedNote);
    expect(disclosures.balanceSheetPrintNotes(false, null).note).toBe(reports.balanceSheet.unbalancedNote);
    expect(disclosures.balanceSheetPrintNotes(true, null).openingBody).toBeNull();
    expect(
      disclosures.cashFlowPrintNotes({ isReconciled: false, unclassifiedCount: 0 }).reconciliation,
    ).toBe(reports.cashFlow.unreconciledNote);
  });
});
