'use server';

import { prisma } from '@elorae/db';

export type ItemTypeMasterRow = {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
  group: 'RAW' | 'FINISHED';
  sortOrder: number;
};

/** Returns configurable item type master data (display names + group). Use for dropdowns and reports. */
export async function getItemTypeMasters(): Promise<ItemTypeMasterRow[]> {
  const rows = await prisma.itemTypeMaster.findMany({
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    nameId: r.nameId,
    nameEn: r.nameEn,
    group: r.group,
    sortOrder: r.sortOrder,
  }));
}
