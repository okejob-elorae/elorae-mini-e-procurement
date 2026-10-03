import { prisma } from '@elorae/db';
import type { Prisma } from '@elorae/db';

export async function listSupplierTypes(opts?: {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
  /** Ikut hitung pemasok per jenis — layar kelola memakainya untuk tahu jenis mana yang boleh dihapus. */
  withUsage?: boolean;
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
        ...(opts?.withUsage ? { include: { _count: { select: { suppliers: true } } } } : {}),
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
