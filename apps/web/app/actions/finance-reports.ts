"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd, formatDateOnlyJakarta, endOfTodayJakarta } from "@/lib/date-only";
import { getAccountBalances, getEarliestJournal } from "@/lib/finance/reports/balances";
import { buildTrialBalance, type TrialBalance } from "@/lib/finance/reports/trial-balance";
import { buildIncomeStatement, type IncomeStatement } from "@/lib/finance/reports/income-statement";
import { buildBalanceSheet, type BalanceSheet } from "@/lib/finance/reports/balance-sheet";
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
  getCashOpeningBalance,
  getSectionByAccountId,
} from "@/lib/finance/reports/cash-flow-queries";
import {
  BALANCE_SHEET_OPENING_TITLE,
  CASH_FLOW_COVERAGE_BODY,
  CASH_FLOW_COVERAGE_TITLE,
  CASH_FLOW_RECONCILED_NOTE,
  CASH_FLOW_UNCLASSIFIED_BODY,
  CASH_FLOW_UNCLASSIFIED_TITLE,
  CASH_FLOW_UNRECONCILED_NOTE,
  INCOME_STATEMENT_COVERAGE_BODY,
  INCOME_STATEMENT_COVERAGE_TITLE,
  TRIAL_BALANCE_BALANCED_NOTE,
  TRIAL_BALANCE_UNBALANCED_NOTE,
  balanceSheetOpeningBody,
  formatOpeningDate,
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
  const balances = await getAccountBalances({ from, to });
  return {
    ...buildTrialBalance(balances, { includeZero: input.includeZero ?? false }),
    periodLabel: rangeLabel(from, to),
  };
}

async function loadIncomeStatementReport(input: {
  from?: string;
  to?: string;
}): Promise<IncomeStatement & { periodLabel: string }> {
  const to = parseDateOnlyEnd(input.to ?? "") ?? endOfTodayJakarta();
  const from = parseDateOnly(input.from ?? "");
  const balances = await getAccountBalances({ from, to });
  return { ...buildIncomeStatement(balances), periodLabel: rangeLabel(from, to) };
}

async function loadBalanceSheetReport(input: {
  asOf?: string;
}): Promise<BalanceSheet & { periodLabel: string; openingWarningDate: string | null }> {
  const asOf = parseDateOnlyEnd(input.asOf ?? "") ?? endOfTodayJakarta();
  const [balances, earliest] = await Promise.all([
    getAccountBalances({ to: asOf }),
    getEarliestJournal(),
  ]);
  return {
    ...buildBalanceSheet(balances),
    periodLabel: `Per ${dateLabel(asOf)}`,
    openingWarningDate: earliest && !earliest.isManual ? earliest.date.toISOString() : null,
  };
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
}): Promise<TrialBalance & { periodLabel: string } & Attribution> {
  const preparedBy = await assertCanView();
  const report = await loadTrialBalanceReport(input);
  return { ...report, preparedBy, printedAt: printedAtLabel(new Date()) };
}

export async function getIncomeStatementReport(input: {
  from?: string;
  to?: string;
}): Promise<IncomeStatement & { periodLabel: string } & Attribution> {
  const preparedBy = await assertCanView();
  const report = await loadIncomeStatementReport(input);
  return { ...report, preparedBy, printedAt: printedAtLabel(new Date()) };
}

export async function getBalanceSheetReport(input: {
  asOf?: string;
}): Promise<
  BalanceSheet & { periodLabel: string; openingWarningDate: string | null } & Attribution
> {
  const preparedBy = await assertCanView();
  const report = await loadBalanceSheetReport(input);
  return { ...report, preparedBy, printedAt: printedAtLabel(new Date()) };
}

export type CashFlowReport = CashFlowStatement & {
  periodLabel: string;
  previousPeriodLabel: string | null;
  comparison: CashFlowComparison | null;
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

  const [rows, kasAwal] = await Promise.all([
    getAccountBalances({ from, to }),
    getCashOpeningBalance(from ? new Date(from.getTime() - 1) : undefined, cashAccountIds),
  ]);

  return buildCashFlow({ rows, sectionByAccountId, kasAwal });
}

async function loadCashFlowReport(input: {
  from?: string;
  to?: string;
}): Promise<CashFlowReport> {
  const to = parseDateOnlyEnd(input.to ?? "") ?? endOfTodayJakarta();
  const from = parseDateOnly(input.from ?? "");
  const sectionByAccountId = await getSectionByAccountId();

  const current = await buildCashFlowFor(from, to, sectionByAccountId);

  /* Since-inception has no preceding window, so the comparison is withheld. */
  if (!from) {
    return {
      ...current,
      periodLabel: rangeLabel(from, to),
      previousPeriodLabel: null,
      comparison: null,
    };
  }

  const prev = previousPeriod(from, to);
  const previous = await buildCashFlowFor(prev.from, prev.to, sectionByAccountId);

  return {
    ...current,
    periodLabel: rangeLabel(from, to),
    previousPeriodLabel: rangeLabel(prev.from, prev.to),
    comparison: compareCashFlow(current, previous),
  };
}

