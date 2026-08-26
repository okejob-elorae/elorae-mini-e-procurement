import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { returSaya } from "@/lib/receivables/pwa-queries";
import { ReturSayaClient } from "./ReturSayaClient";

export const dynamic = "force-dynamic";

export default async function ReturSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <ReturSayaClient baris={await returSaya(session.user.id)} />;
}
