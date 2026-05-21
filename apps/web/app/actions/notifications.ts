'use server';

import { prisma } from '@/lib/prisma';
import { messaging } from '@/lib/firebase/admin';

const PO_OVERDUE_TYPE = 'PO_OVERDUE';
const ACCESSORIES_PENDING_CMT_TYPE = 'ACCESSORIES_PENDING_CMT';

// ----- Shared helpers for RBAC-filtered push notifications -----

export type NotificationUser = { id: string; fcmToken: string | null };

/**
 * Get users who have the given permission (via role or system role).
 * Used to determine who receives a notification; excludes no one by fcmToken so queue rows exist for all.
 */
export async function getUsersWithPermission(permissionCode: string): Promise<NotificationUser[]> {
  const permission = await prisma.permission.findUnique({
    where: { code: permissionCode },
  });
  if (!permission) {
    return [];
  }
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { roleDefinition: { isSystem: true } },
        {
          roleDefinition: {
            permissions: {
              some: { permissionId: permission.id },
            },
          },
        },
      ],
    },
    select: { id: true, fcmToken: true },
  });
  return users;
}

export type NotificationPayload = {
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

/**
 * Create NotificationQueue rows for each user and send FCM to those with fcmToken.
 * FCM data must be string key-value; we pass type + entity ids for navigation.
 */
export async function sendNotificationToUsers(
  users: NotificationUser[],
  payload: NotificationPayload
): Promise<void> {
  const { type, title, body, data } = payload;
  const fcmData: Record<string, string> = { type, ...data };
  for (const user of users) {
    const queueRow = await prisma.notificationQueue.create({
      data: {
        userId: user.id,
        type,
        title,
        body,
        data: fcmData as object,
        sent: false,
      },
    });
    if (user.fcmToken && messaging) {
      try {
        await messaging.send({
          token: user.fcmToken,
          notification: { title, body },
          data: fcmData,
        });
        await prisma.notificationQueue.update({
          where: { id: queueRow.id },
          data: { sent: true, sentAt: new Date() },
        });
      } catch (err) {
        console.error('FCM send failed', type, user.id, err);
      }
    }
  }
}

/**
 * Resolve display name for the actor (for "by X" in notification body).
 */
export async function getActorName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  if (!user) return 'Unknown';
  return (user.name?.trim() || user.email) ?? 'Unknown';
}

/** Start of today in local TZ (for dedup). */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Find overdue POs (etaDate < today, status not CLOSED/CANCELLED).
 * Send FCM and enqueue NotificationQueue once per PO per day (dedup).
 * Notifies users with purchase_orders:view permission (or admin with wildcard).
 */
export async function checkAndSendOverdueNotifications(): Promise<{ sent: number }> {
  const today = startOfToday();

  const overduePOs = await prisma.purchaseOrder.findMany({
    where: {
      etaDate: { lt: today },
      status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] },
    },
    include: {
      createdBy: { select: { id: true, fcmToken: true } },
      supplier: { select: { name: true } },
    },
  });

  if (overduePOs.length === 0) {
    return { sent: 0 };
  }

  // Get users with purchase_orders:view permission (or admin with wildcard)
  const permission = await prisma.permission.findUnique({
    where: { code: 'purchase_orders:view' },
  });

  if (!permission) {
    console.error('Permission purchase_orders:view not found');
    return { sent: 0 };
  }

  // Get users with this permission or system role (admin)
  const targetUsers = await prisma.user.findMany({
    where: {
      OR: [
        {
          roleDefinition: {
            isSystem: true, // Admin gets all notifications
          },
        },
        {
          roleDefinition: {
            permissions: {
              some: {
                permissionId: permission.id,
              },
            },
          },
        },
      ],
      fcmToken: { not: null },
    },
    select: { id: true, fcmToken: true },
  });

  const userIds = new Set(targetUsers.map(u => u.id));
  const userMap = new Map(targetUsers.map(u => [u.id, u]));

  let sent = 0;

  const sentTodayForPOs = await prisma.notificationQueue.findMany({
    where: { type: PO_OVERDUE_TYPE, createdAt: { gte: today } },
    select: { data: true, userId: true },
  });
  const sentPoUserPairs = new Set(
    sentTodayForPOs
      .map((r) => {
        const poId = typeof r.data === 'object' && r.data !== null && 'poId' in r.data ? (r.data as { poId: string }).poId : null;
        return poId ? `${poId}:${r.userId}` : null;
      })
      .filter(Boolean) as string[]
  );

  for (const po of overduePOs) {
    const poId = po.id;
    const docNumber = po.docNumber;
    const title = 'PO Overdue';
    const body = `${docNumber} (${po.supplier?.name ?? 'Supplier'}) – ETA has passed`;
    const _data = { type: PO_OVERDUE_TYPE, poId, docNumber };
    void _data;

    // Send to all users with permission, plus the PO creator if they have permission
    const recipients = new Set<string>();
    for (const user of targetUsers) {
      recipients.add(user.id);
    }
    // Also include creator if they have permission
    if (userIds.has(po.createdById)) {
      recipients.add(po.createdById);
    }

    for (const userId of recipients) {
      const key = `${poId}:${userId}`;
      if (sentPoUserPairs.has(key)) continue;

      const user = userMap.get(userId) || po.createdBy;
      let sentThis = false;
      if (user?.fcmToken && messaging) {
        try {
          await messaging.send({
            token: user.fcmToken,
            notification: { title, body },
            data: { type: PO_OVERDUE_TYPE, poId, docNumber },
          });
          sentThis = true;
          sent += 1;
        } catch (err) {
          console.error('FCM send failed for PO', poId, userId, err);
        }
      }

      await prisma.notificationQueue.create({
        data: {
          userId,
          type: PO_OVERDUE_TYPE,
          title,
          body,
          data: { type: PO_OVERDUE_TYPE, poId, docNumber },
          sent: sentThis,
          sentAt: sentThis ? new Date() : null,
        },
      });
      sentPoUserPairs.add(key);
    }
  }

  return { sent };
}

