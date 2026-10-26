"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import { listReceivablesForExport, type ReceivableFilters } from "@/lib/finance/ar/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { AGING_BUCKET_LABELS } from "@/lib/finance/ar/aging";
import { toCsv } from "@/lib/reports/csv";

export type ReceivableExportResult =
  | { empty: true; data?: never; base64?: never }
  | { data: string; filename: string; truncated: boolean; totalRows: number; base64?: never }
  | { base64: string; filename: string; truncated: boolean; totalRows: number; data?: never };

function toRows(rows: Awaited<ReturnType<typeof listReceivablesForExport>>["rows"]) {
  return rows.map((r) => ({
    Toko: r.storeName,
    "No. Nota": r.docNo,
    "Tgl Faktur": formatDateOnlyJakarta(r.invoiceDate),
    "Jatuh Tempo": formatDateOnlyJakarta(r.dueDate),
    "Hari Terlambat": r.daysOverdue,
    Bucket: AGING_BUCKET_LABELS[r.bucket],
    "Jumlah Asal": r.originalAmount,
    "Sudah Dibayar": r.paidAmount,
    Outstanding: r.outstandingAmount,
    Status: r.status,
    Kolektor: r.collectorName ?? "Belum ditugaskan",
    /* Null only for a SELL_THROUGH row with no salesman assigned yet — `String(null)` would print
     * the literal text "null" into the CSV cell, so it needs the same explicit fallback the DELIVERY
     * rows never needed. */
    Salesman: r.salesmanName ?? "—",
  }));
}

const CSV_HEADERS = [
  "Toko", "No. Nota", "Tgl Faktur", "Jatuh Tempo", "Hari Terlambat", "Bucket",
  "Jumlah Asal", "Sudah Dibayar", "Outstanding", "Status", "Kolektor", "Salesman",
];

export async function exportReceivablesReport(
  filters: ReceivableFilters,
  format: "csv" | "excel",
): Promise<ReceivableExportResult> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.RECEIVABLES_VIEW);

  const { rows: exportRows, truncated, totalRows } = await listReceivablesForExport(filters);
  /**
   * Gate on the post-bucket-filter rows, not `totalRows`: a bucket filter matching nothing must not
   * download a header-only file. A truncated set may hold matches past the cap, so it is never empty.
   */
  if (exportRows.length === 0 && !truncated) return { empty: true };
  const rows = toRows(exportRows);
  const filename = `piutang-overdue-${Date.now()}`;

  if (format === "csv") {
    const data = toCsv(CSV_HEADERS, rows);
    return { data, filename: `${filename}.csv`, truncated, totalRows };
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Piutang");
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { base64: buffer.toString("base64"), filename: `${filename}.xlsx`, truncated, totalRows };
}
