import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { susunBarisKabar } from "./baris";
import { KabarClient } from "./KabarClient";

export const dynamic = "force-dynamic";

/** Batas baris yang dimuat. Kabar lebih tua dari ini jarang dicari dari HP. */
const BATAS = 100;

export default async function KabarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const rows = await prisma.notificationQueue.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: BATAS,
    select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
  });

  return <KabarClient baris={susunBarisKabar(rows, new Date())} batas={rows.length >= BATAS ? BATAS : null} />;
}
