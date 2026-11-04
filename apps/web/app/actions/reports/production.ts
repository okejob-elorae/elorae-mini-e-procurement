'use server';

import { prisma } from '@elorae/db';
import { Decimal } from 'decimal.js';
import * as XLSX from 'xlsx';
import { toCsv } from "@/lib/reports/csv";
import { barisEksporKinerjaPemasok, KOLOM_KINERJA_PEMASOK } from '@/lib/laporan/ekspor-laporan';
import { PERMISSIONS } from '@/lib/rbac';
import { wajibIzinLaporan } from './penjaga';

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
  await wajibIzinLaporan(PERMISSIONS.WORK_ORDERS_VIEW);
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
    const _totalReceived = wo.receipts.reduce(
      (sum, r) => sum + Number(r.qtyAccepted),
      0
    );
    void _totalReceived;
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
  await wajibIzinLaporan(PERMISSIONS.WORK_ORDERS_VIEW);
  const rows = await getVendorPerformanceReport(vendorId, dateFrom, dateTo);
  // Kepala kolom dan status sama dengan layar (Indonesia).
  const data = barisEksporKinerjaPemasok(rows);

  if (format === 'csv') {
    /* The formula guard prefixes a leading "-", so the "-" placeholder exports as an em dash. */
    const csvRows = data.map((r) => ({ ...r, "Barang jadi": r["Barang jadi"] === "-" ? "—" : r["Barang jadi"] }));
    return { data: toCsv([...KOLOM_KINERJA_PEMASOK], csvRows), filename: `laporan-setoran-cmt-${Date.now()}.csv` };
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data, { header: [...KOLOM_KINERJA_PEMASOK] });
  XLSX.utils.book_append_sheet(wb, ws, 'Setoran CMT');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return { base64: buffer.toString('base64'), filename: `laporan-setoran-cmt-${Date.now()}.xlsx` };
}
