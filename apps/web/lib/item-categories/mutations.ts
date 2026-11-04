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

export type ItemCategoryDeleteErrorCode = "HAS_ITEMS" | "HAS_COMMISSION_RATES" | "HAS_SALE_LINES";

export class ItemCategoryDeleteError extends Error {
  constructor(readonly code: ItemCategoryDeleteErrorCode) {
    super(code);
    this.name = "ItemCategoryDeleteError";
  }
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

/**
 * Refuses while any item, SPG commission rate or SPG sale line still points at the category. The
 * row is locked first because `setRate` takes the same lock before writing a rate, so a rate cannot
 * slip in between this count and the delete.
 *
 * A sale line keeps the category the item had when it was sold, with its date, because SPG
 * commission is paid by that category (owner answer P8; P69). Moving the item to another category
 * does not move its old sales, so the old category can still carry sales after its last item has
 * left — deleting it would leave the sale detail and the commission recap naming no category.
 * Deactivate it instead.
 */
export async function deleteItemCategoryRecord(id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`ItemCategory\` WHERE \`id\` = ${id} FOR UPDATE`;
    const itemCount = await tx.item.count({ where: { categoryId: id } });
    if (itemCount > 0) throw new ItemCategoryError("IN_USE", "Cannot delete category with assigned items", itemCount);
    const rateCount = await tx.spgCommissionRate.count({ where: { itemCategoryId: id } });
    if (rateCount > 0) throw new ItemCategoryDeleteError("HAS_COMMISSION_RATES");
    const saleLines = await tx.spgSaleLine.count({ where: { categoryId: id } });
    if (saleLines > 0) throw new ItemCategoryDeleteError("HAS_SALE_LINES");
    await tx.itemCategory.delete({ where: { id } });
  });
}
