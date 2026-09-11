import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { prisma } from "@elorae/db";
import { NotificationsList } from "./NotificationsList";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export default async function PwaNotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const items = await prisma.notificationQueue.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
  });

  return (
    <NotificationsList
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
