"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd, formatDateOnlyJakarta, endOfTodayJakarta } from "@/lib/date-only";
import { getAccountBalances } from "@/lib/finance/reports/balances";
import { muatNeraca } from "@/lib/finance/reports/neraca-queries";
import { sisiSaldo, type TrialBalance } from "@/lib/finance/reports/trial-balance";
import { muatNeracaSaldo } from "@/lib/finance/reports/neraca-saldo-queries";
import { barisPohon, dariRollup } from "@/lib/finance/reports/tampil-pohon";
import { formatAngkaLembar } from "@/lib/finance/reports/excel";
import { buildIncomeStatement, type IncomeStatement } from "@/lib/finance/reports/income-statement";
import type { BalanceSheet } from "@/lib/finance/reports/balance-sheet";
import type { RollupNode } from "@/lib/finance/reports/rollup";
import {
  buildCashFlow,
  type CashFlowLine,
  type CashFlowStatement,
} from "@/lib/finance/reports/cash-flow";
import {
  compareCashFlow,
  previousPeriod,
  type CashFlowComparison,
  type CashFlowComparisonLine,
} from "@/lib/finance/reports/cash-flow-compare";
import {
  getBarisPelepasanAset,
  getCashOpeningBalance,
  getSectionByAccountId,
} from "@/lib/finance/reports/cash-flow-queries";
import {
  BALANCE_SHEET_BALANCED_NOTE,
  BALANCE_SHEET_COVERAGE_BODY,
  BALANCE_SHEET_COVERAGE_TITLE,
  BALANCE_SHEET_OPENING_TITLE,
  BALANCE_SHEET_UNBALANCED_NOTE,
  CASH_FLOW_COVERAGE_BODY,
  CASH_FLOW_COVERAGE_TITLE,
  CASH_FLOW_INVALID_RANGE_NOTE,
  CASH_FLOW_NON_CASH_NOTE,
  CASH_FLOW_NO_CASH_ACCOUNT_NOTE,
  CASH_FLOW_RECONCILED_NOTE,
  CASH_FLOW_UNCLASSIFIED_TITLE,
  CASH_FLOW_UNRECONCILED_NOTE,
  INCOME_STATEMENT_COVERAGE_BODY,
  INCOME_STATEMENT_COVERAGE_TITLE,
  TRIAL_BALANCE_BALANCED_NOTE,
  TRIAL_BALANCE_UNBALANCED_NOTE,
  balanceSheetOpeningBody,
  balanceSheetPrintNotes,
  cashFlowPrintNotes,
  cashFlowUnclassifiedBodyWithPointer,
  formatOpeningDate,
  incomeStatementPrintNotes,
  trialBalancePrintNotes,
  type BalanceSheetPrintNotes,
  type CashFlowPrintNotes,
  type IncomeStatementPrintNotes,
  type TrialBalancePrintNotes,
} from "@/lib/finance/reports/disclosures";

const COMPANY_NAME = "Elorae";

async function assertCanView(): Promise<string> {
  const session = await auth();
  if (!session) throw new Error("UNAUTHENTICATED");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FINANCE_REPORTS_VIEW)) {
    throw new Error("FORBIDDEN");
  }
  return session.user.name ?? session.user.email ?? "-";
}

/** Calendar-day label in the business timezone (WIB) — see `formatDateOnlyJakarta`. */
function dateLabel(value: Date): string {
  return formatDateOnlyJakarta(value);
}

/**
 * Human-readable "printed at" timestamp, explicitly anchored to WIB and
 * labeled as such — otherwise a reader has no way to know which zone a
 * printed statement was generated in.
 */
function printedAtLabel(value: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
  return `${formatDateOnlyJakarta(value)} ${time} WIB`;
}

function rangeLabel(from: Date | undefined, to: Date): string {
  return from ? `${dateLabel(from)} — ${dateLabel(to)}` : `s.d. ${dateLabel(to)}`;
}

/**
 * Unauthorized report assembly, shared by the exported read action and its
 * matching export action so a single `assertCanView()` call — made by
 * whichever of the two the caller invoked — gates both.
 */
