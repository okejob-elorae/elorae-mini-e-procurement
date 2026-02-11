'use server';

import {
  getAuditLogs as getAuditLogsImpl,
  getAuditUsers as getAuditUsersImpl,
} from '@/lib/audit';
import type { GetAuditLogsFilters } from '@/types/audit';

export async function getAuditLogs(filters: GetAuditLogsFilters = {}) {
  return getAuditLogsImpl(filters);
}

export async function getAuditUsers() {
  return getAuditUsersImpl();
}
