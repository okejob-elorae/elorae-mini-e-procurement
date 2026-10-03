import { prisma } from '@elorae/db';

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

/** Penolakan yang bisa dijelaskan ke layar lewat `code` (pesan aksi server disamarkan di produksi). */
export class ItemCategoryError extends Error {
  constructor(
    readonly code: "IN_USE",
    message: string,
    readonly count = 0,
  ) {
    super(message);
    this.name = "ItemCategoryError";
  }
}

export async function deleteItemCategoryRecord(id: string) {
  const itemCount = await prisma.item.count({ where: { categoryId: id } });
  if (itemCount > 0) {
    throw new ItemCategoryError("IN_USE", "Cannot delete category with assigned items", itemCount);
  }
  await prisma.itemCategory.delete({ where: { id } });
}