async function loadTrialBalanceReport(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
}): Promise<TrialBalance & { periodLabel: string }> {
  const to = parseDateOnlyEnd(input.to ?? "") ?? endOfTodayJakarta();
  const from = parseDateOnly(input.from ?? "");
  return {
    ...(await muatNeracaSaldo({ from, to, includeZero: input.includeZero ?? false })),
    periodLabel: rangeLabel(from, to),
  };
}

async function loadIncomeStatementReport(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
  nol?: boolean;
}): Promise<IncomeStatement & { periodLabel: string }> {
  const to = parseDateOnlyEnd(input.to ?? "") ?? endOfTodayJakarta();
  const from = parseDateOnly(input.from ?? "");
  const balances = await getAccountBalances({ from, to });
  return {
    ...buildIncomeStatement(balances, { includeZero: input.includeZero ?? input.nol ?? false }),
    periodLabel: rangeLabel(from, to),
  };
}

async function loadBalanceSheetReport(input: {
  asOf?: string;
}): Promise<BalanceSheet & { periodLabel: string; openingWarningDate: string | null }> {
  const asOf = parseDateOnlyEnd(input.asOf ?? "") ?? endOfTodayJakarta();
  const { report, openingWarningDate } = await muatNeraca(asOf);
  return { ...report, periodLabel: `Per ${dateLabel(asOf)}`, openingWarningDate };
}

/**
 * Attribution the print views render in their header, matching the
 * `Disiapkan oleh` / `Dicetak` rows `headerRows` emits into the spreadsheets.
 * Resolved here rather than client-side so the timestamp stays WIB-anchored.
 */
type Attribution = { preparedBy: string; printedAt: string };

export async function getTrialBalanceReport(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
}): Promise<
  TrialBalance & { periodLabel: string; notes: TrialBalancePrintNotes } & Attribution
> {
  const preparedBy = await assertCanView();
  const report = await loadTrialBalanceReport(input);
  return {
    ...report,
    notes: trialBalancePrintNotes(report.isBalanced),
    preparedBy,
    printedAt: printedAtLabel(new Date()),
  };
}

export async function getIncomeStatementReport(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
}): Promise<
  IncomeStatement & { periodLabel: string; notes: IncomeStatementPrintNotes } & Attribution
> {
  const preparedBy = await assertCanView();
  const report = await loadIncomeStatementReport(input);
  return {
    ...report,
    notes: incomeStatementPrintNotes(),
    preparedBy,
    printedAt: printedAtLabel(new Date()),
  };
}

export async function getBalanceSheetReport(input: {
  asOf?: string;
}): Promise<
  BalanceSheet & {
    periodLabel: string;
    openingWarningDate: string | null;
    notes: BalanceSheetPrintNotes;
  } & Attribution
> {
  const preparedBy = await assertCanView();
  const report = await loadBalanceSheetReport(input);
  return {
    ...report,
    notes: balanceSheetPrintNotes(report.isBalanced, report.openingWarningDate),
    preparedBy,
    printedAt: printedAtLabel(new Date()),
  };
}

export type CashFlowReport = CashFlowStatement & {
  periodLabel: string;
  previousPeriodLabel: string | null;
  comparison: CashFlowComparison | null;
  /* The effective range (open end defaulted to today in WIB) runs backwards. */
  invalidRange: boolean;
};

/**
 * Builds one period's statement. The section map and the balance rows are
 * shared with the comparison window, so the caller resolves them once.
 */
async function buildCashFlowFor(
  from: Date | undefined,
  to: Date,
  sectionByAccountId: Awaited<ReturnType<typeof getSectionByAccountId>>,
): Promise<CashFlowStatement> {
  const cashAccountIds = [...sectionByAccountId.entries()]
    .filter(([, section]) => section === "KAS")
    .map(([accountId]) => accountId);

  /*
   * Jurnal saldo awal (`OPENING…`) bukan arus kas periode: dikeluarkan dari
   * mutasi dan kasnya dihitung sebagai kas awal (s.d. akhir jendela).
   */
  const [rows, kasAwal, pelepasanAset] = await Promise.all([
    getAccountBalances({ from, to }, { kecualiSaldoAwal: true }),
    getCashOpeningBalance(from ? new Date(from.getTime() - 1) : undefined, cashAccountIds, { saldoAwalSampai: to }),
    getBarisPelepasanAset({ from, to }),
  ]);

  return buildCashFlow({ rows, sectionByAccountId, kasAwal, pelepasanAset });
}

