import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@elorae/db";
import { decodeNotificationCursor, fetchNotificationPage } from "@/lib/notifications/page";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications?cursor=<opaque>
 * Returns one page of the current user's notifications (newest first) plus
 * `nextCursor` (null on the last page) and the total unread count.
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawCursor = new URL(request.url).searchParams.get("cursor");
    let cursor = null;
    if (rawCursor !== null) {
      cursor = decodeNotificationCursor(rawCursor);
      if (!cursor) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    const [page, unreadCount] = await Promise.all([
      fetchNotificationPage(session.user.id, cursor),
      prisma.notificationQueue.count({
        where: {
          userId: session.user.id,
          readAt: null,
        },
      }),
    ]);

    return NextResponse.json({ items: page.items, nextCursor: page.nextCursor, unreadCount });
  } catch (err) {
    console.error("GET /api/notifications failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}
