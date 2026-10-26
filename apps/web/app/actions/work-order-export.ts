"use server";

import * as XLSX from "xlsx";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { buildWorkOrderExportSheets, type SheetRows } from "@/lib/work-orders/export/sheets";

export type WorkOrderExportResult =
  | { status: "ok"; base64: string; filename: string }
  | { status: "forbidden" }
  | { status: "not_found" };

const WO_PERMISSIONS = [
  PERMISSIONS.WORK_ORDERS_VIEW,
  PERMISSIONS.WORK_ORDERS_CREATE,
  PERMISSIONS.WORK_ORDERS_MANAGE,
];

function toSheet(rows: SheetRows, firstColWidth: number): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const columns = Math.max(...rows.map((r) => r.length), 1);
  sheet["!cols"] = Array.from({ length: columns }, (_, i) => ({ wch: i === 0 ? firstColWidth : 12 }));
  return sheet;
}

export async function exportWorkOrderXlsx(workOrderId: string): Promise<WorkOrderExportResult> {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  if (!session || !WO_PERMISSIONS.some((code) => hasPermission(permissions, code))) {
    return { status: "forbidden" };
  }

  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      docNumber: true,
      status: true,
      createdAt: true,
      issuedAt: true,
      targetDate: true,
      notes: true,
      plannedQty: true,
      outputMode: true,
      skuBreakdown: true,
      consumptionPlan: true,
      vendor: { select: { name: true, code: true } },
      finishedGood: {
        select: { sku: true, nameId: true, variants: true, uom: { select: { code: true } } },
      },
    },
  });
  if (!wo) return { status: "not_found" };

  const sheets = buildWorkOrderExportSheets({
    docNumber: wo.docNumber,
    status: wo.status,
    createdAt: wo.createdAt,
    issuedAt: wo.issuedAt,
    targetDate: wo.targetDate,
    notes: wo.notes,
    plannedQty: Number(wo.plannedQty),
    outputMode: wo.outputMode,
    vendor: wo.vendor,
    finishedGood: {
      sku: wo.finishedGood.sku,
      nameId: wo.finishedGood.nameId,
      uomCode: wo.finishedGood.uom.code,
      variants: wo.finishedGood.variants,
    },
    skuBreakdown: wo.skuBreakdown,
    consumptionPlan: wo.consumptionPlan,
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, toSheet(sheets.workOrder, 18), "Work Order");
  if (sheets.skuDetail) XLSX.utils.book_append_sheet(wb, toSheet(sheets.skuDetail, 18), "Rincian SKU");
  XLSX.utils.book_append_sheet(wb, toSheet(sheets.materials, 18), "Bahan");

  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return {
    status: "ok",
    base64: buffer.toString("base64"),
    filename: `${wo.docNumber.replaceAll("/", "-")}.xlsx`,
  };
}
