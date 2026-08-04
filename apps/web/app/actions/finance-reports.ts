"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd, formatDateOnlyJakarta } from "@/lib/date-only";
import { getAccountBalances, getEarliestJournal } from "@/lib/finance/reports/balances";
import { buildTrialBalance, type TrialBalance } from "@/lib/finance/reports/trial-balance";
import { buildIncomeStatement, type IncomeStatement } from "@/lib/finance/reports/income-statement";
import { buildBalanceSheet, type BalanceSheet } from "@/lib/finance/reports/balance-sheet";
import type { RollupNode } from "@/lib/finance/reports/rollup";
import {
  BALANCE_SHEET_OPENING_TITLE,
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
  const to = parseDateOnlyEnd(input.to ?? "") ?? new Date();
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
  const to = parseDateOnlyEnd(input.to ?? "") ?? new Date();
  const from = parseDateOnly(input.from ?? "");
  const balances = await getAccountBalances({ from, to });
  return { ...buildIncomeStatement(balances), periodLabel: rangeLabel(from, to) };
}

async function loadBalanceSheetReport(input: {
  asOf?: string;
}): Promise<BalanceSheet & { periodLabel: string; openingWarningDate: string | null }> {
  const asOf = parseDateOnlyEnd(input.asOf ?? "") ?? new Date();
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
