'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import type { DocNumberConfig, DocType } from '@elorae/db';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { getActorName, notifyDocNumberAltered } from '@/app/actions/notifications';
import { validateDocNumberConfigInput, type DocNumberConfigErrorCode } from "@/lib/doc-numbers/validate";
import { DOC_TYPE_GROUP, type DocTypeGroup } from "@/lib/doc-numbers/doc-type-groups";

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
  OPN: { prefix: 'OPN/', resetPeriod: 'MONTHLY', padding: 4 },
  PUTUS: { prefix: 'PUTUS/', resetPeriod: 'YEARLY', padding: 4 },
  KONSI: { prefix: 'KONSI/', resetPeriod: 'YEARLY', padding: 4 },
  VANLOAD: { prefix: 'VLOAD/', resetPeriod: 'YEARLY', padding: 4 },
  VANSALE: { prefix: 'VSALE/', resetPeriod: 'YEARLY', padding: 4 },
  VANRECON: { prefix: 'VRCN/', resetPeriod: 'YEARLY', padding: 4 },
  SPGSALE: { prefix: 'SPG/', resetPeriod: 'YEARLY', padding: 4 },
  DELIVERY: { prefix: 'DLV/', resetPeriod: 'MONTHLY', padding: 4 },
  FIELDRET: { prefix: 'FRET/', resetPeriod: 'MONTHLY', padding: 4 },
  KONSITRF: { prefix: 'KTRF/', resetPeriod: 'YEARLY', padding: 4 },
  STOCKTAKE: { prefix: 'STK/', resetPeriod: 'MONTHLY', padding: 4 },
  PAYMENT: { prefix: 'KWT/', resetPeriod: 'MONTHLY', padding: 4 },
  BKM: { prefix: 'BKM/', resetPeriod: 'YEARLY', padding: 4 },
  STORETRF: { prefix: 'STRF/', resetPeriod: 'YEARLY', padding: 4 },
  SELLTHRU: { prefix: 'SLT/', resetPeriod: 'YEARLY', padding: 4 },
};

/* Compile-time pin: a Prisma `DocType` member missing from the settings grouping is a type error here. */
const DOC_TYPE_GROUP_COVERS_PRISMA: Record<DocType, DocTypeGroup> = DOC_TYPE_GROUP;
void DOC_TYPE_GROUP_COVERS_PRISMA;

export async function getDocNumberConfigs(): Promise<DocNumberConfigRow[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_DOCUMENTS_VIEW);

  let configs = await prisma.docNumberConfig.findMany({ orderBy: { docType: "asc" } });
  /**
   * Seed every missing doc type, not just an empty table: a type that has never issued a number
   * has no row, and the editor would otherwise show it with a blank prefix and the wrong reset
   * period. The seeder upserts with `update: {}`, so existing counters are never touched.
   */
  if (configs.length < Object.keys(DEFAULT_CONFIGS).length) {
    await seedDocNumberConfigs();
    configs = await prisma.docNumberConfig.findMany({ orderBy: { docType: "asc" } });
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

export type UpdateDocNumberConfigResult = { ok: true } | { ok: false; code: DocNumberConfigErrorCode };

export async function updateDocNumberConfig(
  docType: string,
  config: { prefix: string; resetPeriod: string; padding: number }
): Promise<UpdateDocNumberConfigResult> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_DOCUMENTS_MANAGE);

  const parsed = validateDocNumberConfigInput({ docType, ...config });
  if (!parsed.ok) return parsed;
  const { prefix, resetPeriod, padding } = parsed.value;
  const type = parsed.value.docType as DocType;

  await prisma.docNumberConfig.upsert({
    where: { docType: type },
    create: {
      docType: type,
      prefix,
      resetPeriod,
      padding,
      lastNumber: 0,
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    },
    update: { prefix, resetPeriod, padding },
  });

  getActorName(session.user.id)
    .then((triggeredByName) => notifyDocNumberAltered(type, triggeredByName))
    .catch(() => {});

  revalidatePath("/backoffice/settings/documents");
  return { ok: true };
}
