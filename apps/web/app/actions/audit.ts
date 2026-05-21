'use server';

import {
  getAuditLogs as getAuditLogsImpl,
  getAuditUsers as getAuditUsersImpl,
  logAudit,
} from '@/lib/audit';
import { auth } from '@/lib/auth';
import type { GetAuditLogsFilters } from '@/types/audit';

export async function getAuditLogs(filters: GetAuditLogsFilters = {}) {
  return getAuditLogsImpl(filters);
}

export async function getAuditUsers() {
  return getAuditUsersImpl();
}

/** Log a print action for audit trail. Call before or when opening the print dialog. */
export async function logPrint(entityType: string, entityId: string) {
  const session = await auth();
  if (!session?.user?.id) return;
  await logAudit({
    userId: session.user.id,
    action: 'PRINT',
    entityType,
    entityId,
  });
}
