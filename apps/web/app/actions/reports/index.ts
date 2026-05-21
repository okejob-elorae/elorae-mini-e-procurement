'use server';

import { prisma } from '@elorae/db';

export async function getSuppliersForReportFilter(): Promise<
  { id: string; name: string; code: string }[]
> {
  const list = await prisma.supplier.findMany({
    where: { status: 'ACTIVE', isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  return list;
}
