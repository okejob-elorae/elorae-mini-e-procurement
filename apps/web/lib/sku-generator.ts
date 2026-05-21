import { prisma } from './prisma';
import { ItemType } from '@prisma/client';

const typePrefixes: Record<ItemType, string> = {
  FABRIC: 'FAB',
  ACCESSORIES: 'ACC',
  FINISHED_GOOD: 'FG'
};

export async function generateSKU(type: ItemType): Promise<string> {
  const prefix = typePrefixes[type];
  
  // Get latest SKU of this type
  const latest = await prisma.item.findFirst({
    where: { type },
    orderBy: { sku: 'desc' },
    select: { sku: true }
  });
  
  let sequence = 1;
  if (latest?.sku) {
    const match = latest.sku.match(/\d+$/);
    if (match) {
      sequence = parseInt(match[0]) + 1;
    }
  }
  
  return `${prefix}-${String(sequence).padStart(5, '0')}`;
}
