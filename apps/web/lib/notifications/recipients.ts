/**
 * Delivery helpers for the per-user notification bell and FCM push.
 *
 * These deliberately live outside `app/actions/notifications.ts`: that file is `'use server'`,
 * so every export is a registered server action, and these two would be callable endpoints
 * taking arbitrary recipients and an arbitrary title and body. They are internal helpers with
 * no user-facing entry point, so they belong in `lib/`.
 */

import { prisma, type Prisma } from '@elorae/db';
import { messaging } from '@/lib/firebase/admin';

// ----- Shared helpers for RBAC-filtered push notifications -----

export type NotificationUser = { id: string; fcmToken: string | null };

/**
 * Get users who have the given permission (via role or system role).
 * Used to determine who receives a notification; excludes no one by fcmToken so queue rows exist for all.
 *
 * The system-role branch deliberately survives a MISSING `Permission` row, rather than the
 * whole lookup returning nobody. The recipient model has to agree with the authorization
 * model, and `lib/auth.ts` grants `permissions = ['*']` in CODE to every user whose
 * `RoleDefinition.isSystem` is true, with `hasPermission` short-circuiting on that wildcard —
 * so an admin can act on a document whose permission code was never seeded as a row. Bailing
 * out early on a missing row produced the exact inversion this notification exists to remove:
 * the one person who can press the button is the one nobody tells. Permission rows are seeded
 * by hand in this deployment and several are known to be absent on prod, so a missing row is a
 * real recurring state rather than a theoretical one.
 *
 * When the row DOES exist, the query is unchanged — the `OR` still matches system roles plus
 * every role explicitly holding the permission.
 */
export async function getUsersWithPermission(permissionCode: string): Promise<NotificationUser[]> {
  const permission = await prisma.permission.findUnique({
    where: { code: permissionCode },
  });
  const where: Prisma.UserWhereInput = permission
    ? {
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
      }
    : { roleDefinition: { isSystem: true } };
  const users = await prisma.user.findMany({
    where,
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
