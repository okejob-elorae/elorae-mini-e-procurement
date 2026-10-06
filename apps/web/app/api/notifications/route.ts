import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@elorae/db";
import { bacaKursor, buatKursor, sebelumKursor } from "./kursor";
import { lengkapiDataLonceng } from "./lengkapi";

export const dynamic = "force-dynamic";

const BATAS = 50;

/**
 * GET /api/notifications[?cursor=<dari nextCursor>]
 *
 * Satu halaman (50) notifikasi milik pengguna, terbaru dulu, plus `nextCursor`
 * untuk halaman berikutnya (`null` = sudah habis). Dulu hanya 50 terbaru tanpa
 * kursor, jadi notifikasi ke-51 dan seterusnya tidak pernah bisa dibuka.
 *
 * `unreadCount` selalu menghitung SEMUA yang belum dibaca milik pengguna, bukan
 * yang termuat — itu angka lencananya.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const teksKursor = new URL(req.url).searchParams.get("cursor");
    const kursor = teksKursor ? bacaKursor(teksKursor) : null;
    if (teksKursor && !kursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notificationQueue.findMany({
        where: { userId, ...(kursor ? sebelumKursor(kursor) : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // Satu lebih untuk tahu apakah masih ada halaman berikutnya.
        take: BATAS + 1,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notificationQueue.count({
        where: { userId, readAt: null },
      }),
    ]);

    const halaman = rows.slice(0, BATAS);
    const terakhir = halaman[halaman.length - 1];
    const nextCursor = rows.length > BATAS && terakhir ? buatKursor(terakhir) : null;
    const items = await lengkapiDataLonceng(halaman);

    return NextResponse.json({ items, unreadCount, nextCursor });
  } catch (err) {
    console.error("GET /api/notifications failed:", err);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}
