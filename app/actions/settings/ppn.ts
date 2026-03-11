'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';

const PPN_RATE_KEY = 'PPN_RATE_PERCENT';
const DEFAULT_PPN_RATE = 11;

/** Get configured PPN rate as percentage (e.g. 11 for 11%). Default 11 if not set. */
export async function getPpnRatePercent(): Promise<number> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: PPN_RATE_KEY },
    select: { value: true },
  });
  if (!row?.value) return DEFAULT_PPN_RATE;
  const parsed = Number.parseFloat(row.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PPN_RATE;
}

/** Set PPN rate (percentage, e.g. 11 for 11%). Requires settings_tax:manage. */
export async function setPpnRatePercent(percent: number) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_TAX_MANAGE);

  const value = Math.max(0, Math.min(100, Number(percent)));
  await prisma.systemSetting.upsert({
    where: { key: PPN_RATE_KEY },
    create: { key: PPN_RATE_KEY, value: String(value) },
    update: { value: String(value) },
  });
  revalidatePath('/backoffice/settings/tax');
}
