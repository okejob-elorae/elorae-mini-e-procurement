'use server';

import { prisma } from '@/lib/prisma';

export async function getSuppliersForReportFilter(): Promise<
  { id: string; name: string; code: string }[]
> {
  const list = await prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  return list;
}