/**
 * Find WOs in ISSUED/IN_PRODUCTION that have ACCESSORIES in consumption plan with issued < planned.
 * Notify PRODUCTION and WAREHOUSE users (with fcmToken) via FCM and NotificationQueue.
 * Dedup: at most one notification per user per day for this type.
 */
export async function checkAndSendAccessoriesPendingCMTNotifications(): Promise<{ sent: number; woCount: number }> {
  const today = startOfToday();

  const wos = await prisma.workOrder.findMany({
    where: { status: { in: ['ISSUED', 'IN_PRODUCTION'] } },
    include: { issues: true },
  });

  const accessoriesItemIds = new Set(
    (await prisma.item.findMany({
      where: { type: 'ACCESSORIES' },
      select: { id: true },
    })).map((i) => i.id)
  );

  const woIdsNeedingAccessories: string[] = [];
  for (const wo of wos) {
    const plan = (Array.isArray(wo.consumptionPlan) ? wo.consumptionPlan : []) as Array<{ itemId: string; plannedQty?: number; issuedQty?: number }>;
    const issuedByItem = new Map<string, number>();
    for (const issue of wo.issues) {
      const items = (issue.items as Array<{ itemId: string; qty: number }>) ?? [];
      for (const line of items) {
        issuedByItem.set(line.itemId, (issuedByItem.get(line.itemId) ?? 0) + line.qty);
      }
    }
    const hasPending = plan.some(
      (p) =>
        accessoriesItemIds.has(p.itemId) &&
        (issuedByItem.get(p.itemId) ?? 0) < (p.plannedQty ?? 0)
    );
    if (hasPending) woIdsNeedingAccessories.push(wo.id);
  }

  if (woIdsNeedingAccessories.length === 0) {
    return { sent: 0, woCount: 0 };
  }

  // Get users with work_orders:view permission (or admin with wildcard)
  const permission = await prisma.permission.findUnique({
    where: { code: 'work_orders:view' },
  });

  if (!permission) {
    console.error('Permission work_orders:view not found');
    return { sent: 0, woCount: 0 };
  }

  const targetUsers = await prisma.user.findMany({
    where: {
      OR: [
        {
          roleDefinition: {
            isSystem: true, // Admin gets all notifications
          },
        },
        {
          roleDefinition: {
            permissions: {
              some: {
                permissionId: permission.id,
              },
            },
          },
        },
      ],
      fcmToken: { not: null },
    },
    select: { id: true, fcmToken: true },
  });

  const sentToday = await prisma.notificationQueue.findMany({
    where: { type: ACCESSORIES_PENDING_CMT_TYPE, createdAt: { gte: today } },
    select: { userId: true },
  });
  const sentUserIds = new Set(sentToday.map((r) => r.userId));

  const title = 'Aksesoris belum dikirim ke CMT';
  const body =
    woIdsNeedingAccessories.length === 1
      ? '1 Work Order membutuhkan pengiriman aksesoris ke CMT.'
      : `${woIdsNeedingAccessories.length} Work Order membutuhkan pengiriman aksesoris ke CMT.`;
  const dataPayload: Record<string, string> = {
    type: ACCESSORIES_PENDING_CMT_TYPE,
    woCount: String(woIdsNeedingAccessories.length),
    woIds: JSON.stringify(woIdsNeedingAccessories),
  };

  let sent = 0;
  for (const user of targetUsers) {
    if (sentUserIds.has(user.id)) continue;
    let sentThis = false;
    if (user.fcmToken && messaging) {
      try {
        await messaging.send({
          token: user.fcmToken,
          notification: { title, body },
          data: dataPayload,
        });
        sentThis = true;
        sent += 1;
      } catch (err) {
        console.error('FCM send failed for ACCESSORIES_PENDING_CMT', user.id, err);
      }
    }
    await prisma.notificationQueue.create({
      data: {
        userId: user.id,
        type: ACCESSORIES_PENDING_CMT_TYPE,
        title,
        body,
        data: { type: ACCESSORIES_PENDING_CMT_TYPE, woCount: woIdsNeedingAccessories.length, woIds: woIdsNeedingAccessories },
        sent: sentThis,
        sentAt: sentThis ? new Date() : null,
      },
    });
    sentUserIds.add(user.id);
  }

  return { sent, woCount: woIdsNeedingAccessories.length };
}

