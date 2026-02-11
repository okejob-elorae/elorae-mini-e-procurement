'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import type { DocNumberConfig, DocType } from '@prisma/client';

export type DocNumberConfigRow = {
  id: string;
  docType: DocType;
  prefix: string;
  resetPeriod: string;
  padding: number;
  lastNumber: number;
  year: number;
  month: number;
};

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

export async function getDocNumberConfigs(): Promise<DocNumberConfigRow[]> {
  const configs = await prisma.docNumberConfig.findMany({
    orderBy: { docType: 'asc' },
  });
  if (configs.length === 0) {
    await seedDocNumberConfigs();
    return getDocNumberConfigs();
  }
  return configs.map((c: DocNumberConfig) => ({
    id: c.id,
    docType: c.docType,
    prefix: c.prefix,
    resetPeriod: c.resetPeriod,
    padding: c.padding,
    lastNumber: c.lastNumber,
    year: c.year,
    month: c.month,
  }));
}

async function seedDocNumberConfigs() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  for (const [docType, def] of Object.entries(DEFAULT_CONFIGS)) {
    await prisma.docNumberConfig.upsert({
      where: { docType: docType as DocType },
      create: {
        docType: docType as DocType,
        prefix: def.prefix,
        resetPeriod: def.resetPeriod,
        padding: def.padding,
        lastNumber: 0,
        year,
        month,
      },
      update: {},
    });
  }
}

export async function updateDocNumberConfig(
  docType: DocType,
  config: {
    prefix: string;
    resetPeriod: 'YEARLY' | 'MONTHLY' | 'NEVER';
    padding: number;
  }
) {
  await prisma.docNumberConfig.upsert({
    where: { docType },
    create: {
      docType,
      prefix: config.prefix,
      resetPeriod: config.resetPeriod,
      padding: config.padding,
      lastNumber: 0,
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    },
    update: {
      prefix: config.prefix,
      resetPeriod: config.resetPeriod,
      padding: config.padding,
    },
  });
  revalidatePath('/backoffice/settings/documents');
}
