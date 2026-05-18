/**
 * CLI helper for local catalog sync verification.
 * Usage:
 *   npx tsx scripts/run-jubelio-catalog-sync.ts --dry-run
 *   npx tsx scripts/run-jubelio-catalog-sync.ts --import
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { syncCatalog } from '../lib/jubelio/sync-catalog';

async function main() {
  const dryRun = !process.argv.includes('--import');
  const source = process.argv.includes('--api') ? 'api' : 'snapshot';
  const groupArg = process.argv.find((a) => a.startsWith('--group='));
  const itemGroupIds = groupArg
    ? groupArg
        .slice('--group='.length)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n))
    : undefined;

  console.log(
    `Jubelio catalog sync (dryRun=${dryRun}, source=${source}${itemGroupIds ? `, groups=${itemGroupIds.join(',')}` : ''})...`
  );
  const result = await syncCatalog({ dryRun, source, itemGroupIds });
  console.log(JSON.stringify(result.summary, null, 2));
  if (result.errors.length) {
    console.error('Errors:', result.errors.slice(0, 5));
    process.exit(1);
  }
  console.log(`Items processed: ${result.items.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