/**
 * Notify users with work_orders:view permission when a work order is completed.
 * Also notifies the WO creator if they have the permission.
 */
export async function notifyWOCompleted(woId: string, triggeredByUserId?: string): Promise<void> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    include: {
      finishedGood: { select: { nameEn: true, nameId: true } },
    },
  });
  if (!wo) return;

  // Get users with work_orders:view permission (or admin with wildcard)
  const permission = await prisma.permission.findUnique({
    where: { code: 'work_orders:view' },
  });

  if (!permission) {
    console.error('Permission work_orders:view not found');
    return;
  }

  const targetUsers = await prisma.user.findMany({
    where: {
      OR: [
        {
          roleDefinition: {
            isSystem: true, // Admin gets all notifications
          },
        },
        {
          roleDefinition: {
            permissions: {
              some: {
                permissionId: permission.id,
              },
            },
          },
        },
      ],
    },
    select: { id: true, fcmToken: true },
  });

  const fgName = wo.finishedGood?.nameEn ?? wo.finishedGood?.nameId ?? 'FG';
  const title = 'Work Order Completed';
  const byLine = triggeredByUserId ? ` by ${await getActorName(triggeredByUserId)}` : '';
  const body = `${wo.docNumber} – ${fgName} completed${byLine}`;
  const data = { type: 'WO_COMPLETED', woId, docNumber: wo.docNumber };

  // Send to all users with permission, plus the creator if they have permission
  const recipients = new Set<string>();
  for (const user of targetUsers) {
    recipients.add(user.id);
  }
  // Also include creator if they have permission
  const creatorHasPermission = targetUsers.some(u => u.id === wo.createdById);
  if (creatorHasPermission) {
    recipients.add(wo.createdById);
  }

  for (const userId of recipients) {
    const user = targetUsers.find(u => u.id === userId);
    const queueRow = await prisma.notificationQueue.create({
      data: {
        userId,
        type: 'WO_COMPLETED',
        title,
        body,
        data,
        sent: false,
      },
    });

    if (user?.fcmToken && messaging) {
      try {
        await messaging.send({
          token: user.fcmToken,
          notification: { title, body },
          data: { type: 'WO_COMPLETED', woId, docNumber: wo.docNumber },
        });
        await prisma.notificationQueue.update({
          where: { id: queueRow.id },
          data: { sent: true, sentAt: new Date() },
        });
      } catch (err) {
        console.error('FCM send failed for WO', woId, userId, err);
      }
    }
  }
}

// ----- Event-specific notifications (RBAC-filtered, with actor) -----

export async function notifySupplierCreated(supplierId: string, supplierName: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('suppliers:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'SUPPLIER_CREATED',
    title: 'Supplier created',
    body: `${supplierName} created by ${triggeredByName}`,
    data: { supplierId },
  });
}

export async function notifySupplierApproved(supplierId: string, supplierName: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('suppliers:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'SUPPLIER_APPROVED',
    title: 'Supplier approved',
    body: `${supplierName} approved by ${triggeredByName}`,
    data: { supplierId },
  });
}

