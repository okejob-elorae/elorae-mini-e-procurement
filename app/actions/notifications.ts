'use server';

import { prisma } from '@/lib/prisma';
import { messaging } from '@/lib/firebase/admin';

const PO_OVERDUE_TYPE = 'PO_OVERDUE';
const ACCESSORIES_PENDING_CMT_TYPE = 'ACCESSORIES_PENDING_CMT';

/** Start of today in local TZ (for dedup). */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Find overdue POs (etaDate < today, status not CLOSED/CANCELLED).
 * Send FCM and enqueue NotificationQueue once per PO per day (dedup).
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

  let sent = 0;

  const sentTodayForPOs = await prisma.notificationQueue.findMany({
    where: { type: PO_OVERDUE_TYPE, createdAt: { gte: today } },
    select: { data: true },
  });
  const sentPoIds = new Set(
    sentTodayForPOs
      .map((r) => (typeof r.data === 'object' && r.data !== null && 'poId' in r.data ? (r.data as { poId: string }).poId : null))
      .filter(Boolean) as string[]
  );

  for (const po of overduePOs) {
    const poId = po.id;
    const docNumber = po.docNumber;
    if (sentPoIds.has(poId)) continue;

    const userId = po.createdById;
    const title = 'PO Overdue';
    const body = `${docNumber} (${po.supplier?.name ?? 'Supplier'}) – ETA has passed`;
    const data = { type: PO_OVERDUE_TYPE, poId, docNumber };

    const user = po.createdBy;
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
        console.error('FCM send failed for PO', poId, err);
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
    sentPoIds.add(poId);
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

  const targetUsers = await prisma.user.findMany({
    where: {
      role: { in: ['PRODUCTION', 'WAREHOUSE'] },
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
 * Notify PO creator when a work order is completed (optional in-app / push).
 */
export async function notifyWOCompleted(woId: string): Promise<void> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    include: {
      finishedGood: { select: { nameEn: true, nameId: true } },
    },
  });
  if (!wo) return;

  const creator = await prisma.user.findUnique({
    where: { id: wo.createdById },
    select: { id: true, fcmToken: true },
  });
  if (!creator) return;

  const fgName = wo.finishedGood?.nameEn ?? wo.finishedGood?.nameId ?? 'FG';
  const title = 'Work Order Completed';
  const body = `${wo.docNumber} – ${fgName} completed`;
  const data = { type: 'WO_COMPLETED', woId, docNumber: wo.docNumber };

  const queueRow = await prisma.notificationQueue.create({
    data: {
      userId: wo.createdById,
      type: 'WO_COMPLETED',
      title,
      body,
      data,
      sent: false,
    },
  });

  if (creator.fcmToken && messaging) {
    try {
      await messaging.send({
        token: creator.fcmToken,
        notification: { title, body },
        data: { type: 'WO_COMPLETED', woId, docNumber: wo.docNumber },
      });
      await prisma.notificationQueue.update({
        where: { id: queueRow.id },
        data: { sent: true, sentAt: new Date() },
      });
    } catch (err) {
      console.error('FCM send failed for WO', woId, err);
    }
  }
}
