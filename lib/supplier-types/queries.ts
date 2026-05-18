import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function listSupplierTypes(opts?: {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const where: Prisma.SupplierTypeWhereInput = opts?.activeOnly ? { isActive: true } : {};
  const pageSize = opts?.pageSize ?? 0;
  const page = opts?.page ?? 1;

  if (pageSize > 0) {
    const [data, totalCount] = await Promise.all([
      prisma.supplierType.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
      prisma.supplierType.count({ where }),
    ]);
    return { data, totalCount };
  }

  return prisma.supplierType.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
}

export async function getSupplierTypeById(id: string) {
  return prisma.supplierType.findUnique({ where: { id } });
}
