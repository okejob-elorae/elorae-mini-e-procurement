import { prisma } from '@/lib/prisma';

export async function createItemCategoryRecord(data: {
  name: string;
  code?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  return prisma.itemCategory.create({
    data: {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      sortOrder: data.sortOrder ?? null,
      isActive: data.isActive ?? true,
    },
  });
}

export async function updateItemCategoryRecord(
  id: string,
  data: {
    name: string;
    code?: string;
    sortOrder?: number;
    isActive?: boolean;
  }
) {
  return prisma.itemCategory.update({
    where: { id },
    data: {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      sortOrder: data.sortOrder ?? null,
      isActive: data.isActive ?? true,
    },
  });
}

export async function deleteItemCategoryRecord(id: string) {
  const itemCount = await prisma.item.count({ where: { categoryId: id } });
  if (itemCount > 0) {
    throw new Error('Cannot delete category with assigned items');
  }
  await prisma.itemCategory.delete({ where: { id } });
}