export async function notifyItemCreated(itemId: string, itemName: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('items:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'ITEM_CREATED',
    title: 'New item added',
    body: `${itemName} added by ${triggeredByName}`,
    data: { itemId },
  });
}

export async function notifyPOCreated(poId: string, docNumber: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('purchase_orders:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'PO_CREATED',
    title: 'New PO issued',
    body: `PO ${docNumber} created by ${triggeredByName}`,
    data: { poId, docNumber },
  });
}

export async function notifyPOStatusUpdated(
  poId: string,
  docNumber: string,
  fromStatus: string,
  toStatus: string,
  triggeredByName: string
): Promise<void> {
  const users = await getUsersWithPermission('purchase_orders:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'PO_STATUS_UPDATED',
    title: 'PO status updated',
    body: `PO ${docNumber} status changed from ${fromStatus} to ${toStatus} by ${triggeredByName}`,
    data: { poId, docNumber },
  });
}

export async function notifyPOPaymentToggled(
  poId: string,
  docNumber: string,
  paid: boolean,
  triggeredByName: string
): Promise<void> {
  const users = await getUsersWithPermission('supplier_payments:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'PO_PAYMENT_TOGGLED',
    title: 'PO payment status updated',
    body: `PO ${docNumber} marked ${paid ? 'paid' : 'unpaid'} by ${triggeredByName}`,
    data: { poId, docNumber },
  });
}

export async function notifyGRNCreated(grnId: string, docNumber: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('inventory:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'GRN_CREATED',
    title: 'GRN created',
    body: `GRN ${docNumber} created by ${triggeredByName}`,
    data: { grnId, docNumber },
  });
}

export async function notifyStockAdjustmentCreated(
  adjustmentId: string,
  docNumber: string,
  triggeredByName: string
): Promise<void> {
  const users = await getUsersWithPermission('inventory:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'STOCK_ADJUSTMENT_CREATED',
    title: 'Stock adjustment created',
    body: `Stock adjustment ${docNumber} created by ${triggeredByName}`,
    data: { adjustmentId, docNumber },
  });
}

export async function notifyWOCreated(woId: string, docNumber: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('work_orders:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'WO_CREATED',
    title: 'Work Order created',
    body: `WO ${docNumber} created by ${triggeredByName}`,
    data: { woId, docNumber },
  });
}

export async function notifyWOStatusUpdated(
  woId: string,
  docNumber: string,
  fromStatus: string,
  toStatus: string,
  triggeredByName: string
): Promise<void> {
  const users = await getUsersWithPermission('work_orders:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'WO_STATUS_UPDATED',
    title: 'Work Order status updated',
    body: `WO ${docNumber} status changed from ${fromStatus} to ${toStatus} by ${triggeredByName}`,
    data: { woId, docNumber },
  });
}

export async function notifyWOMaterialsIssued(woId: string, docNumber: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('work_orders:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'WO_MATERIALS_ISSUED',
    title: 'Work Order materials issued',
    body: `Materials issued for WO ${docNumber} by ${triggeredByName}`,
    data: { woId, docNumber },
  });
}

export async function notifyVendorReturnCreated(
  vendorReturnId: string,
  docNumber: string,
  triggeredByName: string
): Promise<void> {
  const users = await getUsersWithPermission('vendor_returns:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'VENDOR_RETURN_CREATED',
    title: 'Vendor return created',
    body: `Vendor return ${docNumber} created by ${triggeredByName}`,
    data: { vendorReturnId, docNumber },
  });
}

export async function notifyVendorReturnStatusUpdated(
  vendorReturnId: string,
  docNumber: string,
  fromStatus: string,
  toStatus: string,
  triggeredByName: string
): Promise<void> {
  const users = await getUsersWithPermission('vendor_returns:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'VENDOR_RETURN_STATUS_UPDATED',
    title: 'Vendor return status updated',
    body: `Vendor return ${docNumber} status changed from ${fromStatus} to ${toStatus} by ${triggeredByName}`,
    data: { vendorReturnId, docNumber },
  });
}

export async function notifyDocNumberAltered(docType: string, triggeredByName: string): Promise<void> {
  const users = await getUsersWithPermission('settings_documents:view');
  if (users.length === 0) return;
  await sendNotificationToUsers(users, {
    type: 'DOC_NUMBER_ALTERED',
    title: 'Doc number config updated',
    body: `Doc number config for ${docType} updated by ${triggeredByName}`,
    data: { docType },
  });
}
