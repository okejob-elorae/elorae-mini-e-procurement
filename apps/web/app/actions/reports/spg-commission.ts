"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import { getCommissionRecap, type CommissionRecap } from "@/lib/spg-commission/queries";
import { isYearMonth } from "@/lib/spg-commission/month";
import { storeLabel } from "@/lib/spg-commission/recap-display";

export type SpgCommissionExportResult =
  | { data: string; filename: string; base64?: never }
  | { base64: string; filename: string; data?: never };

type Cell = string | number | null;

const UNCATEGORIZED = "Tanpa Kategori";

const SUMMARY_HEADERS = ["SPG", "Toko", "Pcs", "Komisi Diperoleh", "Komisi Dibatalkan", "Komisi Bersih"];

const DETAIL_HEADERS = ["Bulan", "SPG", "Toko", "No. Laporan", "Kategori", "Jenis", "Pcs", "Tarif per Pcs", "Jumlah"];

function summaryRows(recap: CommissionRecap): Array<Record<string, Cell>> {
  return recap.rows.map((r) => ({
    SPG: recap.spgNames[r.salesmanId] ?? r.salesmanId,
    Toko: storeLabel(r.storeIds, recap.storeNames),
    Pcs: r.pieces,
    "Komisi Diperoleh": r.earned,
    "Komisi Dibatalkan": r.reversed,
    "Komisi Bersih": r.net,
  }));
}

function detailRows(recap: CommissionRecap): Array<Record<string, Cell>> {
  const spgName = (id: string) => recap.spgNames[id] ?? id;
  const docNo = (id: string) => recap.reportDocNos[id] ?? id;
  /* Grouped per SPG for the payroll reader; the sort is stable, so each SPG keeps the recap's report order. */
  const events = [...recap.events].sort((a, b) => spgName(a.salesmanId).localeCompare(spgName(b.salesmanId)));
  return events.map((e) => ({
    Bulan: e.yearMonth,
    SPG: spgName(e.salesmanId),
    Toko: recap.storeNames[e.storeId] ?? e.storeId,
    "No. Laporan": docNo(e.sellThroughId),
    Kategori: e.categoryId === null ? UNCATEGORIZED : recap.categoryNames[e.categoryId] ?? e.categoryId,
    Jenis: e.kind,
    Pcs: e.pieces,
    "Tarif per Pcs": e.ratePerPiece,
    Jumlah: e.amount,
  }));
}

/* Excel's UTF-8 signature: without it, Excel on Windows reads the file as ANSI and garbles non-ASCII names. */
const UTF8_BOM = "﻿";

/* A text cell opening with one of these is run by a spreadsheet as a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Every cell quoted with embedded quotes doubled; an empty cell stays empty rather than printing
 * "null". A TEXT cell that would open as a formula gets a leading `'`, which a spreadsheet shows as
 * text. Numbers never do: a negative amount starts with `-` and must stay a number.
 */
function toCsv(headers: string[], rows: Array<Record<string, Cell>>): string {
  const text = (value: Cell) => {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  };
  const quote = (value: Cell) => `"${text(value).replace(/"/g, `""`)}"`;
  const lines = rows.map((r) => headers.map((h) => quote(r[h] ?? null)).join(","));
  return `${UTF8_BOM}${[headers.join(","), ...lines].join("\n")}\n`;
}

/**
 * The SPG commission recap of one WIB month as a file: CSV is the per-SPG summary, XLSX carries
 * that summary plus one detail row per commission event (report × SPG × category × kind).
 */
export async function exportSpgCommissionRecap(
  yearMonth: string,
  format: "csv" | "excel",
): Promise<SpgCommissionExportResult> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW);
  if (!isYearMonth(yearMonth)) throw new Error("Invalid month");

  const recap = await getCommissionRecap(yearMonth);
  const filename = `komisi-spg-${yearMonth}`;
  const summary = summaryRows(recap);

  if (format === "csv") {
    return { data: toCsv(SUMMARY_HEADERS, summary), filename: `${filename}.csv` };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary, { header: SUMMARY_HEADERS }), "Ringkasan");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows(recap), { header: DETAIL_HEADERS }), "Rincian");
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { base64: buffer.toString("base64"), filename: `${filename}.xlsx` };
}
