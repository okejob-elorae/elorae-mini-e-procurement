'use server';

import { prisma } from '@/lib/prisma';
import { messaging } from '@/lib/firebase/admin';

const PO_OVERDUE_TYPE = 'PO_OVERDUE';

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
      status: { notIn: ['CLOSED', 'CANCELLED'] },
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
