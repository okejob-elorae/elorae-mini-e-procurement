import type { Prisma } from '@prisma/client';
import type { GetAuditLogsFilters } from '@/types/audit';
import { prisma } from './prisma';

export interface AuditLogData {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: { before?: unknown; after?: unknown };
  metadata?: { ip?: string; userAgent?: string; location?: string; [k: string]: unknown };
  sensitiveDataAccessed?: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function logAudit(data: AuditLogData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        changes: (data.changes ?? undefined) as Prisma.InputJsonValue | undefined,
        metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        sensitiveDataAccessed: data.sensitiveDataAccessed ?? null,
        reason: data.reason ?? null,
        ipAddress: data.ipAddress ?? data.metadata?.ip ?? null,
        userAgent: data.userAgent ?? data.metadata?.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break main functionality
  }
}

/** Run fn then log audit with after: result. Avoid passing huge payloads. */
export async function withAudit<T>(
  fn: () => Promise<T>,
  auditData: Omit<AuditLogData, 'changes'> & { changes?: { before?: unknown; after?: unknown } }
): Promise<T> {
  const result = await fn();
  await logAudit({
    ...auditData,
    changes: auditData.changes ?? { after: result },
  });
  return result;
}

// Log bank account view (sensitive action)
export async function logBankAccountView(
  userId: string,
  supplierId: string,
  metadata?: AuditLogData['metadata'],
  reason?: string
): Promise<void> {
  await logAudit({
    userId,
    action: 'VIEW_BANK_ACCOUNT',
    entityType: 'Supplier',
    entityId: supplierId,
    metadata,
    sensitiveDataAccessed: 'bank_account',
    reason: reason ?? undefined,
    ipAddress: metadata?.ip,
    userAgent: metadata?.userAgent,
  });
}

// Log stock adjustment
export async function logStockAdjustment(
  userId: string,
  itemId: string,
  changes: { before: any; after: any },
  metadata?: AuditLogData['metadata']
): Promise<void> {
  await logAudit({
    userId,
    action: 'ADJUST_STOCK',
    entityType: 'Item',
    entityId: itemId,
    changes,
    metadata,
  });
}

/** Get audit logs with optional filters and pagination. */
export async function getAuditLogs(
  filters: GetAuditLogsFilters = {}
) {
  const {
    entityType,
    entityId,
    userId,
    action,
    dateFrom,
    dateTo,
    entitySearch,
    limit = 50,
    offset = 0,
  } = filters;

  const where: Record<string, unknown> = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (userId) where.userId = userId;
  if (action) where.action = action;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, Date>).gte = dateFrom;
    if (dateTo) (where.createdAt as Record<string, Date>).lte = dateTo;
  }
  if (entitySearch?.trim()) {
    where.entityId = { contains: entitySearch.trim() };
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}

/** Get users that have at least one audit log (for filter dropdown). */
export async function getAuditUsers() {
  const logs = await prisma.auditLog.findMany({
    select: { userId: true },
    distinct: ['userId'],
    take: 200,
  });
  const userIds = logs.map((l) => l.userId);
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  return users;
}
