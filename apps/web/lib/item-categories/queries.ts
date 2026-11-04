import { prisma } from '@elorae/db';

export async function listItemCategories(activeOnly = false) {
  return prisma.itemCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

/** Sama, ditambah jumlah item per kategori — layar kelola memakainya untuk tahu kategori mana yang boleh dihapus. */
export async function listItemCategoriesWithUsage() {
  return prisma.itemCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { items: true } } },
  });
}
