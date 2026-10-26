import { prisma } from "@elorae/db";

export const NOTIFICATION_PAGE_SIZE = 50;

export const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

export type NotificationCursor = { createdAt: Date; id: string };

/**
 * Opaque cursor for the keyset (createdAt desc, id desc): base64url of
 * "<iso>|<id>". Ids are cuids, so they never contain the separator.
 */
export function encodeNotificationCursor(row: NotificationCursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

/** Returns null for anything that is not a well-formed cursor. */
export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const sep = text.indexOf("|");
  if (sep <= 0 || sep === text.length - 1) return null;
  const iso = text.slice(0, sep);
  const id = text.slice(sep + 1);
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
  if (id.length > 191) return null;
  return { createdAt, id };
}

/**
 * One page of a user's notifications, newest first. Reads one extra row to know
 * whether a next page exists, so the last page always returns `nextCursor: null`.
 */
export async function fetchNotificationPage(userId: string, cursor: NotificationCursor | null) {
  const rows = await prisma.notificationQueue.findMany({
    where: {
      userId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: NOTIFICATION_PAGE_SIZE + 1,
    select: NOTIFICATION_SELECT,
  });
  const hasMore = rows.length > NOTIFICATION_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, NOTIFICATION_PAGE_SIZE) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeNotificationCursor(last) : null,
  };
}
