import { prisma } from '@elorae/db';
import { ItemType } from '@elorae/db';

export type ItemFormPrefetchUom = {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
};

export type ItemFormPrefetchCategory = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
};

export type ItemFormPrefetchTypeMaster = {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
  group: 'RAW' | 'FINISHED';
  sortOrder: number;
};

export type ItemFormPrefetchMaterial = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  uom: { id: string; code: string };
};

export type ItemFormPrefetch = {
  uoms: ItemFormPrefetchUom[];
  itemCategories: ItemFormPrefetchCategory[];
  itemTypeMasters: ItemFormPrefetchTypeMaster[];
  materials?: ItemFormPrefetchMaterial[];
};

export async function getItemFormPrefetch(options?: {
  includeMaterials?: boolean;
}): Promise<ItemFormPrefetch> {
  const [uoms, itemCategories, itemTypeMasters, materials] = await Promise.all([
    prisma.uOM.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameId: true, nameEn: true },
    }),
    prisma.itemCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, isActive: true },
    }),
    prisma.itemTypeMaster.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        nameId: true,
        nameEn: true,
        group: true,
        sortOrder: true,
      },
    }),
    options?.includeMaterials
      ? prisma.item.findMany({
          where: {
            isActive: true,
            type: { in: [ItemType.FABRIC, ItemType.ACCESSORIES] },
          },
          orderBy: { sku: 'asc' },
          select: {
            id: true,
            sku: true,
            nameId: true,
            nameEn: true,
            uom: { select: { id: true, code: true } },
          },
        })
      : Promise.resolve([] as ItemFormPrefetchMaterial[]),
  ]);

  return {
    uoms,
    itemCategories,
    itemTypeMasters: itemTypeMasters.map((r) => ({
      id: r.id,
      code: r.code,
      nameId: r.nameId,
      nameEn: r.nameEn,
      group: r.group,
      sortOrder: r.sortOrder,
    })),
    materials: options?.includeMaterials ? materials : undefined,
  };
}
