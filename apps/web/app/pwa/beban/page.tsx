import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { bebanSaya } from "@/lib/receivables/pwa-queries";
import { BebanSayaClient } from "./BebanSayaClient";

export const dynamic = "force-dynamic";

export default async function BebanSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <BebanSayaClient baris={await bebanSaya(session.user.id)} />;
}