export async function getCashFlowReport(input: {
  from?: string;
  to?: string;
}): Promise<CashFlowReport & Attribution> {
  const preparedBy = await assertCanView();
  const report = await loadCashFlowReport(input);
  return { ...report, preparedBy, printedAt: printedAtLabel(new Date()) };
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
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { base64: buffer.toString("base64"), filename };
}

/** Flattens a rollup tree into indented label/amount rows for a spreadsheet. */
function flattenNodes(nodes: RollupNode[], level = 0): Cell[][] {
  return nodes.flatMap((node) => [
    [`${"    ".repeat(level)}${node.code} ${node.name}`, node.subtotal],
    ...flattenNodes(node.children, level + 1),
  ]);
}

export async function exportTrialBalanceExcel(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await loadTrialBalanceReport(input);

  const rows: Cell[][] = [
    ...headerRows("Neraca Saldo", report.periodLabel, preparedBy),
    ["Kode", "Nama Akun", "Debit", "Kredit", "Saldo"],
    ...report.rows.map((r): Cell[] => [r.code, r.name, r.debit, r.credit, r.signed]),
    ["", "Total", report.totalDebit, report.totalCredit, ""],
    [],
    [report.isBalanced ? TRIAL_BALANCE_BALANCED_NOTE : TRIAL_BALANCE_UNBALANCED_NOTE],
  ];

  return toWorkbook(rows, "Neraca Saldo", `neraca-saldo-${dateLabel(new Date())}.xlsx`);
}

export async function exportIncomeStatementExcel(input: {
  from?: string;
  to?: string;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await loadIncomeStatementReport(input);

  const rows: Cell[][] = [
    ...headerRows("Laporan Laba Rugi", report.periodLabel, preparedBy),
    ["Keterangan", "Jumlah"],
    ["PENDAPATAN", ""],
    ...flattenNodes(report.pendapatan),
    ["Total Pendapatan", report.totalPendapatan],
    ["HARGA POKOK PENJUALAN", ""],
    ...flattenNodes(report.hpp),
    ["Total Harga Pokok Penjualan", report.totalHpp],
    ["Laba Kotor", report.labaKotor],
    ["BEBAN OPERASIONAL", ""],
    ...flattenNodes(report.beban),
    ["Total Beban Operasional", report.totalBeban],
    ["Laba Bersih", report.labaBersih],
    [],
    [INCOME_STATEMENT_COVERAGE_TITLE],
    [INCOME_STATEMENT_COVERAGE_BODY],
  ];

  return toWorkbook(rows, "Laba Rugi", `laba-rugi-${dateLabel(new Date())}.xlsx`);
}

export async function exportBalanceSheetExcel(input: {
  asOf?: string;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await loadBalanceSheetReport(input);

  const rows: Cell[][] = [
    ...headerRows("Neraca", report.periodLabel, preparedBy),
    ["Keterangan", "Jumlah"],
    ["ASET", ""],
    ...flattenNodes(report.aset),
    ["Total Aset", report.totalAset],
    ["LIABILITAS", ""],
    ...flattenNodes(report.liabilitas),
    ["Total Liabilitas", report.totalLiabilitas],
    ["EKUITAS", ""],
    ...flattenNodes(report.ekuitas),
    ["Total Ekuitas", report.totalEkuitas],
    ["Laba (Rugi) Belum Ditutup", report.unclosedEarnings],
    ["Total Liabilitas dan Ekuitas", report.totalLiabilitasEkuitas],
    ...(report.openingWarningDate
      ? [
          [] as Cell[],
          [BALANCE_SHEET_OPENING_TITLE],
          [balanceSheetOpeningBody(formatOpeningDate(report.openingWarningDate))],
        ]
      : []),
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
      ? [[CASH_FLOW_UNCLASSIFIED_TITLE] as Cell[], [CASH_FLOW_UNCLASSIFIED_BODY] as Cell[]]
      : []),
    [],
    [CASH_FLOW_COVERAGE_TITLE],
    [CASH_FLOW_COVERAGE_BODY],
  ];

  return toWorkbook(rows, "Arus Kas", `arus-kas-${dateLabel(new Date())}.xlsx`);
}
