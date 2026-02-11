'use server';

import { prisma } from '@/lib/prisma';
import { Decimal } from 'decimal.js';
import * as XLSX from 'xlsx';

export type VendorPerformanceRow = {
  docNumber: string;
  finishedGood: string;
  plannedQty: number;
  actualQty: number;
  efficiency: number;
  materialCost: number;
  returnValue: number;
  status: string;
  completionTimeDays: number | null;
};

export async function getVendorPerformanceReport(
  vendorId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<VendorPerformanceRow[]> {
  const wos = await prisma.workOrder.findMany({
    where: {
      vendorId,
      createdAt: { gte: dateFrom, lte: dateTo },
    },
    include: {
      finishedGood: {
        select: { sku: true, nameId: true, nameEn: true },
      },
      issues: true,
      receipts: true,
      returns: {
        where: { status: 'PROCESSED' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return wos.map((wo) => {
    const plannedQty = Number(wo.plannedQty);
    const actualQty = Number(wo.actualQty ?? 0);
    const efficiency = plannedQty > 0 ? (actualQty / plannedQty) * 100 : 0;
    const totalIssued = wo.issues.reduce(
      (sum, i) => sum.plus(i.totalCost.toString()),
      new Decimal(0)
    );
    const totalReceived = wo.receipts.reduce(
      (sum, r) => sum + Number(r.qtyAccepted),
      0
    );
    const totalReturned = wo.returns.reduce(
      (sum, r) => sum + Number(r.totalValue),
      0
    );
    let completionTimeDays: number | null = null;
    if (wo.issuedAt && wo.completedAt) {
      const ms = new Date(wo.completedAt).getTime() - new Date(wo.issuedAt).getTime();
      completionTimeDays = Math.round(ms / (1000 * 60 * 60 * 24));
    }
    const fgName = wo.finishedGood?.nameEn ?? wo.finishedGood?.nameId ?? wo.finishedGood?.sku ?? '-';
    return {
      docNumber: wo.docNumber,
      finishedGood: fgName,
      plannedQty,
      actualQty,
      efficiency: Math.round(efficiency * 100) / 100,
      materialCost: totalIssued.toNumber(),
      returnValue: totalReturned,
      status: wo.status,
      completionTimeDays,
    };
  });
}

export async function exportVendorPerformanceReport(
  vendorId: string,
  dateFrom: Date,
  dateTo: Date,
  format: 'csv' | 'excel'
): Promise<{ data: string; filename: string } | { base64: string; filename: string }> {
  const rows = await getVendorPerformanceReport(vendorId, dateFrom, dateTo);
  const data = rows.map((r) => ({
    'Doc Number': r.docNumber,
    'Finished Good': r.finishedGood,
    'Planned Qty': r.plannedQty,
    'Actual Qty': r.actualQty,
    'Efficiency %': r.efficiency,
    'Material Cost': r.materialCost,
    'Return Value': r.returnValue,
    'Status': r.status,
    'Completion Time (days)': r.completionTimeDays ?? '',
  }));

  if (format === 'csv') {
    const headers = data.length ? Object.keys(data[0]).join(',') : 'Doc Number,Finished Good,Planned Qty,Actual Qty,Efficiency %,Material Cost,Return Value,Status,Completion Time (days)';
    const lines = data.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    return { data: [headers, ...lines].join('\n'), filename: `vendor-performance-${Date.now()}.csv` };
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Vendor Performance');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return { base64: buffer.toString('base64'), filename: `vendor-performance-${Date.now()}.xlsx` };
}
