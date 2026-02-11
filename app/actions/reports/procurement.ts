'use server';

import { prisma } from '@/lib/prisma';
import { getETAStatus } from '@/lib/eta-alerts';
import { POStatus } from '@prisma/client';
import { Decimal } from 'decimal.js';
import * as XLSX from 'xlsx';

export type ProcurementReportFilters = {
  fromDate?: Date;
  toDate?: Date;
  supplierId?: string;
  status?: POStatus[];
};

const DEFAULT_STATUSES: POStatus[] = ['SUBMITTED', 'PARTIAL'];

export async function getProcurementReport(filters?: ProcurementReportFilters) {
  const statusList = filters?.status?.length
    ? filters.status
    : DEFAULT_STATUSES;

  const where: {
    createdAt?: { gte?: Date; lte?: Date };
    supplierId?: string;
    status?: { in: POStatus[] };
  } = {
    status: { in: statusList },
  };

  if (filters?.fromDate || filters?.toDate) {
    where.createdAt = {};
    if (filters.fromDate) where.createdAt.gte = filters.fromDate;
    if (filters.toDate) where.createdAt.lte = filters.toDate;
  }
  if (filters?.supplierId) where.supplierId = filters.supplierId;

  const pos = await prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { name: true, code: true } },
      items: {
        include: {
          item: { select: { sku: true, nameId: true, nameEn: true } },
        },
      },
      _count: { select: { grns: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const report = pos.map((po) => {
    let outstandingQty = 0;
    let outstandingValue = 0;
    for (const item of po.items) {
      const qty = Number(item.qty);
      const received = Number(item.receivedQty);
      const pending = Math.max(0, qty - received);
      outstandingQty += pending;
      outstandingValue += pending * Number(item.price);
    }
    const etaStatus = getETAStatus(po.etaDate, po.status);
    return {
      id: po.id,
      docNumber: po.docNumber,
      supplier: po.supplier,
      status: po.status,
      etaDate: po.etaDate,
      grandTotal: Number(po.grandTotal),
      outstandingQty,
      outstandingValue,
      grnCount: po._count.grns,
      etaStatus: etaStatus.status,
      etaMessage: etaStatus.message,
      daysUntil: etaStatus.daysUntil,
      createdAt: po.createdAt,
    };
  });

  const totalOutstanding = report.reduce((s, r) => s + r.outstandingValue, 0);
  const totalValue = report.reduce((s, r) => s + r.grandTotal, 0);
  const overdueCount = report.filter((r) => r.etaStatus === 'danger').length;
  const dueSoonCount = report.filter((r) => r.etaStatus === 'warning').length;

  const summary = {
    totalPOs: report.length,
    totalOutstanding,
    totalValue,
    overdueCount,
    dueSoonCount,
  };

  return { report, summary };
}

function reportToRows(report: Awaited<ReturnType<typeof getProcurementReport>>['report']) {
  return report.map((r) => ({
    'Doc Number': r.docNumber,
    'Supplier': r.supplier.name,
    'Supplier Code': r.supplier.code,
    'Status': r.status,
    'ETA Date': r.etaDate ? new Date(r.etaDate).toLocaleDateString() : '',
    'ETA Alert': r.etaMessage,
    'Grand Total': r.grandTotal,
    'Outstanding Qty': r.outstandingQty,
    'Outstanding Value': r.outstandingValue,
    'GRNs': r.grnCount,
  }));
}

export type ExportResult =
  | { data: string; filename: string; base64?: never }
  | { base64: string; filename: string; data?: never };

export async function exportProcurementReport(
  filters: ProcurementReportFilters | undefined,
  format: 'csv' | 'excel'
): Promise<ExportResult> {
  const { report } = await getProcurementReport(filters);
  const rows = reportToRows(report);

  if (format === 'csv') {
    const headers =
      rows.length > 0
        ? Object.keys(rows[0]).join(',')
        : 'Doc Number,Supplier,Supplier Code,Status,ETA Date,ETA Alert,Grand Total,Outstanding Qty,Outstanding Value,GRNs';
    if (rows.length === 0) {
      return { data: headers + '\n', filename: `procurement-report-${Date.now()}.csv` };
    }
    const headerLine = Object.keys(rows[0]).join(',');
    const lines = rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const data = [headerLine, ...lines].join('\n');
    return { data, filename: `procurement-report-${Date.now()}.csv` };
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Procurement');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return { base64: buffer.toString('base64'), filename: `procurement-report-${Date.now()}.xlsx` };
}
