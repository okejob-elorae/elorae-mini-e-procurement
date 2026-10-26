import { describe, expect, it } from "vitest";
import idMessages from "@/lib/i18n/messages/id.json";
import * as disclosures from "./disclosures";

const reports = idMessages.financeReports;

/* Every exported string constant. A new one must be added here, which forces a look at where its id.json key lives. */
const STRING_EXPORTS = [
  "TRIAL_BALANCE_BALANCED_NOTE",
  "TRIAL_BALANCE_UNBALANCED_NOTE",
  "INCOME_STATEMENT_COVERAGE_TITLE",
  "INCOME_STATEMENT_COVERAGE_BODY",
  "BALANCE_SHEET_BALANCED_NOTE",
  "BALANCE_SHEET_UNBALANCED_NOTE",
  "BALANCE_SHEET_OPENING_TITLE",
  "CASH_FLOW_COVERAGE_TITLE",
  "CASH_FLOW_COVERAGE_BODY",
  "CASH_FLOW_NO_CASH_ACCOUNT_NOTE",
  "CASH_FLOW_RECONCILED_NOTE",
  "CASH_FLOW_UNRECONCILED_NOTE",
  "CASH_FLOW_NON_CASH_NOTE",
  "CASH_FLOW_PRINT_SINGLE_PERIOD_NOTE",
  "CASH_FLOW_UNCLASSIFIED_TITLE",
  "CASH_FLOW_UNCLASSIFIED_POINTER",
  "CASH_FLOW_INVALID_RANGE_NOTE",
];

describe("report disclosures", () => {
  it("restates no string: every exported string constant is covered above", () => {
    const exportedStrings = Object.entries(disclosures)
      .filter(([, value]) => typeof value === "string")
      .map(([name]) => name)
      .sort();

    expect(exportedStrings).toEqual([...STRING_EXPORTS].sort());
  });

  it("includes the single-period note only when a comparison exists", () => {
    const base = { isReconciled: true, unclassifiedCount: 0 };

    expect(disclosures.cashFlowPrintNotes({ ...base, hasComparison: true }).singlePeriod).toBe(
      reports.cashFlow.printSinglePeriodNote,
    );
    expect(disclosures.cashFlowPrintNotes({ ...base, hasComparison: false }).singlePeriod).toBeNull();
  });

  it("appends the classification pointer to the print and Excel unclassified body", () => {
    const withPointer = disclosures.cashFlowUnclassifiedBodyWithPointer(2);

    expect(withPointer).toBe(`${disclosures.cashFlowUnclassifiedBody(2)} ${reports.cashFlow.unclassifiedPointer}`);
    expect(
      disclosures.cashFlowPrintNotes({ isReconciled: true, unclassifiedCount: 2, hasComparison: true })
        .unclassifiedBody,
    ).toBe(withPointer);
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
      disclosures.cashFlowPrintNotes({ isReconciled: false, unclassifiedCount: 0, hasComparison: false }).reconciliation,
    ).toBe(reports.cashFlow.unreconciledNote);
  });
});
