import { DocType } from '@prisma/client';
import { prisma } from './prisma';

interface DocConfig {
  prefix: string;
  resetMonthly: boolean;
}

const docConfig: Record<DocType, DocConfig> = {
  PO: { prefix: 'PO', resetMonthly: true },
  GRN: { prefix: 'GRN', resetMonthly: true },
  WO: { prefix: 'WO', resetMonthly: false },
  ADJ: { prefix: 'ADJ', resetMonthly: true },
  RET: { prefix: 'RET', resetMonthly: true },
  ISSUE: { prefix: 'ISS', resetMonthly: true },
  RECEIPT: { prefix: 'RCPT', resetMonthly: true },
};

export async function generateDocNumber(
  type: DocType,
  tx?: any
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const prismaClient = tx || prisma;

  const { prefix, resetMonthly } = docConfig[type];

  const counter = await prismaClient.documentNumber.upsert({
    where: {
      docType_year_month: {
        docType: type,
        year,
        month: resetMonthly ? month : 0,
      },
    },
    create: {
      docType: type,
      year,
      month: resetMonthly ? month : 0,
      lastNumber: 1,
      prefix: `${prefix}/`,
      format: resetMonthly
        ? '{prefix}{year}/{month}/{number}'
        : '{prefix}{year}/{number}',
    },
    update: {
      lastNumber: { increment: 1 },
    },
  });

  const num = String(counter.lastNumber).padStart(4, '0');
  return resetMonthly
    ? `${prefix}/${year}/${String(month).padStart(2, '0')}/${num}`
    : `${prefix}/${year}/${num}`;
}

// Generate supplier code (not using document number table)
export async function generateSupplierCode(): Promise<string> {
  const count = await prisma.supplier.count();
  const num = String(count + 1).padStart(4, '0');
  return `SUP${num}`;
}
