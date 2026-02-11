import { DocType } from '@prisma/client';
import { prisma } from './prisma';

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
};

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
  }

  let { lastNumber, year, month } = config;
  const resetPeriod = config.resetPeriod as string;

  if (resetPeriod === 'YEARLY' && year !== currentYear) {
    lastNumber = 0;
    year = currentYear;
    month = currentMonth;
  } else if (
    resetPeriod === 'MONTHLY' &&
    (year !== currentYear || month !== currentMonth)
  ) {
    lastNumber = 0;
    year = currentYear;
    month = currentMonth;
  }

  lastNumber += 1;

  await prismaClient.docNumberConfig.update({
    where: { docType: type },
    data: { lastNumber, year, month },
  });

  const padding = config.padding || 4;
  const numberStr = String(lastNumber).padStart(padding, '0');
  const prefix = config.prefix.endsWith('/') ? config.prefix : config.prefix + '/';

  if (resetPeriod === 'MONTHLY') {
    return `${prefix}${year}/${String(month).padStart(2, '0')}/${numberStr}`;
  }
  return `${prefix}${year}/${numberStr}`;
}

// Generate supplier code (not using document number table)
export async function generateSupplierCode(): Promise<string> {
  const count = await prisma.supplier.count();
  const num = String(count + 1).padStart(4, '0');
  return `SUP${num}`;
}
