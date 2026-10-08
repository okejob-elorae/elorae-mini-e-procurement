'use server';

import { prisma } from '@elorae/db';
import { getETAStatus } from '@/lib/eta-alerts';
import { barisEksporPengadaan, keCsv, KOLOM_PENGADAAN } from '@/lib/laporan/ekspor-laporan';
import { POStatus } from '@elorae/db';
import * as XLSX from 'xlsx';
import { PERMISSIONS } from '@/lib/rbac';
import { wajibIzinLaporan } from './penjaga';

export type ProcurementReportFilters = {
  fromDate?: Date;
  toDate?: Date;
  supplierId?: string;
  status?: POStatus[];
};

const DEFAULT_STATUSES: POStatus[] = ['SUBMITTED', 'PARTIAL'];

export async function getProcurementReport(filters?: ProcurementReportFilters) {
  await wajibIzinLaporan(PERMISSIONS.PURCHASE_ORDERS_VIEW);
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


export type ExportResult =
  | { data: string; filename: string; base64?: never }
  | { base64: string; filename: string; data?: never };

export async function exportProcurementReport(
  filters: ProcurementReportFilters | undefined,
  format: 'csv' | 'excel'
): Promise<ExportResult> {
  await wajibIzinLaporan(PERMISSIONS.PURCHASE_ORDERS_VIEW);
  const { report } = await getProcurementReport(filters);
  // Kepala kolom, status, dan tanggal sama dengan layar (Indonesia, WIB).
  const rows = barisEksporPengadaan(report);

  if (format === 'csv') {
    return { data: keCsv(KOLOM_PENGADAAN, rows) + '\n', filename: `laporan-pengadaan-${Date.now()}.csv` };
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...KOLOM_PENGADAAN] });
  XLSX.utils.book_append_sheet(wb, ws, 'Pengadaan');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return { base64: buffer.toString('base64'), filename: `laporan-pengadaan-${Date.now()}.xlsx` };
}
