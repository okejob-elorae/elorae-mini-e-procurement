/**
 * Delivery helpers for the per-user notification bell and FCM push.
 *
 * These deliberately live outside `app/actions/notifications.ts`: that file is `'use server'`,
 * so every export is a registered server action, and these two would be callable endpoints
 * taking arbitrary recipients and an arbitrary title and body. They are internal helpers with
 * no user-facing entry point, so they belong in `lib/`.
 */

import { prisma } from '@elorae/db';
import { messaging } from '@/lib/firebase/admin';

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
