import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { klaimSaya } from "@/lib/receivables/pwa-queries";
import { KlaimSayaClient } from "./KlaimSayaClient";

export const dynamic = "force-dynamic";

export default async function KlaimSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <KlaimSayaClient baris={await klaimSaya(session.user.id)} />;
}
