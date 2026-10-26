import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { prisma } from "@elorae/db";
import { fetchNotificationPage } from "@/lib/notifications/page";
import { NotificationsList } from "./NotificationsList";

export const dynamic = "force-dynamic";

export default async function PwaNotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const [page, unreadCount] = await Promise.all([
    fetchNotificationPage(session.user.id, null),
    prisma.notificationQueue.count({ where: { userId: session.user.id, readAt: null } }),
  ]);
  const items = page.items;

  return (
    <NotificationsList
      initialNextCursor={page.nextCursor}
      initialUnreadCount={unreadCount}
      initialItems={items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data as Record<string, unknown> | null,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      }))}
    />
  );
}
