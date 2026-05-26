/**
 * Seed Pantone TCX catalog from lib/pantone/pantone-tcx-colors.json
 */
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '../generated/prisma/client';
import { classifyColor } from '../src/pantone/classify';

type CatalogEntry = { name: string; hex: string; tcx: string };

export async function seedPantoneColors(prisma: PrismaClient): Promise<void> {
  const jsonPath = path.join(
    process.cwd(),
    'prisma/pantone-tcx-colors.json'
  );
  if (!fs.existsSync(jsonPath)) {
    console.warn(
      'Skipping Pantone seed: prisma/pantone-tcx-colors.json not found.'
    );
    return;
  }

  const catalog = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as CatalogEntry[];
  console.log(`Seeding ${catalog.length} Pantone TCX colors...`);

  const batchSize = 100;
  for (let i = 0; i < catalog.length; i += batchSize) {
    const batch = catalog.slice(i, i + batchSize);
    await Promise.all(
      batch.map((entry) => {
        const classified = classifyColor(entry.hex, entry.tcx);
        return prisma.pantoneColor.upsert({
          where: { tcx: entry.tcx },
          update: {
            name: entry.name,
            hex: entry.hex,
            rgbR: classified.rgbR,
            rgbG: classified.rgbG,
            rgbB: classified.rgbB,
            groupName: classified.groupName,
            filterTags: classified.filterTags,
            labL: classified.labL,
            labA: classified.labA,
            labB: classified.labB,
          },
          create: {
            tcx: entry.tcx,
            name: entry.name,
            hex: entry.hex,
            rgbR: classified.rgbR,
            rgbG: classified.rgbG,
            rgbB: classified.rgbB,
            groupName: classified.groupName,
            filterTags: classified.filterTags,
            labL: classified.labL,
            labA: classified.labA,
            labB: classified.labB,
          },
        });
      })
    );
  }

  console.log(`Pantone TCX catalog OK (${catalog.length} colors)`);
}

if (require.main === module) {
  import('dotenv/config').then(async () => {
    const { PrismaMariaDb } = await import('@prisma/adapter-mariadb');
    const { PrismaClient } = await import('@prisma/client');
    const { getDatabaseUrl } = await import('../lib/db-connection');
    const adapter = new PrismaMariaDb(getDatabaseUrl() || process.env.DATABASE_URL!);
    const prisma = new PrismaClient({ adapter });
    try {
      await seedPantoneColors(prisma);
    } finally {
      await prisma.$disconnect();
    }
  });
}
