"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountBalances, getEarliestJournal } from "@/lib/finance/reports/balances";
import { buildTrialBalance, type TrialBalance } from "@/lib/finance/reports/trial-balance";
import { buildIncomeStatement, type IncomeStatement } from "@/lib/finance/reports/income-statement";
import { buildBalanceSheet, type BalanceSheet } from "@/lib/finance/reports/balance-sheet";
import type { RollupNode } from "@/lib/finance/reports/rollup";

const COMPANY_NAME = "Elorae";

async function assertCanView(): Promise<string> {
  const session = await auth();
  if (!session) throw new Error("UNAUTHENTICATED");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FINANCE_REPORTS_VIEW)) {
    throw new Error("FORBIDDEN");
  }
  return session.user.name ?? session.user.email ?? "-";
}

function dateLabel(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function rangeLabel(from: Date | undefined, to: Date): string {
  return from ? `${dateLabel(from)} — ${dateLabel(to)}` : `s.d. ${dateLabel(to)}`;
}

export async function getTrialBalanceReport(input: {
  from?: string;
  to?: string;
  includeZero?: boolean;
}): Promise<TrialBalance & { periodLabel: string }> {
  await assertCanView();
  const to = parseDateOnlyEnd(input.to ?? "") ?? new Date();
  const from = parseDateOnly(input.from ?? "");
  const balances = await getAccountBalances({ from, to });
  return {
    ...buildTrialBalance(balances, { includeZero: input.includeZero ?? false }),
    periodLabel: rangeLabel(from, to),
  };
}

export async function getIncomeStatementReport(input: {
  from?: string;
  to?: string;
}): Promise<IncomeStatement & { periodLabel: string }> {
  await assertCanView();
  const to = parseDateOnlyEnd(input.to ?? "") ?? new Date();
  const from = parseDateOnly(input.from ?? "");
  const balances = await getAccountBalances({ from, to });
  return { ...buildIncomeStatement(balances), periodLabel: rangeLabel(from, to) };
}

export async function getBalanceSheetReport(input: {
  asOf?: string;
}): Promise<BalanceSheet & { periodLabel: string; openingWarningDate: string | null }> {
  await assertCanView();
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

type Cell = string | number;

function headerRows(title: string, periodLabel: string, preparedBy: string): Cell[][] {
  return [
    [COMPANY_NAME],
    [title],
    [periodLabel],
    [`Disiapkan oleh: ${preparedBy}`],
    [`Dicetak: ${new Date().toISOString().slice(0, 19).replace("T", " ")}`],
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
  const report = await getTrialBalanceReport(input);

  const rows: Cell[][] = [
    ...headerRows("Neraca Saldo", report.periodLabel, preparedBy),
    ["Kode", "Nama Akun", "Debit", "Kredit", "Saldo"],
    ...report.rows.map((r): Cell[] => [r.code, r.name, r.debit, r.credit, r.signed]),
    ["", "Total", report.totalDebit, report.totalCredit, ""],
  ];

  return toWorkbook(rows, "Neraca Saldo", `neraca-saldo-${dateLabel(new Date())}.xlsx`);
}

export async function exportIncomeStatementExcel(input: {
  from?: string;
  to?: string;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await getIncomeStatementReport(input);

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
  ];

  return toWorkbook(rows, "Laba Rugi", `laba-rugi-${dateLabel(new Date())}.xlsx`);
}

export async function exportBalanceSheetExcel(input: {
  asOf?: string;
}): Promise<{ base64: string; filename: string }> {
  const preparedBy = await assertCanView();
  const report = await getBalanceSheetReport(input);

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
  ];

  return toWorkbook(rows, "Neraca", `neraca-${dateLabel(new Date())}.xlsx`);
}
