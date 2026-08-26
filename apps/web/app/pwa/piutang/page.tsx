import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { tokoLapangan } from "@/lib/receivables/pwa-queries";
import { PiutangLapanganClient } from "./PiutangLapanganClient";

export const dynamic = "force-dynamic";

export default async function PiutangLapanganPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <PiutangLapanganClient toko={await tokoLapangan(session.user.id)} />;
}
