import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const items = await prisma.item.count({ where: { type: 'FINISHED_GOOD' } });
  const inv = await prisma.inventoryValue.count();
  const mappings = await prisma.jubelioProductMapping.count();
  const sample = await prisma.item.findFirst({
    where: { sku: '24000016T' },
    include: { inventoryValues: true },
  });
  const variants = Array.isArray(sample?.variants) ? (sample!.variants as unknown[]) : [];
  console.log({
    finishedGoodItems: items,
    inventoryValueRows: inv,
    jubelioMappings: mappings,
    sample: sample
      ? {
          sku: sample.sku,
          variantJsonCount: variants.length,
          inventoryValueRows: sample.inventoryValues.length,
          allInvZero: sample.inventoryValues.every((r) => Number(r.qtyOnHand) === 0),
        }
      : null,
  });
}

main()
  .finally(() => prisma.$disconnect());
