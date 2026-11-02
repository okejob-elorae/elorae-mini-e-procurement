"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import { getCommissionRecap, type CommissionRecap } from "@/lib/spg-commission/queries";
import { isYearMonth } from "@/lib/spg-commission/month";
import { storeLabel } from "@/lib/spg-commission/recap-display";
import type { PayoutStatus } from "@/lib/spg-commission/recap-payout";
import { toCsv, type CsvCell } from "@/lib/reports/csv";

export type SpgCommissionExportResult =
  | { data: string; filename: string; base64?: never }
  | { base64: string; filename: string; data?: never };

const UNCATEGORIZED = "Tanpa Kategori";

/*
 * Every column is named for what it holds (owner decision 2026-11-02): the per-SPG figure is never
 * labelled as paid, and the payout month and the sales month are two columns.
 */
const SUMMARY_HEADERS = [
  "Bulan Pembayaran",
  "SPG",
  "Toko",
  "Bulan Penjualan",
  "Pcs",
  "Komisi per SPG",
  "Dibayar",
  "Koreksi Diterapkan",
  "Belum Dibayar",
  "Selisih ke Pembayaran Berikutnya",
];

const REPORT_HEADERS = [
  "Bulan Pembayaran",
  "Bulan Penjualan",
  "SPG",
  "Toko",
  "No. Laporan",
  "Status",
  "Pcs",
  "Komisi per SPG",
  "Ditetapkan",
  "Dibayar",
  "Koreksi dari Laporan Ini",
  "Selisih ke Pembayaran Berikutnya",
];

const CORRECTION_HEADERS = [
  "Bulan Pembayaran",
  "SPG",
  "Keterangan",
  "Laporan Asal",
  "Bulan Penjualan Asal",
  "Toko Asal",
  "Jumlah",
  "Diterapkan Pada",
  "Tanggal Diterapkan",
];

const CATEGORY_HEADERS = ["Bulan Pembayaran", "Bulan Penjualan", "SPG", "Toko", "No. Laporan", "Kategori", "Pcs", "Tarif per Pcs", "Komisi per SPG"];

const STATUS_LABEL: Record<PayoutStatus, string> = {
  BELUM_DITETAPKAN: "Belum ditetapkan",
  DITETAPKAN: "Ditetapkan, belum dibayar",
  DIBAYAR: "Dibayar",
  TANPA_BARIS: "Tanpa baris — lewat koreksi",
};

const tanggalWib = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(iso));

function summaryRows(recap: CommissionRecap): Array<Record<string, CsvCell>> {
  return recap.rows.map((r) => ({
    "Bulan Pembayaran": recap.yearMonth,
    SPG: recap.spgNames[r.salesmanId] ?? r.salesmanId,
    Toko: storeLabel(r.storeIds, recap.storeNames),
    "Bulan Penjualan": r.salesMonths.join(", "),
    Pcs: r.pieces,
    "Komisi per SPG": r.figure,
    Dibayar: r.paidAmount,
    "Koreksi Diterapkan": r.correctionsApplied,
    "Belum Dibayar": r.unpaidAmount,
    "Selisih ke Pembayaran Berikutnya": r.pendingDifference,
  }));
}

function reportRows(recap: CommissionRecap): Array<Record<string, CsvCell>> {
  const spgName = (id: string) => recap.spgNames[id] ?? id;
  return recap.payoutLines.map((l) => ({
    "Bulan Pembayaran": l.payoutMonth,
    "Bulan Penjualan": l.salesMonth,
    SPG: spgName(l.salesmanId),
    Toko: recap.storeNames[l.storeId] ?? l.storeId,
    "No. Laporan": recap.reportDocNos[l.reportKey] ?? l.reportKey,
    Status: l.held ? `${STATUS_LABEL[l.status]} — menunggu keputusan` : STATUS_LABEL[l.status],
    Pcs: l.pieces,
    "Komisi per SPG": l.figure,
    Ditetapkan: l.setAmount,
    Dibayar: l.paidAmount,
    "Koreksi dari Laporan Ini": l.correctionsFromThis,
    "Selisih ke Pembayaran Berikutnya": l.pendingDifference,
  }));
}

function correctionRows(recap: CommissionRecap): Array<Record<string, CsvCell>> {
  return recap.corrections.map((c) => ({
    "Bulan Pembayaran": c.payoutMonth,
    SPG: recap.spgNames[c.salesmanId] ?? c.salesmanId,
    Keterangan: c.note,
    "Laporan Asal": c.sourceDocNo,
    "Bulan Penjualan Asal": c.sourceSalesMonth,
    "Toko Asal": recap.storeNames[c.sourceStoreId] ?? c.sourceStoreId,
    Jumlah: c.amount,
    "Diterapkan Pada": c.appliedToLabel,
    "Tanggal Diterapkan": tanggalWib(c.appliedAt),
  }));
}

function categoryRows(recap: CommissionRecap): Array<Record<string, CsvCell>> {
  const spgName = (id: string) => recap.spgNames[id] ?? id;
  const docNo = (id: string) => recap.reportDocNos[id] ?? id;
  /* Grouped per SPG for the payroll reader; the sort is stable, so each SPG keeps the recap's report order. */
  const events = [...recap.events].sort((a, b) => spgName(a.salesmanId).localeCompare(spgName(b.salesmanId)));
  return events.map((e) => ({
    "Bulan Pembayaran": e.yearMonth,
    "Bulan Penjualan": e.salesMonth ?? null,
    SPG: spgName(e.salesmanId),
    Toko: recap.storeNames[e.storeId] ?? e.storeId,
    "No. Laporan": docNo(e.sellThroughId),
    Kategori: e.categoryId === null ? UNCATEGORIZED : recap.categoryNames[e.categoryId] ?? e.categoryId,
    Pcs: e.pieces,
    "Tarif per Pcs": e.ratePerPiece,
    "Komisi per SPG": e.amount,
  }));
}

/**
 * The SPG commission recap of one PAYOUT month as a file: CSV is the per-SPG summary; XLSX carries
 * that summary, one row per report × SPG ("Per laporan"), every correction applied in the month
 * ("Koreksi"), and the per-category computation ("Per kategori").
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reportRows(recap), { header: REPORT_HEADERS }), "Per laporan");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(correctionRows(recap), { header: CORRECTION_HEADERS }), "Koreksi");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryRows(recap), { header: CATEGORY_HEADERS }), "Per kategori");
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { base64: buffer.toString("base64"), filename: `${filename}.xlsx` };
}