async function loadCashFlowReport(input: {
  from?: string;
  to?: string;
}): Promise<CashFlowReport> {
  const to = parseDateOnlyEnd(input.to ?? "") ?? endOfTodayJakarta();
  const from = parseDateOnly(input.from ?? "");
  const sectionByAccountId = await getSectionByAccountId();
  const invalidRange = from !== undefined && to < from;

  /*
   * Since-inception has no preceding window, so the comparison is withheld; a
   * reversed range has no meaningful window at all, so it is withheld there too.
   */
  if (!from || invalidRange) {
    const current = await buildCashFlowFor(from, to, sectionByAccountId);
    return {
      ...current,
      periodLabel: rangeLabel(from, to),
      previousPeriodLabel: null,
      comparison: null,
      invalidRange,
    };
  }

  const prev = previousPeriod(from, to);
  const [current, previous] = await Promise.all([
    buildCashFlowFor(from, to, sectionByAccountId),
    buildCashFlowFor(prev.from, prev.to, sectionByAccountId),
  ]);

  return {
    ...current,
    periodLabel: rangeLabel(from, to),
    previousPeriodLabel: rangeLabel(prev.from, prev.to),
    comparison: compareCashFlow(current, previous),
    invalidRange,
  };
}

export async function getCashFlowReport(input: {
  from?: string;
  to?: string;
}): Promise<CashFlowReport & { notes: CashFlowPrintNotes } & Attribution> {
  const preparedBy = await assertCanView();
  const report = await loadCashFlowReport(input);
  return {
    ...report,
    notes: cashFlowPrintNotes({
      isReconciled: report.isReconciled,
      unclassifiedCount: report.unclassified.length,
      hasComparison: report.comparison !== null,
    }),
    preparedBy,
    printedAt: printedAtLabel(new Date()),
  };
}

type Cell = string | number;

function headerRows(title: string, periodLabel: string, preparedBy: string): Cell[][] {
  return [
    [COMPANY_NAME],
    [title],
    [periodLabel],
    [`Disiapkan oleh: ${preparedBy}`],
    [`Dicetak: ${printedAtLabel(new Date())}`],
    [],
  ];
}

function toWorkbook(rows: Cell[][], sheetName: string, filename: string) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Negatif dalam kurung, sama dengan layar dan cetak.
  formatAngkaLembar(ws);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { base64: buffer.toString("base64"), filename };
}

/**
 * Pohon akun → baris Excel tiga kolom (keterangan | rincian | jumlah), aturan
 * baris yang sama dengan layar dan cetak (`barisPohon`): induk tanpa angka,
 * rincian di kolom kedua, subtotal "Jumlah …" di kolom ketiga.
 */
function flattenNodes(nodes: RollupNode[], tampilkanNol = false): Cell[][] {
  return barisPohon(dariRollup(nodes), { tampilkanNol }).map((b): Cell[] => {
    const indent = "    ".repeat(b.level + 1);
    if (b.jenis === "judul") return [`${indent}${b.code} ${b.name}`];
    if (b.jenis === "jumlah") return [`${indent}Jumlah ${b.name}`, "", b.nilai[0]];
    return [`${indent}${b.code} ${b.name}`, b.nilai[0], ""];
  });
}

export async function exportTrialBalanceExcel(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await loadTrialBalanceReport(input);

  /* Saldo ditulis sebagai besaran + sisi sebenarnya (D/K), seperti di layar. */
  const saldo = (type: Parameters<typeof sisiSaldo>[0], nilai: number): Cell[] => {
    const s = sisiSaldo(type, nilai);
    return [s.jumlah, s.sisi ?? ""];
  };
  const rows: Cell[][] = [
    ...headerRows("Neraca Saldo", report.periodLabel, preparedBy),
    ["Kode", "Nama akun", "Saldo awal", "D/K", "Debit", "Kredit", "Saldo akhir", "D/K"],
    ...report.rows.map((r): Cell[] => [r.code, r.name, ...saldo(r.type, r.opening), r.debit, r.credit, ...saldo(r.type, r.closing)]),
    ["", "Total mutasi", "", "", report.totalDebit, report.totalCredit, "", ""],
    ["", "Jumlah saldo di sisi debit", report.totalSaldoAwal.debit, "D", "", "", report.totalSaldoAkhir.debit, "D"],
    ["", "Jumlah saldo di sisi kredit", report.totalSaldoAwal.kredit, "K", "", "", report.totalSaldoAkhir.kredit, "K"],
    [],
    [report.isBalanced ? TRIAL_BALANCE_BALANCED_NOTE : TRIAL_BALANCE_UNBALANCED_NOTE],
  ];

  return toWorkbook(rows, "Neraca Saldo", `neraca-saldo-${dateLabel(new Date())}.xlsx`);
}

