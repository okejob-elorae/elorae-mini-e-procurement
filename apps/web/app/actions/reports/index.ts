'use server';

import { prisma } from '@elorae/db';
import { PERMISSIONS } from '@/lib/rbac';
import { wajibIzinLaporan } from './penjaga';

export async function getSuppliersForReportFilter(): Promise<
  { id: string; name: string; code: string }[]
> {
  await wajibIzinLaporan(PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.SUPPLIERS_VIEW);
  const list = await prisma.supplier.findMany({
    where: { status: 'ACTIVE', isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  return list;
}
