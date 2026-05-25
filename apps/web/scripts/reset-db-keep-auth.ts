/**
 * Reset transactional/business data while preserving login, RBAC, system settings,
 * and reference masters (UOM, DocNumberConfig, ItemCategory).
 *
 * Usage: npm run db:reset-keep-auth
 */
import 'dotenv/config';
import { DocType, prisma } from '@elorae/db';

const PRESERVE_TABLES = new Set([
  'User',
  'Account',
  'Session',
  'VerificationToken',
  'RoleDefinition',
  'RolePermission',
  'Permission',
  'SystemSetting',
  'PinAttempt',
  'UOM',
  'UOMConversion',
  'DocNumberConfig',
  'ItemCategory',
  'JubelioCategoryMapping',
  '_prisma_migrations',
]);

async function truncateBusinessTables() {
  const tables = await prisma.$queryRaw<Array<{ TABLE_NAME: string }>>`
    SELECT TABLE_NAME
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
  `;

  const toTruncate = tables
    .map((t) => t.TABLE_NAME)
    .filter((name) => name && !PRESERVE_TABLES.has(name));

  await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 0;`);

  for (const tableName of toTruncate) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${tableName}\`;`);
  }

  await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1;`);

  console.log(`Truncated ${toTruncate.length} tables. Preserved: ${[...PRESERVE_TABLES].join(', ')}`);
}

async function ensureReferenceData() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  await prisma.uOM.upsert({
    where: { code: 'PCS' },
    update: {},
    create: { code: 'PCS', nameId: 'Pieces', nameEn: 'Pieces' },
  });

  const docConfigs: { docType: DocType; prefix: string; resetPeriod: string }[] = [
    { docType: 'PO', prefix: 'PO/', resetPeriod: 'YEARLY' },
    { docType: 'GRN', prefix: 'GRN/', resetPeriod: 'MONTHLY' },
    { docType: 'WO', prefix: 'WO/', resetPeriod: 'YEARLY' },
    { docType: 'ADJ', prefix: 'ADJ/', resetPeriod: 'MONTHLY' },
    { docType: 'RET', prefix: 'RET/', resetPeriod: 'MONTHLY' },
    { docType: 'ISSUE', prefix: 'ISS/', resetPeriod: 'MONTHLY' },
    { docType: 'RECEIPT', prefix: 'RCPT/', resetPeriod: 'MONTHLY' },
  ];

  for (const c of docConfigs) {
    await prisma.docNumberConfig.upsert({
      where: { docType: c.docType },
      update: {},
      create: {
        docType: c.docType,
        prefix: c.prefix,
        resetPeriod: c.resetPeriod,
        padding: 4,
        lastNumber: 0,
        year,
        month,
      },
    });
  }

  console.log('Reference data OK (UOM PCS, DocNumberConfig x7).');
}

async function main() {
  console.log('Resetting database (keeping auth + reference masters)...');
  await truncateBusinessTables();
  await ensureReferenceData();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
