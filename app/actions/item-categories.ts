'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';

export async function getItemCategories(activeOnly = false) {
  return prisma.itemCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createItemCategory(data: {
  name: string;
  code?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const row = await prisma.itemCategory.create({
    data: {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      sortOrder: data.sortOrder ?? null,
      isActive: data.isActive ?? true,
    },
  });
  revalidatePath('/backoffice/items');
  return row;
}

export async function updateItemCategory(
  id: string,
  data: {
    name: string;
    code?: string;
    sortOrder?: number;
    isActive?: boolean;
  }
) {
  const row = await prisma.itemCategory.update({
    where: { id },
    data: {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      sortOrder: data.sortOrder ?? null,
      isActive: data.isActive ?? true,
    },
  });
  revalidatePath('/backoffice/items');
  return row;
}

export async function deleteItemCategory(id: string) {
  const itemCount = await prisma.item.count({ where: { categoryId: id } });
  if (itemCount > 0) {
    throw new Error('Cannot delete category with assigned items');
  }
  await prisma.itemCategory.delete({ where: { id } });
  revalidatePath('/backoffice/items');
}
