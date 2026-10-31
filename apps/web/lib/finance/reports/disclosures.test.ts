import { describe, expect, it } from "vitest";
import idMessages from "@/lib/i18n/messages/id.json";
import * as disclosures from "./disclosures";
import {
  CASH_FLOW_COVERAGE_BODY,
  INCOME_STATEMENT_COVERAGE_BODY,
  LEDGER_NOT_ACTIVE_NOTE,
  SUMBER_BELUM_BERJURNAL,
  SUMBER_BERJURNAL,
  ledgerPendingNote,
} from "./disclosures";

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
  "LEDGER_NOT_ACTIVE_NOTE",
  "REPORT_EMPTY_PERIOD_NOTE",
  "INCOME_STATEMENT_EMPTY_NOTE",
  "BALANCE_SHEET_EMPTY_NOTE",
  "BALANCE_SHEET_COVERAGE_TITLE",
  "BALANCE_SHEET_COVERAGE_BODY",
  "CAKUPAN_LAPORAN_BODY",
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

  it("carries every id.json string a print page needs, so the page never imports this module", () => {
    expect(disclosures.trialBalancePrintNotes(true).empty).toBe(reports.trialBalance.empty);
    expect(disclosures.incomeStatementPrintNotes().empty).toBe(reports.incomeStatement.empty);
    const bs = disclosures.balanceSheetPrintNotes(true, "2026-06-01T00:00:00.000Z");
    expect(bs.empty).toBe(reports.balanceSheet.empty);
    expect(bs.coverageTitle).toBe(reports.balanceSheet.coverageTitle);
    expect(bs.coverageBody).toBe(disclosures.BALANCE_SHEET_COVERAGE_BODY);
    expect(bs.openingTitle).toBe(reports.balanceSheet.openingTitle);
    expect(bs.openingBody).toBe(
      disclosures.balanceSheetOpeningBody(disclosures.formatOpeningDate("2026-06-01T00:00:00.000Z")),
    );
  });
});

/*
 * Catatan "Cakupan data" dulu hanya menyebut putus dan SPG sebagai yang belum
 * berjurnal, padahal konsinyasi, pelunasan piutang, retur toko, dan barang
 * hilang juga tidak pernah membuat jurnal (audit 2026-10-06). Daftarnya kini
 * satu, dan ketiga teks dibangun darinya.
 */

describe("cakupan data laporan keuangan", () => {
  it("konsinyasi, komisi SPG, barang hilang, gudang rusak, stok manual, retur pemasok, dan biaya perjalanan sudah berjurnal (lib/finance/operasional)", () => {
    const berjurnal = SUMBER_BERJURNAL.join(" | ");
    const belum = SUMBER_BELUM_BERJURNAL.join(" | ");
    for (const kata of ["konsinyasi", "komisi SPG", "barang hilang", "gudang barang rusak", "penyesuaian stok manual", "retur ke pemasok", "biaya perjalanan"]) {
      expect(berjurnal).toContain(kata);
      expect(belum).not.toContain(kata);
    }
  });

  it("yang masih belum berjurnal disebut jujur: perubahan stok dari Jubelio dan komisi salesman", () => {
    const teks = SUMBER_BELUM_BERJURNAL.join(" | ");
    expect(teks).toContain("Jubelio");
    expect(teks).toContain("komisi salesman");
  });

  it("penjualan lapangan putus, pelunasan, retur toko putus, dan tukar barang sudah berjurnal (lib/finance/lapangan)", () => {
    const berjurnal = SUMBER_BERJURNAL.join(" | ");
    const belum = SUMBER_BELUM_BERJURNAL.join(" | ");
    for (const kata of ["putus", "pelunasan piutang", "retur toko", "tukar barang"]) {
      expect(berjurnal).toContain(kata);
      expect(belum).not.toContain(kata);
    }
  });

  it("tidak ada sumber yang disebut di kedua daftar", () => {
    const berjurnal = new Set(SUMBER_BERJURNAL);
    expect(SUMBER_BELUM_BERJURNAL.filter((s) => berjurnal.has(s))).toEqual([]);
  });

  it("Laba Rugi dan Arus Kas menyebut SEMUA sumber yang belum berjurnal", () => {
    for (const sumber of SUMBER_BELUM_BERJURNAL) {
      expect(INCOME_STATEMENT_COVERAGE_BODY).toContain(sumber);
      expect(CASH_FLOW_COVERAGE_BODY).toContain(sumber);
    }
    for (const sumber of SUMBER_BERJURNAL) {
      expect(INCOME_STATEMENT_COVERAGE_BODY).toContain(sumber);
    }
  });
});

describe("catatan buku besar di versi cetak", () => {
  it("belum aktif dan jurnal tertunda", () => {
    expect(LEDGER_NOT_ACTIVE_NOTE).toContain("Buku besar belum aktif");
    expect(ledgerPendingNote(3)).toBe("3 jurnal gagal diposting — laporan ini belum memuat dokumennya.");
  });
});