export async function exportIncomeStatementExcel(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
  nol?: boolean;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await loadIncomeStatementReport(input);
  const nol = input.nol ?? input.includeZero ?? false;

  const rows: Cell[][] = [
    ...headerRows("Laporan Laba Rugi", report.periodLabel, preparedBy),
    ["Keterangan", "Rincian", "Jumlah"],
    ["PENDAPATAN"],
    ...flattenNodes(report.pendapatan, nol),
    ["Total Pendapatan", "", report.totalPendapatan],
    ["HARGA POKOK PENJUALAN"],
    ...flattenNodes(report.hpp, nol),
    ["Total Harga Pokok Penjualan", "", report.totalHpp],
    ["Laba Kotor", "", report.labaKotor],
    ["BEBAN OPERASIONAL"],
    ...flattenNodes(report.beban, nol),
    ["Total Beban Operasional", "", report.totalBeban],
    ["Laba Bersih", "", report.labaBersih],
    [],
    [INCOME_STATEMENT_COVERAGE_TITLE],
    [INCOME_STATEMENT_COVERAGE_BODY],
  ];

  return toWorkbook(rows, "Laba Rugi", `laba-rugi-${dateLabel(new Date())}.xlsx`);
}

export async function exportBalanceSheetExcel(input: {
  asOf?: string;
  nol?: boolean;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await loadBalanceSheetReport(input);
  const nol = input.nol ?? false;

  const rows: Cell[][] = [
    ...headerRows("Neraca", report.periodLabel, preparedBy),
    ["Keterangan", "Rincian", "Jumlah"],
    ["ASET"],
    ...flattenNodes(report.aset, nol),
    ["Total Aset", "", report.totalAset],
    ["LIABILITAS"],
    ...flattenNodes(report.liabilitas, nol),
    ["Total Liabilitas", "", report.totalLiabilitas],
    ["EKUITAS"],
    ...flattenNodes(report.ekuitas, nol),
    ["Total Ekuitas", "", report.totalEkuitas],
    ...(report.labaTahunLaluBelumDitutup !== 0
      ? [["Laba (Rugi) Tahun Lalu Belum Ditutup", "", report.labaTahunLaluBelumDitutup] as Cell[]]
      : []),
    ["Laba (Rugi) Tahun Berjalan", "", report.labaTahunBerjalan],
    ["Total Liabilitas dan Ekuitas", "", report.totalLiabilitasEkuitas],
    [],
    [report.isBalanced ? BALANCE_SHEET_BALANCED_NOTE : BALANCE_SHEET_UNBALANCED_NOTE],
    ...(report.openingWarningDate
      ? [
          [] as Cell[],
          [BALANCE_SHEET_OPENING_TITLE],
          [balanceSheetOpeningBody(formatOpeningDate(report.openingWarningDate))],
        ]
      : []),
    [],
    [BALANCE_SHEET_COVERAGE_TITLE],
    [BALANCE_SHEET_COVERAGE_BODY],
  ];

  return toWorkbook(rows, "Neraca", `neraca-${dateLabel(new Date())}.xlsx`);
}

/**
 * Keys of `CashFlowComparison` that hold a single current/previous/delta triple
 * rather than a line array. Naming them keeps `total` below honest — indexing
 * the whole keyof union would also match the array-valued keys.
 */
type CashFlowTotalKey =
  | "labaBersih"
  | "totalOperasional"
  | "totalInvestasi"
  | "totalPendanaan"
  | "totalUnclassified"
  | "netChange"
  | "kasAwal"
  | "kasAkhir";

/** Flattens cash-flow lines into label/amount rows, optionally with comparison columns. */
function cashFlowLineRows(
  lines: CashFlowLine[],
  paired: CashFlowComparisonLine[] | null,
): Cell[][] {
  if (!paired) {
    return lines.map((line): Cell[] => [`    ${line.code} ${line.name}`, line.amount]);
  }
  return paired.map((line): Cell[] => [
    `    ${line.code} ${line.name}`,
    line.current,
    line.previous,
    line.delta,
  ]);
}

export async function exportCashFlowExcel(input: {
  from?: string;
  to?: string;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await loadCashFlowReport(input);

  /**
   * Refuse rather than ship a zero statement (or one for a reversed range), matching
   * the screen and the print view. With no cash account every section computes to zero and
   * `netChange === cashDelta === 0`, so the workbook would otherwise append the
   * reconciled note and assert that the computed change equals actual cash
   * movement — on a file that leaves the app and gets emailed to an accountant.
   */
  if (report.invalidRange || !report.hasCashAccount) {
    return toWorkbook(
      [
        ...headerRows("Laporan Arus Kas", report.periodLabel, preparedBy),
        [report.invalidRange ? CASH_FLOW_INVALID_RANGE_NOTE : CASH_FLOW_NO_CASH_ACCOUNT_NOTE],
      ],
      "Arus Kas",
      `arus-kas-${dateLabel(new Date())}.xlsx`,
    );
  }

  const cmp = report.comparison;

  const header: Cell[] = cmp
    ? ["Keterangan", "Periode ini", "Periode sebelumnya", "Selisih"]
    : ["Keterangan", "Jumlah"];

  const total = (label: string, key: CashFlowTotalKey, value: number): Cell[] => {
    if (!cmp) return [label, value];
    const t = cmp[key];
    return [label, t.current, t.previous, t.delta];
  };

  const rows: Cell[][] = [
    ...headerRows("Laporan Arus Kas", report.periodLabel, preparedBy),
    ...(cmp && report.previousPeriodLabel
      ? [[`Pembanding: ${report.previousPeriodLabel}`] as Cell[], [] as Cell[]]
      : []),
    header,
    ["ARUS KAS DARI AKTIVITAS OPERASIONAL", ""],
    total("    Laba Bersih", "labaBersih", report.labaBersih),
    ...cashFlowLineRows(report.operasional, cmp?.operasional ?? null),
    total("Kas Bersih dari Aktivitas Operasional", "totalOperasional", report.totalOperasional),
    ["ARUS KAS DARI AKTIVITAS INVESTASI", ""],
    ...cashFlowLineRows(report.investasi, cmp?.investasi ?? null),
    total("Kas Bersih dari Aktivitas Investasi", "totalInvestasi", report.totalInvestasi),
    ["ARUS KAS DARI AKTIVITAS PENDANAAN", ""],
    ...cashFlowLineRows(report.pendanaan, cmp?.pendanaan ?? null),
    total("Kas Bersih dari Aktivitas Pendanaan", "totalPendanaan", report.totalPendanaan),
    ...(report.unclassified.length
      ? [
          ["BELUM DIKLASIFIKASI", ""] as Cell[],
          ...cashFlowLineRows(report.unclassified, cmp?.unclassified ?? null),
          total("Total Belum Diklasifikasi", "totalUnclassified", report.totalUnclassified),
        ]
      : []),
    total("Kenaikan (Penurunan) Kas", "netChange", report.netChange),
    total("Kas Awal Periode", "kasAwal", report.kasAwal),
    total("Kas Akhir Periode", "kasAkhir", report.kasAkhir),
    [],
    [report.isReconciled ? CASH_FLOW_RECONCILED_NOTE : CASH_FLOW_UNRECONCILED_NOTE],
    ...(report.unclassified.length
      ? [[CASH_FLOW_UNCLASSIFIED_TITLE] as Cell[],
          [cashFlowUnclassifiedBodyWithPointer(report.unclassified.length)] as Cell[],
        ]
      : []),
    [],
    [CASH_FLOW_COVERAGE_TITLE],
    [CASH_FLOW_COVERAGE_BODY],
    [CASH_FLOW_NON_CASH_NOTE],
  ];

  return toWorkbook(rows, "Arus Kas", `arus-kas-${dateLabel(new Date())}.xlsx`);
}
