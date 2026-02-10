import { prisma } from './prisma';

interface AuditLogData {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: { before?: any; after?: any };
  metadata?: { ip?: string; userAgent?: string; location?: string };
}

export async function logAudit(data: AuditLogData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        changes: data.changes ?? undefined,
        metadata: data.metadata ?? undefined,
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break main functionality
  }
}

// Log bank account view
export async function logBankAccountView(
  userId: string,
  supplierId: string,
  metadata?: AuditLogData['metadata']
): Promise<void> {
  await logAudit({
    userId,
    action: 'VIEW_BANK_ACCOUNT',
    entityType: 'Supplier',
    entityId: supplierId,
    metadata,
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

// Get audit logs for entity
export async function getAuditLogs(
  entityType?: string,
  entityId?: string,
  userId?: string,
  limit: number = 50
) {
  const where: any = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (userId) where.userId = userId;

  return await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });
}
