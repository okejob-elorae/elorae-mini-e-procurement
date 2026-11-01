import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { fetchNotificationPage } from "@/lib/notifications/page";
import { susunBarisKabar } from "./baris";
import { KabarClient } from "./KabarClient";

export const dynamic = "force-dynamic";

/**
 * Kotak kabar HP — satu-satunya; `/pwa/notifications` hanya mengalihkan ke sini. Halaman pertama
 * dimuat di server, kabar yang lebih lama lewat "Muat lagi" (`muatKabarLagi`). Jumlah belum dibaca
 * dihitung atas SEMUA kabar orang itu, bukan hanya yang termuat — angka yang sama dengan lencana.
 */
export default async function KabarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const [halaman, belum] = await Promise.all([
    fetchNotificationPage(session.user.id, null),
    prisma.notificationQueue.count({ where: { userId: session.user.id, readAt: null } }),
  ]);

  return (
    <KabarClient
      baris={susunBarisKabar(halaman.items, new Date())}
      kursorAwal={halaman.nextCursor}
      belumServer={belum}
    />
  );
}
