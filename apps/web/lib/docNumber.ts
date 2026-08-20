import { DocType } from '@elorae/db';
import { prisma, Prisma, sqlId } from '@elorae/db';

const DEFAULT_CONFIGS: Record<
  DocType,
  { prefix: string; resetPeriod: 'YEARLY' | 'MONTHLY'; padding: number }
> = {
  PO: { prefix: 'PO/', resetPeriod: 'YEARLY', padding: 4 },
  GRN: { prefix: 'GRN/', resetPeriod: 'MONTHLY', padding: 4 },
  WO: { prefix: 'WO/', resetPeriod: 'YEARLY', padding: 4 },
  ADJ: { prefix: 'ADJ/', resetPeriod: 'MONTHLY', padding: 4 },
  RET: { prefix: 'RET/', resetPeriod: 'MONTHLY', padding: 4 },
  ISSUE: { prefix: 'ISS/', resetPeriod: 'MONTHLY', padding: 4 },
  RECEIPT: { prefix: 'RCPT/', resetPeriod: 'MONTHLY', padding: 4 },
  OPN: { prefix: 'OPN/', resetPeriod: 'MONTHLY', padding: 4 },
  PUTUS: { prefix: 'PUTUS/', resetPeriod: 'YEARLY', padding: 4 },
  KONSI: { prefix: 'KONSI/', resetPeriod: 'YEARLY', padding: 4 },
  VANLOAD: { prefix: 'VLOAD/', resetPeriod: 'YEARLY', padding: 4 },
  VANSALE: { prefix: 'VSALE/', resetPeriod: 'YEARLY', padding: 4 },
  VANRECON: { prefix: 'VRCN/', resetPeriod: 'YEARLY', padding: 4 },
  SPGSALE: { prefix: 'SPG/', resetPeriod: 'YEARLY', padding: 4 },
  DELIVERY: { prefix: 'DLV/', resetPeriod: 'MONTHLY', padding: 4 },
};

type ConfigRow = {
  lastNumber: number;
  year: number;
  month: number;
  prefix: string;
  padding: number;
  resetPeriod: string;
};

/** Generate next doc number. Uses atomic UPDATE so concurrent callers get distinct numbers. */
export async function generateDocNumber(
  type: DocType,
  tx?: any
): Promise<string> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const prismaClient = tx || prisma;

  let config = await prismaClient.docNumberConfig.findUnique({
    where: { docType: type },
  });

  if (!config) {
    const def = DEFAULT_CONFIGS[type];
    try {
      config = await prismaClient.docNumberConfig.create({
        data: {
          docType: type,
          prefix: def.prefix,
          resetPeriod: def.resetPeriod,
          padding: def.padding,
          lastNumber: 0,
          year: currentYear,
          month: currentMonth,
        },
      });
    } catch {
      config = await prismaClient.docNumberConfig.findUnique({
        where: { docType: type },
      });
      if (!config) throw new Error(`Failed to get or create DocNumberConfig for ${type}`);
    }
  }

  // Atomic increment (or reset) in the DB so no two callers get the same number
  await prismaClient.$executeRaw(Prisma.sql`
    UPDATE ${sqlId('DocNumberConfig')}
    SET
      ${sqlId('lastNumber')} = CASE
        WHEN ${sqlId('resetPeriod')} = 'YEARLY' AND ${sqlId('year')} = ${currentYear} THEN ${sqlId('lastNumber')} + 1
        WHEN ${sqlId('resetPeriod')} = 'YEARLY' AND ${sqlId('year')} <> ${currentYear} THEN 1
        WHEN ${sqlId('resetPeriod')} = 'MONTHLY' AND ${sqlId('year')} = ${currentYear} AND ${sqlId('month')} = ${currentMonth} THEN ${sqlId('lastNumber')} + 1
        ELSE 1
      END,
      ${sqlId('year')} = ${currentYear},
      ${sqlId('month')} = ${currentMonth}
    WHERE ${sqlId('docType')} = ${type}
  `);

  // `prismaClient` is `any` (it may be a transaction client), and TS refuses type
  // arguments on an untyped call — so the row shape is asserted instead.
  const rows = (await prismaClient.$queryRaw(Prisma.sql`
    SELECT ${sqlId('lastNumber')}, ${sqlId('year')}, ${sqlId('month')}, ${sqlId('prefix')}, ${sqlId('padding')}, ${sqlId('resetPeriod')}
    FROM ${sqlId('DocNumberConfig')}
    WHERE ${sqlId('docType')} = ${type}
  `)) as ConfigRow[];
  const row = rows[0];
  if (!row) throw new Error(`DocNumberConfig missing after update: ${type}`);

  const { lastNumber, prefix, padding, resetPeriod } = row;
  const numberStr = String(lastNumber).padStart(padding || 4, '0');
  const prefixWithSlash = prefix.endsWith('/') ? prefix : prefix + '/';

  if (resetPeriod === 'MONTHLY') {
    return `${prefixWithSlash}${row.year}/${String(row.month).padStart(2, '0')}/${numberStr}`;
  }
  return `${prefixWithSlash}${row.year}/${numberStr}`;
}

// Generate supplier code (not using document number table)
export async function generateSupplierCode(): Promise<string> {
  const count = await prisma.supplier.count();
  const num = String(count + 1).padStart(4, '0');
  return `SUP${num}`;
}
