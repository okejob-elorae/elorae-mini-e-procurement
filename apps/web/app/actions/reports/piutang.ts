"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import { listReceivablesForExport, type ReceivableFilters } from "@/lib/finance/ar/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { AGING_BUCKET_LABELS } from "@/lib/finance/ar/aging";

export type ReceivableExportResult =
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
    Salesman: r.salesmanName,
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
  const rows = toRows(exportRows);
  const filename = `piutang-overdue-${Date.now()}`;

  if (format === "csv") {
    const lines = rows.map((r) =>
      CSV_HEADERS.map((h) => `"${String((r as Record<string, unknown>)[h]).replace(/"/g, '""')}"`).join(","),
    );
    const data = [CSV_HEADERS.join(","), ...lines].join("\n") + "\n";
    return { data, filename: `${filename}.csv`, truncated, totalRows };
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Piutang");
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { base64: buffer.toString("base64"), filename: `${filename}.xlsx`, truncated, totalRows };
}
