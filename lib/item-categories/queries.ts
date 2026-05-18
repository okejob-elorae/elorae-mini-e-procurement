import { prisma } from '@/lib/prisma';

export async function listItemCategories(activeOnly = false) {
  return prisma.itemCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}
